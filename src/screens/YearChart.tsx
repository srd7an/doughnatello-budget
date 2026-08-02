import { useState } from 'react'
import { formatMoney, formatPercent } from '../lib/format'
import { ChartTooltip, SERIES, type TooltipRow } from '../ui/ChartTooltip'

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
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const HEIGHT = 160

/**
 * Twelve columns, one per month. Column height is that month's income (absolute,
 * not normalised — hiding that income moved would defeat the point), drawn as a
 * dashed outline; the segments fill it exactly, bottom→top:
 * Savings · Expense · Leftover. A dashed average-income line crosses the
 * columns; the current month gets a marker. Future months are a dimmed label.
 *
 * Hovering or focusing a column reads out all four figures at once — the
 * pointer never has to find a 6px segment to get its number, and one readout
 * for the whole column is what makes the shape of a month legible. The hit
 * target is the full column, not the painted bar inside it.
 */
export function YearChart({
  months,
  currentMonthIndex,
}: {
  months: MonthDatum[]
  currentMonthIndex: number
}) {
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(
    null,
  )

  const maxIncome = Math.max(...months.map((m) => m.income), 1)
  const withIncome = months.filter((m) => m.income > 0)
  const avg =
    withIncome.length > 0
      ? withIncome.reduce((s, m) => s + m.income, 0) / withIncome.length
      : 0
  const avgBottom = (avg / maxIncome) * HEIGHT

  // The same four figures the tooltip shows, as a sentence — so the column's
  // aria-label carries them and no value lives only behind a pointer.
  const readout = (m: MonthDatum, i: number) =>
    `${MONTH_NAMES[i]}: income ${formatMoney(m.income)}, left ${formatMoney(
      m.leftToSpend,
    )}, expense ${formatMoney(m.expense)}, savings ${formatMoney(m.savings)}`

  const rowsFor = (m: MonthDatum): TooltipRow[] => {
    const share = (n: number) => (m.income > 0 ? ` · ${formatPercent(n / m.income)}` : '')
    return [
      { label: 'Income', value: formatMoney(m.income), color: SERIES.income, lead: true },
      {
        label: 'Left' + share(m.leftToSpend),
        value: formatMoney(m.leftToSpend),
        color: SERIES.leftover,
      },
      {
        label: 'Expense' + share(m.expense),
        value: formatMoney(m.expense),
        color: SERIES.expense,
      },
      {
        label: 'Savings' + share(m.savings),
        value: formatMoney(m.savings),
        color: SERIES.saved,
      },
    ]
  }

  return (
    <div>
      <div
        className="relative flex items-end gap-2"
        style={{ height: HEIGHT }}
        onPointerLeave={() => setHover(null)}
      >
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
          const leftoverH = Math.max((m.leftToSpend / maxIncome) * HEIGHT, 0)
          const active = hover?.i === i
          return (
            <button
              key={i}
              type="button"
              // A month with nothing in it has nothing to say.
              disabled={isFuture || h === 0}
              aria-label={readout(m, i)}
              onPointerMove={(e) => setHover({ i, x: e.clientX, y: e.clientY })}
              onFocus={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                setHover({ i, x: r.left + r.width / 2, y: r.top })
              }}
              onBlur={() => setHover(null)}
              className="relative flex flex-1 items-end justify-center rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              style={{ height: HEIGHT }}
            >
              {i === currentMonthIndex && (
                <div
                  aria-hidden
                  className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-stone-300"
                />
              )}
              {!isFuture && h > 0 && (
                <div
                  className={`relative flex w-3/5 flex-col overflow-hidden rounded-[3px] border border-dashed transition-colors ${
                    active ? 'border-stone-500' : 'border-stone-300'
                  }`}
                  style={{ height: Math.max(h, 2) }}
                >
                  <div className="bg-leftover" style={{ height: leftoverH }} />
                  <div className="bg-expense" style={{ height: expenseH }} />
                  <div className="bg-saved" style={{ height: savingsH }} />
                </div>
              )}
            </button>
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

      {hover && (
        <ChartTooltip
          x={hover.x}
          y={hover.y}
          title={MONTH_NAMES[hover.i]}
          rows={rowsFor(months[hover.i])}
        />
      )}
    </div>
  )
}
