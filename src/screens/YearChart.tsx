import { formatMoney } from '../lib/format'

type MonthDatum = {
  income: number
  expense: number
  savings: number
  leftToSpend: number
}

const LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]
const HEIGHT = 160

/**
 * Twelve columns, one per month. Column height is that month's income (absolute,
 * not normalised — hiding that income moved would defeat the point), drawn as a
 * dashed outline; the segments fill it exactly, bottom→top:
 * Savings · Expense · Leftover. A dashed average-income line crosses the
 * columns; the current month gets a marker. Future months are a dimmed label.
 */
export function YearChart({
  months,
  currentMonthIndex,
}: {
  months: MonthDatum[]
  currentMonthIndex: number
}) {
  const maxIncome = Math.max(...months.map((m) => m.income), 1)
  const withIncome = months.filter((m) => m.income > 0)
  const avg =
    withIncome.length > 0
      ? withIncome.reduce((s, m) => s + m.income, 0) / withIncome.length
      : 0
  const avgBottom = (avg / maxIncome) * HEIGHT

  return (
    <div>
      <div className="relative flex items-end gap-2" style={{ height: HEIGHT }}>
        {/* Average income line */}
        {avg > 0 && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-stone-300"
            style={{ bottom: avgBottom }}
          />
        )}

        {months.map((m, i) => {
          const isFuture = i > currentMonthIndex && m.income === 0
          const h = (m.income / maxIncome) * HEIGHT
          const savingsH = (m.savings / maxIncome) * HEIGHT
          const expenseH = (m.expense / maxIncome) * HEIGHT
          const leftoverH = Math.max(
            (m.leftToSpend / maxIncome) * HEIGHT,
            0,
          )
          return (
            <div
              key={i}
              className="relative flex flex-1 items-end justify-center"
              style={{ height: HEIGHT }}
              title={m.income > 0 ? formatMoney(m.income) : undefined}
            >
              {i === currentMonthIndex && (
                <div
                  aria-hidden
                  className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-stone-300"
                />
              )}
              {!isFuture && h > 0 && (
                <div
                  className="relative flex w-3/5 flex-col overflow-hidden rounded-[3px] border border-dashed border-stone-300"
                  style={{ height: Math.max(h, 2) }}
                >
                  <div className="bg-leftover" style={{ height: leftoverH }} />
                  <div className="bg-expense" style={{ height: expenseH }} />
                  <div className="bg-saved" style={{ height: savingsH }} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Month labels */}
      <div className="mt-2 flex gap-2">
        {LABELS.map((label, i) => (
          <div
            key={label}
            className={`flex-1 text-center text-xs ${
              i > currentMonthIndex ? 'text-stone-300' : 'text-stone-500'
            }`}
          >
            {label}
          </div>
        ))}
      </div>
    </div>
  )
}
