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

// Thousands separated by "," and decimals by "." — 44,413.50. Note this is NOT
// the sr-RS convention (which is the reverse, 44.413,50); it is the format the
// app was asked for. Both live behind these two formatters, so switching back
// is a one-line change here and nowhere else.
const dinarsFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const dinarsDecimalFmt = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const percentFmt = new Intl.NumberFormat("en-US", {
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
 * Format stored para as grouped dinars: 4441300 → "44,413", 123450 → "1,234.50".
 *
 * Decimals appear only when there ARE any. A whole amount reads as a whole
 * number (the design's figures are all whole), but a stored 50 para is never
 * hidden — rounding it away would show a figure that does not match the money.
 * Pass `signed` to force a leading + for positives; negatives always show minus.
 */
export function formatMoney(
  para: number,
  opts: { signed?: boolean } = {},
): string {
  const rounded = Math.round(para);
  const abs = Math.abs(rounded);
  const body =
    abs % 100 === 0
      ? dinarsFmt.format(abs / 100)
      : dinarsDecimalFmt.format(abs / 100);
  if (rounded < 0) return `${MINUS}${body}`;
  if (opts.signed && rounded > 0) return `+${body}`;
  return body;
}

/**
 * Typed money → stored para, and back.
 *
 * One decimal point, digits either side, nothing else — sanitising as the user
 * types rather than validating on submit, so a field can never hold something
 * that is not a number. `paraToInput` is the inverse for populating a field:
 * it keeps sub-unit precision and drops a pointless ".00".
 */
export function sanitizeMoneyInput(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot === -1) return cleaned;
  const whole = cleaned.slice(0, firstDot);
  const rest = cleaned.slice(firstDot + 1).replace(/\./g, "");
  return `${whole}.${rest.slice(0, 2)}`;
}

export function inputToPara(text: string): number {
  const n = Number(sanitizeMoneyInput(text));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function paraToInput(para: number): string {
  if (para === 0) return "";
  const abs = Math.abs(para);
  const sign = para < 0 ? "-" : "";
  return abs % 100 === 0
    ? `${sign}${abs / 100}`
    : `${sign}${(abs / 100).toFixed(2)}`;
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
