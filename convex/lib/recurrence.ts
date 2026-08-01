/**
 * Pure date arithmetic for recurring rules. No ctx, no Convex — so the awkward
 * cases (month-end anchors, leap days) are testable on their own.
 *
 * Every date is a YYYY-MM-DD string. All arithmetic goes through UTC so a
 * server timezone can never shift a due date by a day.
 */

export type Cadence = "weekly" | "monthly" | "yearly";

export type Recurrence = {
  cadence: Cadence;
  intervalCount: number;
  anchorDay: number; // 1-31
};

export function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function parseISO(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

export function toISO(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function addDays(iso: string, n: number): string {
  const { y, m, d } = parseISO(iso);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return toISO(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/**
 * The anchor day landed in a given month, clamped to that month's length.
 *
 * This is the rule that keeps a "31st" rule on the 31st: February pays on the
 * 28th, but the ANCHOR is still 31, so March pays on the 31st again. Clamping
 * the stored anchor instead of the previous date is what stops a month-end rule
 * from walking backwards to the 28th forever.
 */
export function clampToMonth(y: number, m: number, anchorDay: number): string {
  return toISO(y, m, Math.min(anchorDay, daysInMonth(y, m)));
}

/** The due date after `current` for this recurrence. */
export function nextDue(current: string, r: Recurrence): string {
  const { y, m } = parseISO(current);
  const step = Math.max(1, Math.trunc(r.intervalCount));

  if (r.cadence === "weekly") return addDays(current, 7 * step);

  if (r.cadence === "monthly") {
    // Month index arithmetic, so December + 1 rolls the year.
    const idx = y * 12 + (m - 1) + step;
    return clampToMonth(Math.floor(idx / 12), (idx % 12) + 1, r.anchorDay);
  }

  return clampToMonth(y + step, m, r.anchorDay);
}

/**
 * The first due date on or after `startOn`.
 *
 * Weekly rules simply start on the start date. Monthly/yearly ones try the
 * anchor inside the start month and roll forward one interval if that day has
 * already passed.
 */
export function firstDue(startOn: string, r: Recurrence): string {
  if (r.cadence === "weekly") return startOn;
  const { y, m } = parseISO(startOn);
  const candidate = clampToMonth(y, m, r.anchorDay);
  return candidate >= startOn ? candidate : nextDue(candidate, r);
}

/**
 * Every due date in (start, through], walking forward from `from` inclusive.
 * Bounded so a corrupt rule can never spin: 400 steps is ~33 years of monthly.
 */
export function dueDatesThrough(
  from: string,
  through: string,
  r: Recurrence,
  untilDate?: string,
): string[] {
  const out: string[] = [];
  let due = from;
  while (due <= through && (!untilDate || due <= untilDate) && out.length < 400) {
    out.push(due);
    due = nextDue(due, r);
  }
  return out;
}
