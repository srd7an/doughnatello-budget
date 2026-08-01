/**
 * The single money/number formatting boundary.
 *
 * Money is stored as integer para (1 RSD = 100 para) everywhere in the app and
 * in Convex — never as a float. Conversion to a human string happens ONLY here,
 * at the UI edge. If you find yourself dividing by 100 in a component, call one
 * of these instead.
 *
 * Serbian formatting: thousands separated by ".", decimals by "," → 44.413 and
 * 13,7%. Numbers use `sr-RS` (spec-mandated). Month names use `sr-Latn-RS` so
 * they read in Latin script alongside the app's Latin UI.
 */

const dinarsFmt = new Intl.NumberFormat("sr-RS", { maximumFractionDigits: 0 });
const percentFmt = new Intl.NumberFormat("sr-RS", {
  style: "percent",
  maximumFractionDigits: 1,
});
// Period labels read in English ("July 2026") per the design; only the money
// and percentage figures use Serbian formatting.
const monthFmt = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
});

const MINUS = "−"; // proper minus sign, not a hyphen

/** UI dinars → stored para. Use when saving a user-entered amount. */
export function toPara(dinars: number): number {
  return Math.round(dinars * 100);
}

/** Stored para → dinars (number). Prefer formatMoney for display. */
export function fromPara(para: number): number {
  return para / 100;
}

/**
 * Format stored para as grouped dinars, e.g. 4441300 → "44.413".
 * RSD is shown without decimals. Pass `signed` to force a leading + for
 * positives (period-change figures); negatives always show a minus.
 */
export function formatMoney(
  para: number,
  opts: { signed?: boolean } = {},
): string {
  const dinars = Math.round(para / 100);
  const body = dinarsFmt.format(Math.abs(dinars));
  if (dinars < 0) return `${MINUS}${body}`;
  if (opts.signed && dinars > 0) return `+${body}`;
  return body;
}

/** Format a fraction (0..1) as a Serbian percentage: 0.137 → "13,7%". */
export function formatPercent(fraction: number): string {
  return percentFmt.format(fraction);
}

/** Format a stored whole-number percent (e.g. 25 → "25%") for budget targets. */
export function formatPercentPoints(points: number): string {
  return formatPercent(points / 100);
}

/** Month + year label, English: (2026, 7) → "July 2026". */
export function formatMonth(year: number, month1to12: number): string {
  return monthFmt.format(new Date(year, month1to12 - 1, 1));
}

/** Two-letter-ish initials from a display name for member avatars. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
