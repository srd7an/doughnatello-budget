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
import { TagsList } from './TagsList'
import { Legend } from './Legend'
import { StockTabs } from './StockTabs'
import { DueSoon } from './DueSoon'
import { MonthPace } from './MonthPace'

type Lens = 'transactions' | 'categories' | 'tags'

/** The segment under the pointer, and where to put its readout. */
type Hover = {
  label: string
  amount: number
  color: string
  x: number
  y: number
}

// Month zoom: FLOW over the selected month. Hero is income; the metric row and
// the composition bar are the same Leftover · Expense · Savings, keyed
// together and read in that order — headline, key, picture, as on the year.
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
  const stocks = useQuery(api.overview.monthStocks, {
    householdId: household._id,
    month: monthKey,
  })

  // How the month got to where the bar says it ended: spending day by day,
  // against a typical month.
  const pace = useQuery(api.overview.monthPace, {
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

  // Categories with spending in them, which is what that list draws — not how
  // many categories exist. Undefined while the rows are still loading, so the
  // tab shows no count rather than a confident zero.
  const categoryCount =
    rows &&
    new Set(
      rows
        .filter((r) => r.direction === 'expense')
        .map((r) => r.categoryId ?? 'none'),
    ).size

  // How many different tags this month touched — not how many exist. A tag
  // that had nothing happen in July is not part of July.
  const tagCount =
    rows && new Set(rows.flatMap((r) => r.tags.map((t) => t._id))).size

  const now = new Date()
  const isCurrentMonth =
    year === now.getFullYear() && month === now.getMonth() + 1

  const income = summary?.income ?? 0
  const leftToSpend = summary?.leftToSpend ?? 0
  const savings = summary?.savings ?? 0

  /**
   * The bar is as wide as the money the month DISPOSED of, which is not always
   * what it earned.
   *
   * Savings goes negative when more came out of the funds than went into them —
   * a bill the fund was built for, or a month that did not fit. Either way the
   * month spent past its own income, and the bar says so by running past the
   * income mark rather than by squeezing everything back inside it.
   */
  const overspent = Math.max(-savings, 0)
  const denom = Math.max(income + overspent, 1)

  return (
    <div className="space-y-8">
      {/* Due items are about now, so they show only while reading this month. */}
      {isCurrentMonth && <DueSoon />}

      <section>
        {/* The headline is what is LEFT, not what came in.
            Income is a fact about the past and there is nothing to do with it;
            what remains is the only figure on this screen you decide by. It
            keeps its place in the key below, where it is the thing the other
            three are shares OF. */}
        <p className="flex items-center gap-1.5 text-sm text-stone-500">
          {isCurrentMonth ? 'Left to spend' : 'Left from income'}
          <Swatch className="bg-leftover" />
        </p>
        <p className="tnum">
          <span className="text-[32px] leading-none text-stone-800">
            {formatMoney(leftToSpend)}
          </span>
          {income > 0 && (
            <span className="ml-1.5 text-sm text-stone-500">
              {formatPercent(leftToSpend / income)}
            </span>
          )}
        </p>

        {/* One stack, two orders. Wide, the key reads before the picture;
            narrow, the bar sits against the headline it summarises and the
            detail goes underneath. 16px between them, and 16px from the
            headline above. */}
        <div className="mt-4 flex flex-col gap-4">
          <div
            className="relative order-1 flex h-5 gap-1 sm:order-2"
            onPointerLeave={() => setHover(null)}
          >
            {/* The frame IS the income: the segments are what became of it, and
              the outline is how much there was to become anything. Drawn around
              them rather than behind, so a month that overspent has segments
              visibly running out past their own frame — which is the whole
              story of that month in one shape. */}
            {income > 0 && (
              <span
                aria-hidden
                className="pointer-events-none absolute -inset-y-1 -left-1 z-10 rounded-lg border border-stone-300"
                style={{ width: `calc(${(income / denom) * 100}% + 0.5rem)` }}
              />
            )}
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
                    show({
                      kind: 'direction',
                      direction: 'expense',
                      label: 'Expenses',
                    })
                  }
                />
                {/* Only when it is positive. A negative saving is not a slice of
                  this bar — it is the reason the bar is longer than the income,
                  and it is already drawn as the part of Expense that reaches
                  past the mark. */}
                {savings > 0 && (
                  <Seg
                    className="bg-saved"
                    color={SERIES.saved}
                    label="Savings"
                    amount={savings}
                    frac={savings / denom}
                    onHover={setHover}
                    onSelect={() =>
                      show({
                        kind: 'direction',
                        direction: 'transfer',
                        label: 'Money set aside',
                      })
                    }
                  />
                )}
              </>
            ) : (
              <div className="w-full rounded-sm bg-stone-100" />
            )}
          </div>

          <div className="order-2 sm:order-1">
            <Legend
              items={[
                { label: 'Income', amount: income, share: null },
                {
                  swatch: 'bg-expense',
                  label: 'Expense',
                  amount: summary?.expense ?? 0,
                  share: income > 0 ? (summary?.expense ?? 0) / income : null,
                },
                {
                  swatch: 'bg-saved',
                  label: 'Savings',
                  amount: savings,
                  share: income > 0 ? savings / income : null,
                },
                {
                  swatch: 'bg-leftover',
                  label: isCurrentMonth ? 'Left to spend' : 'Leftover',
                  amount: leftToSpend,
                  share: income > 0 ? leftToSpend / income : null,
                },
              ]}
            />
          </div>
        </div>

        {hover && (
          <ChartTooltip
            x={hover.x}
            y={hover.y}
            title={label}
            rows={[
              {
                label:
                  hover.label +
                  (income > 0
                    ? ` · ${formatPercent(hover.amount / income)}`
                    : ''),
                value: formatMoney(hover.amount),
                color: hover.color,
                lead: true,
              },
              {
                label: 'of income',
                value: formatMoney(income),
                color: SERIES.income,
              },
            ]}
          />
        )}
      </section>

      {pace && (
        <MonthPace
          data={pace}
          year={year}
          month={month}
          isCurrentMonth={isCurrentMonth}
          onSelectDay={(day, dayLabel) =>
            show({ kind: 'day', day, label: `Spent ${dayLabel}` })
          }
        />
      )}

      {stocks && <StockTabs groups={stocks} />}

      {/* Lens row */}
      <div className="flex items-center gap-3">
        <div className="flex gap-3" role="tablist">
          {/* How much is behind each tab, before you open it — and, on
              Transactions, the number the filter chip is a fraction of. The
              count is the month's, not the filtered view's: a chip that reads
              "of 47" only means something if 47 is what the tab claims. */}
          <LensTab
            label="Transactions"
            count={rows?.length}
            active={lens === 'transactions'}
            onClick={() => setLens('transactions')}
          />
          <LensTab
            label="Categories"
            count={categoryCount}
            active={lens === 'categories'}
            onClick={() => setLens('categories')}
          />
          {/* Only once there is something to see. A third tab that is always
              empty teaches you to stop looking at it. */}
          {!!tagCount && (
            <LensTab
              label="Tags"
              count={tagCount}
              active={lens === 'tags'}
              onClick={() => setLens('tags')}
            />
          )}
        </div>
      </div>

      {lens === 'transactions' ? (
        <TransactionsList
          filter={filter}
          onClearFilter={() => setFilter(null)}
        />
      ) : lens === 'tags' ? (
        <TagsList rows={rows ?? []} />
      ) : (
        <CategoriesList rows={rows ?? []} />
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
function LensTab({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  /** Undefined until it is known — the tab must not flash a zero. */
  count?: number
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
      {count !== undefined && (
        // A figure, so it wears the mono face like every other figure — and one
        // weight lighter than the label, because it is not what the tab is
        // called, it is how much is in it.
        <span data-money className="ml-1 font-normal text-stone-400">
          ({count})
        </span>
      )}
    </button>
  )
}
