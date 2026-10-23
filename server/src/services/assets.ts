import { all, get, nowIso, parseJson, run, transaction, type DB } from "../db/database.js";
import type {
  AssetStatus,
  AssetType,
  AutonomyLevel,
  DataClassification,
  Exposure,
  McpTransport,
  PermissionKey,
  SecretsManagement,
} from "../domain/catalog.js";
import { approvalState, requiredApprovals, type ApprovalState, type RequiredApproval } from "../domain/approvals.js";
import { evaluateFindings, SEVERITY_ORDER, type Finding } from "../domain/findings.js";
import { assessRisk, type RiskAssessment } from "../domain/risk.js";
import { forecastMonth, monthWindow } from "../domain/costs.js";
import type { Asset, GovernanceSettings } from "../domain/types.js";
import { getGovernance } from "./settings.js";

interface AssetRow {
  id: number;
  key: string;
  name: string;
  type: string;
  description: string;
  purpose: string;
  status: string;
  owner_id: number | null;
  team_id: number | null;
  repository_url: string | null;
  environments: string;
  data_classification: string;
  processes_personal_data: number;
  exposure: string;
  autonomy_level: number;
  human_in_the_loop: number;
  sandboxed: number;
  secrets_management: string;
  models: string;
  capabilities: string;
  tags: string;
  mcp_transport: string | null;
  mcp_endpoint: string | null;
  monthly_budget_usd: number | null;
  last_review_at: string | null;
  review_interval_days: number | null;
  approval_round: number;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

function rowToAsset(row: AssetRow, permissions: PermissionKey[], dependencies: number[]): Asset {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    type: row.type as AssetType,
    description: row.description,
    purpose: row.purpose,
    status: row.status as AssetStatus,
    ownerId: row.owner_id,
    teamId: row.team_id,
    repositoryUrl: row.repository_url,
    environments: parseJson(row.environments, []),
    dataClassification: row.data_classification as DataClassification,
    processesPersonalData: !!row.processes_personal_data,
    exposure: row.exposure as Exposure,
    autonomyLevel: row.autonomy_level as AutonomyLevel,
    humanInTheLoop: !!row.human_in_the_loop,
    sandboxed: !!row.sandboxed,
    secretsManagement: row.secrets_management as SecretsManagement,
    models: parseJson(row.models, []),
    capabilities: parseJson(row.capabilities, []),
    tags: parseJson(row.tags, []),
    permissions,
    dependencies,
    mcpTransport: row.mcp_transport as McpTransport | null,
    mcpEndpoint: row.mcp_endpoint,
    monthlyBudgetUsd: row.monthly_budget_usd,
    lastReviewAt: row.last_review_at,
    reviewIntervalDays: row.review_interval_days,
    approvalRound: row.approval_round,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function loadAssets(db: DB, where = "", params: Record<string, string | number> = {}): Asset[] {
  const rows = all<AssetRow>(db, `SELECT * FROM assets ${where} ORDER BY name COLLATE NOCASE`, params);
  if (!rows.length) return [];
  const perms = new Map<number, PermissionKey[]>();
  for (const p of all<{ asset_id: number; permission: string }>(db, "SELECT asset_id, permission FROM asset_permissions")) {
    const list = perms.get(p.asset_id) ?? [];
    list.push(p.permission as PermissionKey);
    perms.set(p.asset_id, list);
  }
  const deps = new Map<number, number[]>();
  for (const d of all<{ asset_id: number; depends_on_id: number }>(db, "SELECT * FROM asset_dependencies")) {
    const list = deps.get(d.asset_id) ?? [];
    list.push(d.depends_on_id);
    deps.set(d.asset_id, list);
  }
  return rows.map((r) => rowToAsset(r, perms.get(r.id) ?? [], deps.get(r.id) ?? []));
}

export function loadAsset(db: DB, id: number): Asset | undefined {
  return loadAssets(db, "WHERE id = :id", { id })[0];
}

export function permissionJustifications(db: DB, assetId: number): Record<string, string> {
  return Object.fromEntries(
    all<{ permission: string; justification: string }>(
      db,
      "SELECT permission, justification FROM asset_permissions WHERE asset_id = :id",
      { id: assetId },
    ).map((r) => [r.permission, r.justification]),
  );
}

// --- writes -----------------------------------------------------------------------

export interface AssetInput {
  key?: string;
  name: string;
  type: AssetType;
  description: string;
  purpose: string;
  ownerId: number | null;
  teamId: number | null;
  repositoryUrl: string | null;
  environments: string[];
  dataClassification: DataClassification;
  processesPersonalData: boolean;
  exposure: Exposure;
  autonomyLevel: AutonomyLevel;
  humanInTheLoop: boolean;
  sandboxed: boolean;
  secretsManagement: SecretsManagement;
  models: string[];
  capabilities: string[];
  tags: string[];
  permissions: { key: PermissionKey; justification: string }[];
  dependencies: number[];
  mcpTransport: McpTransport | null;
  mcpEndpoint: string | null;
  monthlyBudgetUsd: number | null;
  reviewIntervalDays: number | null;
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "asset"
  );
}

function uniqueKey(db: DB, base: string, excludeId?: number): string {
  let key = base;
  for (let i = 2; ; i++) {
    const hit = get<{ id: number }>(db, "SELECT id FROM assets WHERE key = :k", { k: key });
    if (!hit || hit.id === excludeId) return key;
    key = `${base}-${i}`;
  }
}

const dedupe = (list: string[]) => [...new Set(list.map((s) => s.trim()).filter(Boolean))];

function fieldParams(input: AssetInput) {
  return {
    name: input.name.trim(),
    type: input.type,
    description: input.description,
    purpose: input.purpose,
    ownerId: input.ownerId,
    teamId: input.teamId,
    repositoryUrl: input.repositoryUrl?.trim() || null,
    environments: JSON.stringify(dedupe(input.environments)),
    dataClassification: input.dataClassification,
    processesPersonalData: input.processesPersonalData ? 1 : 0,
    exposure: input.exposure,
    autonomyLevel: input.autonomyLevel,
    humanInTheLoop: input.humanInTheLoop ? 1 : 0,
    sandboxed: input.sandboxed ? 1 : 0,
    secretsManagement: input.secretsManagement,
    models: JSON.stringify(dedupe(input.models)),
    capabilities: JSON.stringify(dedupe(input.capabilities.map((c) => c.toLowerCase().replace(/\s+/g, "-")))),
    tags: JSON.stringify(dedupe(input.tags)),
    mcpTransport: input.type === "mcp_server" ? input.mcpTransport : null,
    mcpEndpoint: input.type === "mcp_server" ? input.mcpEndpoint?.trim() || null : null,
    monthlyBudgetUsd: input.monthlyBudgetUsd,
    reviewIntervalDays: input.reviewIntervalDays,
  };
}

function writeRelations(db: DB, assetId: number, input: AssetInput): void {
  run(db, "DELETE FROM asset_permissions WHERE asset_id = :id", { id: assetId });
  const seen = new Set<string>();
  for (const p of input.permissions) {
    if (seen.has(p.key)) continue;
    seen.add(p.key);
    run(db, "INSERT INTO asset_permissions (asset_id, permission, justification) VALUES (:a, :p, :j)", {
      a: assetId,
      p: p.key,
      j: p.justification ?? "",
    });
  }
  run(db, "DELETE FROM asset_dependencies WHERE asset_id = :id", { id: assetId });
  for (const dep of new Set(input.dependencies)) {
    if (dep === assetId) continue;
    run(db, "INSERT OR IGNORE INTO asset_dependencies (asset_id, depends_on_id) SELECT :a, id FROM assets WHERE id = :d", {
      a: assetId,
      d: dep,
    });
  }
}

export function createAsset(db: DB, input: AssetInput, createdBy: number | null, status: AssetStatus = "draft"): Asset {
  return transaction(db, () => {
    const key = uniqueKey(db, slugify(input.key || input.name));
    const result = run(
      db,
      `INSERT INTO assets (key, name, type, description, purpose, status, owner_id, team_id, repository_url, environments,
         data_classification, processes_personal_data, exposure, autonomy_level, human_in_the_loop, sandboxed,
         secrets_management, models, capabilities, tags, mcp_transport, mcp_endpoint, monthly_budget_usd,
         review_interval_days, created_by)
       VALUES (:key, :name, :type, :description, :purpose, :status, :ownerId, :teamId, :repositoryUrl, :environments,
         :dataClassification, :processesPersonalData, :exposure, :autonomyLevel, :humanInTheLoop, :sandboxed,
         :secretsManagement, :models, :capabilities, :tags, :mcpTransport, :mcpEndpoint, :monthlyBudgetUsd,
         :reviewIntervalDays, :createdBy)`,
      { ...fieldParams(input), key, status, createdBy },
    );
    const id = Number(result.lastInsertRowid);
    writeRelations(db, id, input);
    return loadAsset(db, id)!;
  });
}

export function updateAsset(db: DB, id: number, input: AssetInput): Asset {
  return transaction(db, () => {
    const key = input.key ? uniqueKey(db, slugify(input.key), id) : undefined;
    run(
      db,
      `UPDATE assets SET ${key ? "key = :key," : ""} name = :name, type = :type, description = :description, purpose = :purpose,
         owner_id = :ownerId, team_id = :teamId, repository_url = :repositoryUrl, environments = :environments,
         data_classification = :dataClassification, processes_personal_data = :processesPersonalData,
         exposure = :exposure, autonomy_level = :autonomyLevel, human_in_the_loop = :humanInTheLoop,
         sandboxed = :sandboxed, secrets_management = :secretsManagement, models = :models,
         capabilities = :capabilities, tags = :tags, mcp_transport = :mcpTransport, mcp_endpoint = :mcpEndpoint,
         monthly_budget_usd = :monthlyBudgetUsd, review_interval_days = :reviewIntervalDays, updated_at = :now
       WHERE id = :id`,
      { ...fieldParams(input), ...(key ? { key } : {}), now: nowIso(), id },
    );
    writeRelations(db, id, input);
    return loadAsset(db, id)!;
  });
}

export function setAssetStatus(db: DB, id: number, status: AssetStatus): void {
  run(db, "UPDATE assets SET status = :s, updated_at = :now WHERE id = :id", { s: status, now: nowIso(), id });
}

// --- evaluation -------------------------------------------------------------------

export interface ApprovalRecord {
  id: number;
  assetId: number;
  round: number;
  role: string;
  reason: string;
  decision: "pending" | "approved" | "rejected";
  comment: string | null;
  decidedBy: number | null;
  decidedByName: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export function loadApprovals(db: DB, where = "", params: Record<string, string | number> = {}): ApprovalRecord[] {
  return all<Record<string, unknown>>(
    db,
    `SELECT a.*, p.name AS decided_by_name FROM approvals a LEFT JOIN people p ON p.id = a.decided_by ${where}
     ORDER BY a.round DESC, a.id`,
    params,
  ).map((r) => ({
    id: r.id as number,
    assetId: r.asset_id as number,
    round: r.round as number,
    role: r.role as string,
    reason: r.reason as string,
    decision: r.decision as ApprovalRecord["decision"],
    comment: r.comment as string | null,
    decidedBy: r.decided_by as number | null,
    decidedByName: r.decided_by_name as string | null,
    decidedAt: r.decided_at as string | null,
    createdAt: r.created_at as string,
  }));
}

export interface Acceptance {
  id: number;
  ruleId: string;
  justification: string;
  acceptedByName: string | null;
  acceptedAt: string;
  expiresAt: string;
}

export interface EvaluatedFinding extends Finding {
  acceptance: Acceptance | null;
}

export interface EvaluatedAsset {
  asset: Asset;
  owner: { id: number; name: string; email: string; active: boolean } | null;
  team: { id: number; name: string } | null;
  risk: RiskAssessment;
  requiredApprovals: RequiredApproval[];
  approvals: ApprovalRecord[];
  approvalState: ApprovalState;
  findings: EvaluatedFinding[];
  openFindings: number;
  worstOpenSeverity: Finding["severity"] | null;
  mtdCostUsd: number;
  forecastUsd: number;
}

/**
 * Evaluates the whole inventory in one pass (bulk queries, no N+1). Findings are always
 * computed from current data, so they can never drift out of sync with the assets.
 */
export function evaluateInventory(db: DB, now = new Date(), onlyIds?: number[]): EvaluatedAsset[] {
  const settings: GovernanceSettings = getGovernance(db);
  const allAssets = loadAssets(db);
  const byId = new Map(allAssets.map((a) => [a.id, a]));
  const targets = onlyIds ? allAssets.filter((a) => onlyIds.includes(a.id)) : allAssets;

  const people = new Map(
    all<{ id: number; name: string; email: string; active: number }>(db, "SELECT id, name, email, active FROM people").map(
      (p) => [p.id, { id: p.id, name: p.name, email: p.email, active: !!p.active }],
    ),
  );
  const teams = new Map(all<{ id: number; name: string }>(db, "SELECT id, name FROM teams").map((t) => [t.id, t]));

  const approvals = loadApprovals(db);
  const window = monthWindow(now);
  const mtd = new Map(
    all<{ asset_id: number; cost: number }>(
      db,
      "SELECT asset_id, SUM(cost_usd) AS cost FROM usage_records WHERE date >= :start AND date < :end AND asset_id IS NOT NULL GROUP BY asset_id",
      { start: window.start, end: window.end },
    ).map((r) => [r.asset_id, r.cost]),
  );
  const acceptances = all<Record<string, unknown>>(
    db,
    `SELECT r.*, p.name AS accepted_by_name FROM risk_acceptances r LEFT JOIN people p ON p.id = r.accepted_by
     WHERE r.revoked_at IS NULL AND r.expires_at > :now`,
    { now: now.toISOString() },
  );

  return targets.map((asset) => {
    const risk = assessRisk(asset);
    const required = requiredApprovals(asset, risk, settings);
    const current = approvals.filter((a) => a.assetId === asset.id && a.round === asset.approvalRound);
    const owner = asset.ownerId ? (people.get(asset.ownerId) ?? null) : null;
    const mtdCostUsd = Math.round((mtd.get(asset.id) ?? 0) * 100) / 100;
    const forecastUsd = forecastMonth(mtdCostUsd, window);
    const dependencies = asset.dependencies
      .map((id) => byId.get(id))
      .filter((d): d is Asset => !!d)
      .map((d) => ({ id: d.id, key: d.key, name: d.name, type: d.type, status: d.status }));

    const findings: EvaluatedFinding[] = evaluateFindings(asset, {
      now,
      settings,
      risk,
      requiredApprovals: required,
      approvalDecisions: current,
      ownerActive: !!owner?.active,
      dependencies,
      mtdCostUsd,
      forecastUsd,
    }).map((f) => {
      const acc = acceptances.find((a) => a.asset_id === asset.id && a.rule_id === f.ruleId);
      return {
        ...f,
        acceptance: acc
          ? {
              id: acc.id as number,
              ruleId: acc.rule_id as string,
              justification: acc.justification as string,
              acceptedByName: acc.accepted_by_name as string | null,
              acceptedAt: acc.accepted_at as string,
              expiresAt: acc.expires_at as string,
            }
          : null,
      };
    });
    const open = findings.filter((f) => !f.acceptance);
    const worst = SEVERITY_ORDER.find((s) => open.some((f) => f.severity === s)) ?? null;

    return {
      asset,
      owner,
      team: asset.teamId ? (teams.get(asset.teamId) ?? null) : null,
      risk,
      requiredApprovals: required,
      approvals: approvals.filter((a) => a.assetId === asset.id),
      approvalState: approvalState(required, current),
      findings,
      openFindings: open.length,
      worstOpenSeverity: worst,
      mtdCostUsd,
      forecastUsd,
    };
  });
}

export function evaluateAsset(db: DB, id: number, now = new Date()): EvaluatedAsset | undefined {
  return evaluateInventory(db, now, [id])[0];
}
