// Sync of Claude Code usage from the Anthropic Admin API (Claude Code Analytics API):
// GET /v1/organizations/usage_report/claude_code?starting_at=YYYY-MM-DD&limit=..&page=..
// Docs: https://platform.claude.com/docs/en/manage-claude/claude-code-analytics-api
// Note: covers Claude Console (API) organisations. Claude Team/Enterprise seats (claude.ai) are
// reported by the Claude Enterprise Analytics API instead – use the CSV import or OpenTelemetry there.

import { all, get, nowIso, run, type DB } from "../db/database.js";
import { isoDate } from "../domain/costs.js";
import { loadPrices, recordUsage } from "../services/costs.js";
import { getIntegrations, setIntegrations } from "../services/settings.js";

interface ClaudeCodeRecord {
  date: string;
  actor: { type: "user_actor"; email_address: string } | { type: "api_actor"; api_key_name: string };
  terminal_type?: string;
  customer_type?: string;
  core_metrics?: {
    num_sessions?: number;
    lines_of_code?: { added?: number; removed?: number };
  };
  model_breakdown?: {
    model: string;
    tokens?: { input?: number; output?: number; cache_read?: number; cache_creation?: number };
    estimated_cost?: { currency: string; amount: number };
  }[];
}

interface ClaudeCodePage {
  data: ClaudeCodeRecord[];
  has_more: boolean;
  next_page: string | null;
}

export interface SyncOptions {
  adminKey: string;
  apiBase: string;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD inclusive
  fetchImpl?: typeof fetch;
}

export interface SyncResult {
  days: number;
  records: number;
  costUsd: number;
  unknownActors: string[];
}

export async function syncClaudeCodeUsage(db: DB, opts: SyncOptions): Promise<SyncResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const people = new Map(
    all<{ id: number; email: string }>(db, "SELECT id, email FROM people").map((p) => [p.email.toLowerCase(), p.id]),
  );
  const integrations = getIntegrations(db);
  const assetId = integrations.claudeCodeAssetKey
    ? (get<{ id: number }>(db, "SELECT id FROM assets WHERE key = :k", { k: integrations.claudeCodeAssetKey })?.id ?? null)
    : null;
  const prices = loadPrices(db);
  const unknown = new Set<string>();
  const result: SyncResult = { days: 0, records: 0, costUsd: 0, unknownActors: [] };

  for (let day = new Date(`${opts.from}T00:00:00Z`); isoDate(day) <= opts.to; day = new Date(day.getTime() + 86_400_000)) {
    const date = isoDate(day);
    result.days++;
    let page: string | null = null;
    do {
      const url = new URL("/v1/organizations/usage_report/claude_code", opts.apiBase);
      url.searchParams.set("starting_at", date);
      url.searchParams.set("limit", "1000");
      if (page) url.searchParams.set("page", page);
      const res = await doFetch(url, {
        headers: {
          "x-api-key": opts.adminKey,
          "anthropic-version": "2023-06-01",
          "user-agent": "MackAIdmin/0.1 (governance platform)",
        },
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Anthropic Admin API antwortete mit ${res.status}: ${body.slice(0, 300)}`);
      }
      const json = (await res.json()) as ClaudeCodePage;
      for (const rec of json.data ?? []) {
        const actorId = rec.actor.type === "user_actor" ? rec.actor.email_address : `api-key:${rec.actor.api_key_name}`;
        const personId = rec.actor.type === "user_actor" ? (people.get(rec.actor.email_address.toLowerCase()) ?? null) : null;
        if (rec.actor.type === "user_actor" && !personId) unknown.add(rec.actor.email_address);

        const sessions = rec.core_metrics?.num_sessions ?? 0;
        // Productivity metrics are per record, not per model: attach them to the first model row only.
        (rec.model_breakdown ?? []).forEach((m, idx) => {
          const costUsd = m.estimated_cost && m.estimated_cost.currency === "USD" ? m.estimated_cost.amount / 100 : null;
          const { costUsd: stored } = recordUsage(
            db,
            {
              date,
              assetId,
              personId,
              source: "anthropic_claude_code",
              model: m.model,
              inputTokens: m.tokens?.input ?? 0,
              outputTokens: m.tokens?.output ?? 0,
              cacheReadTokens: m.tokens?.cache_read ?? 0,
              cacheWriteTokens: m.tokens?.cache_creation ?? 0,
              costUsd,
              sessions: idx === 0 ? sessions : 0,
              linesAdded: idx === 0 ? (rec.core_metrics?.lines_of_code?.added ?? 0) : 0,
              linesRemoved: idx === 0 ? (rec.core_metrics?.lines_of_code?.removed ?? 0) : 0,
              dedupeKey: `cc:${date}:${actorId}:${rec.terminal_type ?? "-"}:${rec.customer_type ?? "-"}:${m.model}`,
            },
            prices,
          );
          result.records++;
          result.costUsd += stored;
        });

        if (personId && sessions > 0) {
          run(
            db,
            `UPDATE license_assignments SET last_active_at = :d
             WHERE person_id = :p AND revoked_at IS NULL AND (last_active_at IS NULL OR last_active_at < :d)`,
            { d: `${date}T00:00:00.000Z`, p: personId },
          );
        }
      }
      page = json.has_more ? json.next_page : null;
    } while (page);
  }

  result.costUsd = Math.round(result.costUsd * 100) / 100;
  result.unknownActors = [...unknown].sort();
  setIntegrations(db, {
    ...integrations,
    lastClaudeCodeSyncAt: nowIso(),
    lastClaudeCodeSyncResult: `${result.records} Datensätze, ${result.days} Tage, ${result.costUsd} USD`,
  });
  return result;
}
