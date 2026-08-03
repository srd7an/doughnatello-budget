import { useEffect, useState } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useHousehold } from '../household/HouseholdContext'
import { usePeriod } from '../period/PeriodContext'
import { formatMoney, formatPercent } from '../lib/format'
import { Swatch } from '../ui/Swatch'
import { ChartTooltip, SERIES } from '../ui/ChartTooltip'
import { TransactionsList, type TxFilter } from './TransactionsList'
import { CategoriesList } from './CategoriesList'
import { DueSoon } from './DueSoon'

type Lens = 'transactions' | 'categories'

/** The segment under the pointer, and where to put its readout. */
type Hover = {
  label: string
  amount: number
  color: string
  x: number
  y: number
}

// Month zoom: FLOW over the selected month. Hero is income; the composition bar
// and metric row are the same Leftover · Expense · Savings, keyed together.
export function MonthView() {
  const { household } = useHousehold()
  const { year, month, label } = usePeriod()
  const monthKey = `${year}-${String(month).padStart(2, '0')}`

  const summary = useQuery(api.overview.month, {
    householdId: household._id,
    month: monthKey,
  })
  const rows = useQuery(api.transactions.listMonth, {
    householdId: household._id,
    month: monthKey,
  })

  const [lens, setLens] = useState<Lens>('transactions')
  const [hover, setHover] = useState<Hover | null>(null)
  const [filter, setFilter] = useState<TxFilter | null>(null)

  // A filter belongs to the month it was set in. Carrying "Rainy day" into
  // September, where nothing touched it, would look like data loss.
  useEffect(() => setFilter(null), [monthKey])

  /** Clicking a number means: show me the transactions behind it. */
  const show = (f: TxFilter) => {
    setFilter(f)
    setLens('transactions')
  }

  const now = new Date()
  const isCurrentMonth =
    year === now.getFullYear() && month === now.getMonth() + 1

  const income = summary?.income ?? 0
  const denom = Math.max(income, 1)
  const leftToSpend = summary?.leftToSpend ?? 0

  return (
    <div className="space-y-6">
      {/* Due items are about now, so they show only while reading this month. */}
      {isCurrentMonth && <DueSoon />}

      <section>
        <p className="text-sm text-stone-500">Income · {label}</p>
        <p className="tnum">
          <span className="text-[32px] leading-none text-stone-800">
            {formatMoney(income)}
          </span>
          <span className="ml-1 text-sm text-stone-500">RSD</span>
        </p>

        {/* Composition bar: Leftover · Expense · Savings, width = income.
            Each segment answers for itself on hover and focus; the metric row
            below is the same three figures, always visible. */}
        <div
          className="mt-3 flex h-5 gap-1"
          onPointerLeave={() => setHover(null)}
        >
          {income > 0 ? (
            <>
              {/* Leftover has no click: it is what did NOT happen, the
                  residue of the other two. There are no transactions behind
                  it to show. */}
              <Seg
                className="bg-leftover"
                color={SERIES.leftover}
                label={isCurrentMonth ? 'Left to spend' : 'Leftover'}
                amount={Math.max(leftToSpend, 0)}
                frac={Math.max(leftToSpend, 0) / denom}
                onHover={setHover}
              />
              <Seg
                className="bg-expense"
                color={SERIES.expense}
                label="Expense"
                amount={summary?.expense ?? 0}
                frac={(summary?.expense ?? 0) / denom}
                onHover={setHover}
                onSelect={() =>
                  show({ kind: 'direction', direction: 'expense', label: 'Expenses' })
                }
              />
              <Seg
                className="bg-saved"
                color={SERIES.saved}
                label="Savings"
                amount={summary?.savings ?? 0}
                frac={(summary?.savings ?? 0) / denom}
                onHover={setHover}
                onSelect={() =>
                  show({ kind: 'direction', direction: 'transfer', label: 'Money set aside' })
                }
              />
            </>
          ) : (
            <div className="w-full rounded-sm bg-stone-100" />
          )}
        </div>

        {hover && (
          <ChartTooltip
            x={hover.x}
            y={hover.y}
            title={label}
            rows={[
              {
                label: hover.label + (income > 0 ? ` · ${formatPercent(hover.amount / income)}` : ''),
                value: formatMoney(hover.amount),
                color: hover.color,
                lead: true,
              },
              { label: 'of income', value: formatMoney(income), color: SERIES.income },
            ]}
          />
        )}

        {/* Metric row = legend, keyed to the bar */}
        <div className="mt-4 flex flex-wrap gap-8">
          <Metric
            swatch="bg-leftover"
            label={isCurrentMonth ? 'Left to spend' : 'Leftover'}
            amount={leftToSpend}
            share={income > 0 ? leftToSpend / income : null}
          />
          <Metric
            swatch="bg-expense"
            label="Expense"
            amount={summary?.expense ?? 0}
            share={income > 0 ? (summary?.expense ?? 0) / income : null}
          />
          <Metric
            swatch="bg-saved"
            label="Savings"
            amount={summary?.savings ?? 0}
            share={income > 0 ? (summary?.savings ?? 0) / income : null}
          />
        </div>
      </section>

      {/* Lens row */}
      <div className="flex items-center gap-3">
        <div className="flex gap-3" role="tablist">
          <LensTab
            label="Transactions"
            active={lens === 'transactions'}
            onClick={() => setLens('transactions')}
          />
          <LensTab
            label="Categories"
            active={lens === 'categories'}
            onClick={() => setLens('categories')}
          />
        </div>
      </div>

      {lens === 'transactions' ? (
        <TransactionsList filter={filter} onClearFilter={() => setFilter(null)} />
      ) : (
        <CategoriesList
          rows={rows ?? []}
          paidFromFunds={summary?.paidFromFunds ?? 0}
        />
      )}
    </div>
  )
}

function Seg({
  className,
  color,
  label,
  amount,
  frac,
  onHover,
  onSelect,
}: {
  className: string
  color: string
  label: string
  amount: number
  frac: number
  onHover: (h: Hover | null) => void
  onSelect?: () => void
}) {
  const pct = Math.max(0, Math.min(1, frac)) * 100
  if (pct <= 0) return null
  // Keep a small segment visible so it never vanishes. Its WIDTH is still only
  // a few pixels when the share is tiny, which is why the value lives in the
  // aria-label and in the metric row rather than only under the pointer.
  return (
    <button
      type="button"
      aria-label={
        onSelect
          ? `${label} ${formatMoney(amount)} — show these transactions`
          : `${label} ${formatMoney(amount)}`
      }
      onClick={onSelect}
      onPointerMove={(e) =>
        onHover({ label, amount, color, x: e.clientX, y: e.clientY })
      }
      onFocus={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        onHover({ label, amount, color, x: r.left + r.width / 2, y: r.top })
      }}
      onBlur={() => onHover(null)}
      // The bar stays 20px because that is the design; on a phone the button
      // around it is 44px and transparent, so the thumb gets its target without
      // the mark growing to meet it. -my-3 keeps the row's own height at 20px.
      // A pointer does not need the extra reach, so from sm up it is gone.
      className={`-my-3 flex items-center py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:my-0 sm:py-0 ${
        onSelect ? 'cursor-pointer' : 'cursor-default'
      }`}
      style={{ width: `${Math.max(pct, 1.5)}%` }}
    >
      <span aria-hidden className={`h-5 w-full rounded-sm ${className}`} />
    </button>
  )
}

/**
 * One figure in the legend under the bar. It is a label, not a control: it
 * names a colour and states a number, and there is nothing to press. It was a
 * button so that Savings could expand into a per-fund breakdown, which made the
 * other two look pressable and did nothing when pressed.
 */
function Metric({
  swatch,
  label,
  amount,
  share,
}: {
  swatch: string
  label: string
  amount: number
  share: number | null
}) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-sm text-stone-500">
        {label}
        <Swatch className={swatch} />
      </p>
      <p className="tnum mt-0.5 text-sm">
        <span className="text-stone-800">{formatMoney(amount)}</span>
        {share !== null && (
          <span className="ml-1.5 text-stone-500">{formatPercent(share)}</span>
        )}
      </p>
    </div>
  )
}

function LensTab({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`min-h-11 text-base font-medium tracking-[-0.16px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
        active ? 'text-stone-800' : 'text-stone-500 hover:text-stone-700'
      }`}
    >
      {label}
    </button>
  )
}
