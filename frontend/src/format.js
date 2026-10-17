const DASH = "—";

export const fmtNum = (n, digits = 2) =>
  n == null || Number.isNaN(n)
    ? DASH
    : n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const fmtCompact = (n) =>
  n == null ? DASH : Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 2 }).format(n);

export const fmtMoneyCompact = (n, currency = "USD") =>
  n == null
    ? DASH
    : Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        notation: "compact",
        maximumFractionDigits: 2,
      }).format(n);

/** Fractions (0.0123) -> "1.23%". */
export const fmtFraction = (f, digits = 2) => (f == null ? DASH : `${(f * 100).toFixed(digits)}%`);

/** Already-percent values (1.23) -> "+1.23%". */
export const fmtSignedPct = (p) => (p == null ? DASH : `${p > 0 ? "+" : ""}${p.toFixed(2)}%`);

export const fmtSigned = (n) => (n == null ? DASH : `${n > 0 ? "+" : ""}${fmtNum(n)}`);

export function fmtPrice(value, currency = "USD", isMarket = false) {
  if (value == null) return DASH;
  if (isMarket || currency !== "USD") return fmtNum(value);
  return `$${fmtNum(value)}`;
}

export const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : DASH;

export const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString() : DASH);

export function direction(change) {
  if (change == null || change === 0) return "flat";
  return change > 0 ? "up" : "down";
}

export const arrow = (dir) => (dir === "up" ? "▲" : dir === "down" ? "▼" : "•");
