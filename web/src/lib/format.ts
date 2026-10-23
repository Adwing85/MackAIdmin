const usd0 = new Intl.NumberFormat("de-DE", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const int = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("de-DE", { notation: "compact", maximumFractionDigits: 1 });

export const fmtUsd = (n: number | null | undefined, precise = false) =>
  n == null ? "–" : precise || Math.abs(n) < 100 ? usd2.format(n) : usd0.format(n);
export const fmtInt = (n: number | null | undefined) => (n == null ? "–" : int.format(n));
export const fmtCompact = (n: number) => compact.format(n);
export const fmtPct = (n: number | null | undefined, digits = 0) =>
  n == null ? "–" : `${n.toLocaleString("de-DE", { maximumFractionDigits: digits })} %`;

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "nie";
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days <= 0) {
    const hours = Math.floor(diff / 3_600_000);
    if (hours <= 0) return "gerade eben";
    return `vor ${hours} Std.`;
  }
  if (days === 1) return "gestern";
  if (days < 60) return `vor ${days} Tagen`;
  return `vor ${Math.round(days / 30)} Monaten`;
}

export function shortDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
}
