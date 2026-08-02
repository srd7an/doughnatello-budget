/** Human labels for a recurring rule's schedule. Presentation only. */

export type Cadence = 'weekly' | 'monthly' | 'yearly'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function ordinal(n: number): string {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

/** "Monthly on the 10th", "Every 2 weeks", "Yearly on 5 March". */
export function cadenceLabel(
  cadence: Cadence,
  intervalCount: number,
  anchorDay: number,
  nextDueOn: string,
): string {
  const every = intervalCount > 1

  if (cadence === 'weekly') {
    return every ? `Every ${intervalCount} weeks` : 'Weekly'
  }
  if (cadence === 'monthly') {
    const when = anchorDay >= 29 ? 'on the last day' : `on the ${ordinal(anchorDay)}`
    return every ? `Every ${intervalCount} months ${when}` : `Monthly ${when}`
  }
  const month = MONTHS[Number(nextDueOn.slice(5, 7)) - 1]
  const when = `on ${anchorDay} ${month}`
  return every ? `Every ${intervalCount} years ${when}` : `Yearly ${when}`
}

/** "Due today" / "Due tomorrow" / "3 days late" / "Due 12 August". */
export function dueLabel(dueOn: string, today: string): string {
  if (dueOn === today) return 'Due today'
  const days = daysBetween(today, dueOn)
  if (days === 1) return 'Due tomorrow'
  if (days < 0) {
    const late = Math.abs(days)
    return late === 1 ? '1 day late' : `${late} days late`
  }
  const [, m, d] = dueOn.split('-').map(Number)
  return `Due ${d} ${MONTHS[m - 1]}`
}

function daysBetween(from: string, to: string): number {
  const [ay, am, ad] = from.split('-').map(Number)
  const [by, bm, bd] = to.split('-').map(Number)
  return Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000,
  )
}

/**
 * The date the LAST occurrence falls on, when a repeat is set to run a fixed
 * number of times.
 *
 * `total` counts the transaction being entered now as the first, because that
 * is what "repeats 12 times" means to a person — so a rule starting at the
 * second occurrence generates `total - 1` of them. Returns `startOn` itself for
 * a total of 2 (one now, one more).
 */
export function untilDateForCount(
  startOn: string,
  recurrence: { cadence: Cadence; intervalCount: number; anchorDay: number },
  total: number,
  next: (date: string, r: typeof recurrence) => string,
): string {
  const capped = Math.max(2, Math.min(Math.trunc(total) || 0, 600))
  let date = startOn
  for (let i = 2; i < capped; i++) date = next(date, recurrence)
  return date
}
