export interface ModelPrice {
  model: string;
  /** USD per million tokens */
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWritePerMTok: number;
  cacheReadPerMTok: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/**
 * Default list prices (Anthropic first-party API, USD per MTok, as of 2026-10).
 * Cache writes are priced at 1.25× input (5-minute TTL). Admins can edit these in the UI –
 * always reconcile against https://platform.claude.com/docs/en/about-claude/pricing.
 */
export const DEFAULT_MODEL_PRICES: ModelPrice[] = [
  { model: "claude-fable-5-1", inputPerMTok: 10, outputPerMTok: 50, cacheWritePerMTok: 12.5, cacheReadPerMTok: 0.25 },
  { model: "claude-opus-5-5", inputPerMTok: 4, outputPerMTok: 20, cacheWritePerMTok: 5, cacheReadPerMTok: 0.2 },
  { model: "claude-opus-5", inputPerMTok: 5, outputPerMTok: 25, cacheWritePerMTok: 6.25, cacheReadPerMTok: 0.5 },
  { model: "claude-sonnet-5-5", inputPerMTok: 2, outputPerMTok: 10, cacheWritePerMTok: 2.5, cacheReadPerMTok: 0.2 },
  { model: "claude-sonnet-5", inputPerMTok: 2, outputPerMTok: 10, cacheWritePerMTok: 2.5, cacheReadPerMTok: 0.2 },
  { model: "claude-haiku-5-5", inputPerMTok: 0.1, outputPerMTok: 0.5, cacheWritePerMTok: 0.125, cacheReadPerMTok: 0.01 },
  // Previous generation, still found in older apps and agents.
  { model: "claude-fable-5", inputPerMTok: 10, outputPerMTok: 50, cacheWritePerMTok: 12.5, cacheReadPerMTok: 1 },
  { model: "claude-opus-4-8", inputPerMTok: 5, outputPerMTok: 25, cacheWritePerMTok: 6.25, cacheReadPerMTok: 0.5 },
  { model: "claude-opus-4-7", inputPerMTok: 5, outputPerMTok: 25, cacheWritePerMTok: 6.25, cacheReadPerMTok: 0.5 },
  { model: "claude-sonnet-4-6", inputPerMTok: 3, outputPerMTok: 15, cacheWritePerMTok: 3.75, cacheReadPerMTok: 0.3 },
  { model: "claude-haiku-4-5", inputPerMTok: 1, outputPerMTok: 5, cacheWritePerMTok: 1.25, cacheReadPerMTok: 0.1 },
];

export function priceUsage(usage: TokenUsage, price: ModelPrice | undefined): number {
  if (!price) return 0;
  const cost =
    (usage.inputTokens * price.inputPerMTok +
      usage.outputTokens * price.outputPerMTok +
      usage.cacheWriteTokens * price.cacheWritePerMTok +
      usage.cacheReadTokens * price.cacheReadPerMTok) /
    1_000_000;
  return Math.round(cost * 10_000) / 10_000;
}

/** Resolves a price by exact model id, then by longest prefix (e.g. dated or suffixed ids). */
export function findPrice(model: string, prices: ModelPrice[]): ModelPrice | undefined {
  const exact = prices.find((p) => p.model === model);
  if (exact) return exact;
  return prices.filter((p) => model.startsWith(p.model)).sort((a, b) => b.model.length - a.model.length)[0];
}

export interface MonthWindow {
  start: string; // YYYY-MM-DD inclusive
  end: string; // YYYY-MM-DD exclusive
  daysInMonth: number;
  daysElapsed: number;
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function monthWindow(now: Date): MonthWindow {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1));
  const end = new Date(Date.UTC(y, m + 1, 1));
  const daysInMonth = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  return { start: isoDate(start), end: isoDate(end), daysInMonth, daysElapsed: now.getUTCDate() };
}

/** Linear month-end forecast from the average daily cost so far (today counts as one day). */
export function forecastMonth(mtdCost: number, window: MonthWindow): number {
  const days = Math.max(1, window.daysElapsed);
  return Math.round((mtdCost / days) * window.daysInMonth * 100) / 100;
}
