// Shadow-AI discovery: the scanner (scripts/mackaidmin-scan.mjs) reports Claude/AI artefacts it
// finds in repositories. Findings are matched to registered assets; everything unmatched is
// "shadow AI" that needs to be registered or consciously ignored.

import { all, get, nowIso, parseJson, run, transaction, type DB } from "../db/database.js";
import type { DiscoveryKind } from "../domain/catalog.js";
import { mcpMatcher, splitCommandLine, type McpMatcher } from "../domain/policy.js";
import { loadAssets } from "./assets.js";

export interface DiscoveryInput {
  repoUrl: string;
  path: string;
  kind: DiscoveryKind;
  details: Record<string, unknown>;
}

export interface ReportedMcpServer {
  name: string;
  type?: string;
  url?: string;
  command?: string;
  args?: string[];
}

/** Normalises git remotes so https, ssh and scp-style URLs of the same repo compare equal. */
export function normalizeRepoUrl(url: string | null | undefined): string {
  if (!url) return "";
  let u = url.trim().toLowerCase();
  u = u.replace(/^git@([^:]+):/, "$1/");
  u = u.replace(/^[a-z+]+:\/\//, "");
  u = u.replace(/^[^@/]+@/, "");
  u = u.replace(/\.git$/, "").replace(/\/+$/, "");
  return u;
}

/** Stores ssh and https remotes of the same repository under one canonical https URL. */
export function canonicalRepoUrl(url: string): string {
  const normalized = normalizeRepoUrl(url);
  return /^[a-z0-9.-]+\.[a-z]{2,}(:\d+)?\//.test(normalized) ? `https://${normalized}` : url.trim();
}

function wildcardMatch(pattern: string, value: string): boolean {
  const regex = new RegExp(
    `^${pattern
      .split("*")
      .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`,
    "i",
  );
  return regex.test(value);
}

export function approvedMcpMatchers(db: DB): McpMatcher[] {
  return loadAssets(db, "WHERE type = 'mcp_server' AND status IN ('approved', 'active', 'deprecated')")
    .map((a) => mcpMatcher({ key: a.key, name: a.name, status: a.status, transport: a.mcpTransport, endpoint: a.mcpEndpoint }))
    .filter((m): m is McpMatcher => m !== null);
}

/** Which of the reported MCP servers are not covered by an approved MCP-server asset? */
export function unapprovedServers(reported: ReportedMcpServer[], approved: McpMatcher[]): string[] {
  return reported
    .filter((server) => {
      if (server.url) {
        return !approved.some(
          (m) => "serverUrl" in m && (wildcardMatch(m.serverUrl, server.url!) || wildcardMatch(`${m.serverUrl}*`, server.url!)),
        );
      }
      if (server.command) {
        const argv = [server.command, ...(server.args ?? [])].join(" ");
        return !approved.some((m) => "serverCommand" in m && m.serverCommand.join(" ") === splitCommandLine(argv).join(" "));
      }
      return true;
    })
    .map((s) => s.name);
}

export function ingestDiscoveries(db: DB, items: DiscoveryInput[], source: string) {
  return transaction(db, () => {
    const assets = loadAssets(db);
    const byRepo = new Map<string, number>();
    for (const a of assets) if (a.repositoryUrl) byRepo.set(normalizeRepoUrl(a.repositoryUrl), a.id);

    let created = 0;
    let updated = 0;
    let linked = 0;
    for (const raw of items) {
      const item = { ...raw, repoUrl: canonicalRepoUrl(raw.repoUrl) };
      const assetId = byRepo.get(normalizeRepoUrl(item.repoUrl)) ?? null;
      const existing = get<{ id: number; status: string; asset_id: number | null }>(
        db,
        "SELECT id, status, asset_id FROM discoveries WHERE repo_url = :r AND path = :p AND kind = :k",
        { r: item.repoUrl, p: item.path, k: item.kind },
      );
      if (existing) {
        const keepManual = existing.status !== "new";
        run(
          db,
          `UPDATE discoveries SET details = :d, last_seen_at = :now, source = :s,
             asset_id = COALESCE(asset_id, :a), status = CASE WHEN :keep THEN status WHEN :a IS NOT NULL THEN 'linked' ELSE status END
           WHERE id = :id`,
          { d: JSON.stringify(item.details), now: nowIso(), s: source, a: assetId, keep: keepManual, id: existing.id },
        );
        updated++;
      } else {
        run(
          db,
          `INSERT INTO discoveries (repo_url, path, kind, details, source, status, asset_id)
           VALUES (:r, :p, :k, :d, :s, :status, :a)`,
          {
            r: item.repoUrl,
            p: item.path,
            k: item.kind,
            d: JSON.stringify(item.details),
            s: source,
            status: assetId ? "linked" : "new",
            a: assetId,
          },
        );
        created++;
      }
      if (assetId) linked++;
    }
    return { created, updated, linked };
  });
}

export interface DiscoveryView {
  id: number;
  repoUrl: string;
  path: string;
  kind: string;
  details: Record<string, unknown>;
  source: string;
  status: "new" | "linked" | "ignored";
  assetId: number | null;
  assetName: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  unapprovedMcpServers: string[];
}

export function listDiscoveries(db: DB, status?: string): DiscoveryView[] {
  const rows = all<Record<string, unknown>>(
    db,
    `SELECT d.*, a.name AS asset_name FROM discoveries d LEFT JOIN assets a ON a.id = d.asset_id
     ${status ? "WHERE d.status = :status" : ""} ORDER BY d.last_seen_at DESC`,
    status ? { status } : {},
  );
  const approved = approvedMcpMatchers(db);
  return rows.map((r) => {
    const details = parseJson<Record<string, unknown>>(r.details, {});
    const servers = Array.isArray(details.servers) ? (details.servers as ReportedMcpServer[]) : [];
    return {
      id: r.id as number,
      repoUrl: r.repo_url as string,
      path: r.path as string,
      kind: r.kind as string,
      details,
      source: r.source as string,
      status: r.status as DiscoveryView["status"],
      assetId: r.asset_id as number | null,
      assetName: r.asset_name as string | null,
      firstSeenAt: r.first_seen_at as string,
      lastSeenAt: r.last_seen_at as string,
      unapprovedMcpServers: r.kind === "mcp_config" ? unapprovedServers(servers, approved) : [],
    };
  });
}
