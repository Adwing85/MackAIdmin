import { all, get, run, transaction, type DB } from "../db/database.js";
import {
  DEFAULT_MODEL_PRICES,
  findPrice,
  forecastMonth,
  isoDate,
  monthWindow,
  priceUsage,
  type ModelPrice,
} from "../domain/costs.js";
import { getGovernance } from "./settings.js";

export function loadPrices(db: DB): ModelPrice[] {
  const rows = all<Record<string, number | string>>(db, "SELECT * FROM model_prices ORDER BY model");
  if (!rows.length) return DEFAULT_MODEL_PRICES;
  return rows.map((r) => ({
    model: r.model as string,
    inputPerMTok: r.input_per_mtok as number,
    outputPerMTok: r.output_per_mtok as number,
    cacheWritePerMTok: r.cache_write_per_mtok as number,
    cacheReadPerMTok: r.cache_read_per_mtok as number,
  }));
}

export function savePrices(db: DB, prices: ModelPrice[]): void {
  transaction(db, () => {
    run(db, "DELETE FROM model_prices");
    for (const p of prices) {
      run(
        db,
        `INSERT INTO model_prices (model, input_per_mtok, output_per_mtok, cache_write_per_mtok, cache_read_per_mtok)
         VALUES (:m, :i, :o, :w, :r)`,
        { m: p.model, i: p.inputPerMTok, o: p.outputPerMTok, w: p.cacheWritePerMTok, r: p.cacheReadPerMTok },
      );
    }
  });
}

export interface UsageInput {
  date: string;
  assetId: number | null;
  personId: number | null;
  source: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** When omitted, the cost is computed from the model price list. */
  costUsd?: number | null;
  sessions?: number;
  linesAdded?: number;
  linesRemoved?: number;
  dedupeKey?: string | null;
}

/** Inserts a usage record; records with the same dedupe key are replaced (idempotent syncs). */
export function recordUsage(db: DB, u: UsageInput, prices: ModelPrice[]): { costUsd: number; priced: boolean } {
  const price = findPrice(u.model, prices);
  const costUsd = u.costUsd ?? priceUsage(u, price);
  run(
    db,
    `INSERT INTO usage_records (date, asset_id, person_id, source, model, input_tokens, output_tokens, cache_read_tokens,
       cache_write_tokens, cost_usd, sessions, lines_added, lines_removed, dedupe_key)
     VALUES (:date, :assetId, :personId, :source, :model, :inputTokens, :outputTokens, :cacheReadTokens,
       :cacheWriteTokens, :costUsd, :sessions, :linesAdded, :linesRemoved, :dedupeKey)
     ON CONFLICT(dedupe_key) DO UPDATE SET
       asset_id = excluded.asset_id, person_id = excluded.person_id, model = excluded.model,
       input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens,
       cache_read_tokens = excluded.cache_read_tokens, cache_write_tokens = excluded.cache_write_tokens,
       cost_usd = excluded.cost_usd, sessions = excluded.sessions, lines_added = excluded.lines_added,
       lines_removed = excluded.lines_removed`,
    {
      date: u.date,
      assetId: u.assetId,
      personId: u.personId,
      source: u.source,
      model: u.model,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      cacheReadTokens: u.cacheReadTokens,
      cacheWriteTokens: u.cacheWriteTokens,
      costUsd,
      sessions: u.sessions ?? 0,
      linesAdded: u.linesAdded ?? 0,
      linesRemoved: u.linesRemoved ?? 0,
      dedupeKey: u.dedupeKey ?? null,
    },
  );
  return { costUsd, priced: u.costUsd != null || !!price };
}

/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, CRLF); detects "," or ";" (German Excel). */
export function parseCsv(text: string): Record<string, string>[] {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...data] = rows.filter((r) => r.some((c) => c.trim()));
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase());
  return data.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

export interface CostSummary {
  month: { start: string; end: string; daysElapsed: number; daysInMonth: number };
  mtdUsd: number;
  forecastUsd: number;
  previousMonthUsd: number;
  budgetUsd: number;
  budgetAlertPercent: number;
  daily: { date: string; costUsd: number }[];
  byTeam: { id: number | null; name: string; costUsd: number; budgetUsd: number | null }[];
  byAsset: { id: number | null; name: string; key: string | null; costUsd: number; budgetUsd: number | null }[];
  byModel: { model: string; costUsd: number; inputTokens: number; outputTokens: number; cacheReadTokens: number }[];
  bySource: { source: string; costUsd: number }[];
  byPerson: { id: number | null; name: string; costUsd: number; sessions: number }[] | null;
  cacheHitRate: number | null;
  unpricedModels: string[];
}

/**
 * Aggregated cost view. Team attribution: personal usage (e.g. Claude Code) is charged to the
 * person's team, automated usage to the asset's team. Per-person data is only included for admins/finance – usage per
 * employee is personal data and, in Germany, typically subject to works council agreements.
 */
export function costSummary(db: DB, now: Date, includePersons: boolean): CostSummary {
  const w = monthWindow(now);
  const settings = getGovernance(db);
  const range = { start: w.start, end: w.end };
  const mtd =
    get<{ c: number | null }>(db, "SELECT SUM(cost_usd) AS c FROM usage_records WHERE date >= :start AND date < :end", range)
      ?.c ?? 0;

  const prevStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const previous =
    get<{ c: number | null }>(db, "SELECT SUM(cost_usd) AS c FROM usage_records WHERE date >= :s AND date < :e", {
      s: isoDate(prevStart),
      e: w.start,
    })?.c ?? 0;

  const since = new Date(now.getTime() - 59 * 86_400_000);
  const dailyRows = all<{ date: string; c: number }>(
    db,
    "SELECT date, SUM(cost_usd) AS c FROM usage_records WHERE date >= :s GROUP BY date",
    { s: isoDate(since) },
  );
  const dailyMap = new Map(dailyRows.map((r) => [r.date, r.c]));
  const daily = Array.from({ length: 60 }, (_, i) => {
    const d = isoDate(new Date(since.getTime() + i * 86_400_000));
    return { date: d, costUsd: round(dailyMap.get(d) ?? 0) };
  });

  const byTeam = all<{ id: number | null; name: string | null; c: number; budget: number | null }>(
    db,
    `SELECT t.id, t.name, SUM(u.cost_usd) AS c, t.monthly_budget_usd AS budget
     FROM usage_records u
     LEFT JOIN assets a ON a.id = u.asset_id
     LEFT JOIN people p ON p.id = u.person_id
     LEFT JOIN teams t ON t.id = COALESCE(p.team_id, a.team_id)
     WHERE u.date >= :start AND u.date < :end GROUP BY t.id ORDER BY c DESC`,
    range,
  ).map((r) => ({ id: r.id, name: r.name ?? "Ohne Team", costUsd: round(r.c), budgetUsd: r.budget }));

  const byAsset = all<{ id: number | null; name: string | null; key: string | null; c: number; budget: number | null }>(
    db,
    `SELECT a.id, a.name, a.key, SUM(u.cost_usd) AS c, a.monthly_budget_usd AS budget
     FROM usage_records u LEFT JOIN assets a ON a.id = u.asset_id
     WHERE u.date >= :start AND u.date < :end GROUP BY a.id ORDER BY c DESC`,
    range,
  ).map((r) => ({ id: r.id, name: r.name ?? "Nicht zugeordnet", key: r.key, costUsd: round(r.c), budgetUsd: r.budget }));

  const byModel = all<{ model: string; c: number; i: number; o: number; cr: number }>(
    db,
    `SELECT model, SUM(cost_usd) AS c, SUM(input_tokens) AS i, SUM(output_tokens) AS o, SUM(cache_read_tokens) AS cr
     FROM usage_records WHERE date >= :start AND date < :end GROUP BY model ORDER BY c DESC`,
    range,
  ).map((r) => ({ model: r.model, costUsd: round(r.c), inputTokens: r.i, outputTokens: r.o, cacheReadTokens: r.cr }));

  const bySource = all<{ source: string; c: number }>(
    db,
    "SELECT source, SUM(cost_usd) AS c FROM usage_records WHERE date >= :start AND date < :end GROUP BY source ORDER BY c DESC",
    range,
  ).map((r) => ({ source: r.source, costUsd: round(r.c) }));

  const byPerson = includePersons
    ? all<{ id: number | null; name: string | null; c: number; s: number }>(
        db,
        `SELECT p.id, p.name, SUM(u.cost_usd) AS c, SUM(u.sessions) AS s
         FROM usage_records u LEFT JOIN people p ON p.id = u.person_id
         WHERE u.date >= :start AND u.date < :end AND u.person_id IS NOT NULL GROUP BY p.id ORDER BY c DESC`,
        range,
      ).map((r) => ({ id: r.id, name: r.name ?? "Unbekannt", costUsd: round(r.c), sessions: r.s }))
    : null;

  const totalInput = byModel.reduce((s, m) => s + m.inputTokens + m.cacheReadTokens, 0);
  const totalCached = byModel.reduce((s, m) => s + m.cacheReadTokens, 0);
  const prices = loadPrices(db);

  return {
    month: { start: w.start, end: w.end, daysElapsed: w.daysElapsed, daysInMonth: w.daysInMonth },
    mtdUsd: round(mtd),
    forecastUsd: forecastMonth(mtd, w),
    previousMonthUsd: round(previous),
    budgetUsd: settings.globalMonthlyBudgetUsd,
    budgetAlertPercent: settings.budgetAlertPercent,
    daily,
    byTeam,
    byAsset,
    byModel,
    bySource,
    byPerson,
    cacheHitRate: totalInput ? Math.round((totalCached / totalInput) * 1000) / 10 : null,
    unpricedModels: byModel.filter((m) => !findPrice(m.model, prices)).map((m) => m.model),
  };
}

export function assetDailyUsage(db: DB, assetId: number, days = 60, now = new Date()) {
  const since = new Date(now.getTime() - (days - 1) * 86_400_000);
  const rows = all<{ date: string; c: number; t: number }>(
    db,
    `SELECT date, SUM(cost_usd) AS c, SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens) AS t
     FROM usage_records WHERE asset_id = :id AND date >= :s GROUP BY date`,
    { id: assetId, s: isoDate(since) },
  );
  const map = new Map(rows.map((r) => [r.date, r]));
  return Array.from({ length: days }, (_, i) => {
    const d = isoDate(new Date(since.getTime() + i * 86_400_000));
    return { date: d, costUsd: round(map.get(d)?.c ?? 0), tokens: map.get(d)?.t ?? 0 };
  });
}

const round = (n: number) => Math.round(n * 100) / 100;
