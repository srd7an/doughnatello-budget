import { useEffect, useRef, useState } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useHousehold } from '../household/HouseholdContext'
import { usePeriod } from '../period/PeriodContext'
import { formatMoney, formatPercent, monthName } from '../lib/format'
import { SM, useMediaQuery } from '../lib/useMediaQuery'
import { Swatch } from '../ui/Swatch'
import { CategoryIcon } from '../ui/icons'
import { ChartTooltip, SERIES } from '../ui/ChartTooltip'
import { TransactionsList, type TxFilter } from './TransactionsList'
import { CategoriesList } from './CategoriesList'
import { TagsList } from './TagsList'
import { Legend, type LegendItem } from './Legend'
import { StockTabs } from './StockTabs'
import { ComingUp, DueSoon } from './DueSoon'
import { MonthPace, PaceSpark, summarisePace } from './MonthPace'
import { Tile } from './Glance'

type Lens = 'transactions' | 'categories' | 'tags'

/** Which detail is open under the row of tiles. One at a time. */
type Panel = 'due' | 'pace' | null

/** The segment under the pointer, and where to put its readout. */
type Hover = {
  label: string
  amount: number
  color: string
  x: number
  y: number
}

const PANEL_KEY = 'month-panel'

/** The panel you last left open, on this device. A convenience and nothing
 *  more: storage that is missing or refuses is the same as never having
 *  chosen. */
function readPanel(): Panel | undefined {
  try {
    const v = window.localStorage.getItem(PANEL_KEY)
    return v === 'due' || v === 'pace' ? v : v === 'none' ? null : undefined
  } catch {
    return undefined
  }
}
function writePanel(p: Panel) {
  try {
    window.localStorage.setItem(PANEL_KEY, p ?? 'none')
  } catch {
    // Nothing to do: the choice simply does not outlive the page.
  }
}

// Month zoom: FLOW over the selected month.
//
// Read top to bottom it answers, in this order: what can I still spend; what
// became of the income; how do I stand — in the bank, against what is due,
// against a normal month; where did it go. Then the things you have, and then
// the list. Everything above the list fits on one screen, which is the point:
// it used to take three.
export function MonthView() {
  const { household } = useHousehold()
  const { year, month, label } = usePeriod()
  const monthKey = `${year}-${String(month).padStart(2, '0')}`
  const wide = useMediaQuery(SM)

  const now = new Date()
  const isCurrentMonth =
    year === now.getFullYear() && month === now.getMonth() + 1
  const lastOfMonth = `${monthKey}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`

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
  const categories = useQuery(api.overview.monthCategories, {
    householdId: household._id,
    month: monthKey,
    throughDay: isCurrentMonth ? now.getDate() : undefined,
  })
  // The next two are about NOW — what is in the account today, what is still
  // to be paid this month — and mean nothing under a month that is over.
  const outlook = useQuery(
    api.recurring.outlook,
    isCurrentMonth
      ? { householdId: household._id, through: lastOfMonth }
      : 'skip',
  )
  const balances = useQuery(
    api.overview.balances,
    isCurrentMonth ? { householdId: household._id } : 'skip',
  )

  const [lens, setLens] = useState<Lens>('transactions')
  const [hover, setHover] = useState<Hover | null>(null)
  const [filter, setFilter] = useState<TxFilter | null>(null)
  const lensRef = useRef<HTMLDivElement>(null)

  // The chart is open where there is room for it and shut where it would push
  // everything else off the screen — until you say otherwise, and then it is
  // however you left it.
  const [chosen, setChosen] = useState<Panel | undefined>(readPanel)
  const panel: Panel = chosen === undefined ? (wide ? 'pace' : null) : chosen
  const toggle = (p: Exclude<Panel, null>) => {
    const next = panel === p ? null : p
    setChosen(next)
    writePanel(next)
  }

  // A filter belongs to the month it was set in. Carrying "Rainy day" into
  // September, where nothing touched it, would look like data loss.
  useEffect(() => setFilter(null), [monthKey])

  /** Clicking a number means: show me the transactions behind it. */
  const show = (f: TxFilter) => {
    setFilter(f)
    setLens('transactions')
    // The list is a screen away from most of the things that filter it. A
    // click that changes something you cannot see has, as far as anyone can
    // tell, done nothing.
    lensRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
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

  const income = summary?.income ?? 0
  const expense = summary?.expense ?? 0
  const leftover = summary?.leftToSpend ?? 0
  const savings = summary?.savings ?? 0

  /**
   * What is still yours and already spoken for.
   *
   * `leftover` is income less what has HAPPENED. A bill that is due and not
   * yet confirmed has not happened, and neither has the one the rules will post
   * on the 25th — so leftover alone tells a month with its rent unpaid that it
   * has the rent to spend. This is that money: what is due, and what is still
   * to come by the last day, counting only what will come out of income.
   *
   * Only on the month you are in. A past month has no "still".
   */
  const dueNow = outlook?.due.fromIncome ?? 0
  const toCome = outlook?.upcoming.fromIncome ?? 0
  const reserved = isCurrentMonth ? dueNow + toCome : 0
  // The same rules, the other way: income they still expect this month. Left
  // out, a household whose salary is a rule would read as tens of thousands
  // short on the 3rd of every month — every bill of the month counted against
  // it and the pay that covers them not counted at all. The figure is where
  // the month is going to land, so it is given both halves of what is known.
  const expected = isCurrentMonth
    ? (outlook?.due.incoming ?? 0) + (outlook?.upcoming.incoming ?? 0)
    : 0
  const free = leftover - reserved + expected

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
  // The hatched part can only be as long as the leftover it is a part of. When
  // more is promised than is left, the headline goes negative and says so; the
  // bar cannot draw money that is not there.
  const reservedDrawn = Math.min(reserved, Math.max(leftover, 0))

  const legend: LegendItem[] = [
    { label: 'Income', amount: income, share: null },
    {
      swatch: 'bg-expense',
      label: 'Expense',
      amount: expense,
      share: income > 0 ? expense / income : null,
    },
    {
      swatch: 'bg-saved',
      label: 'Savings',
      amount: savings,
      share: income > 0 ? savings / income : null,
    },
  ]
  // The fourth share is the headline itself, and is not written out a second
  // time underneath it — unless part of it is spoken for, and then that part is
  // the line the headline does not carry.
  if (reserved > 0) {
    legend.push({
      swatch: 'bg-reserved',
      label: 'Still to pay',
      amount: reserved,
      share: income > 0 ? reserved / income : null,
    })
  }

  const paceSummary = pace && summarisePace(pace, year, month, isCurrentMonth)
  const dueCount = outlook?.due.count ?? 0
  const comingCount = outlook?.upcoming.count ?? 0
  const topCategories = categories?.slice(0, 3) ?? []

  return (
    <div className="space-y-8">
      <section>
        {/* The headline is what is LEFT, not what came in.
            Income is a fact about the past and there is nothing to do with it;
            what remains is the only figure on this screen you decide by — and
            on the month you are in, what remains after everything already
            promised, because that is the one you can act on. */}
        <p className="flex items-center gap-1.5 text-sm text-stone-500">
          {isCurrentMonth ? 'Left to spend' : 'Left from income'}
          <Swatch className="bg-leftover" />
        </p>
        <p className="tnum">
          {/* Short is said by the minus sign; the colour only agrees with it. */}
          <span
            className={`text-[32px] leading-none ${free < 0 ? 'text-debt' : 'text-stone-800'}`}
          >
            {formatMoney(free, { whole: true })}
          </span>
          {income > 0 && (
            <span className="ml-1.5 text-sm text-stone-500">
              {formatPercent(free / income)}
            </span>
          )}
        </p>
        {(reserved > 0 || expected > 0) && (
          // The working, in a line: the headline is not the leftover on the bar
          // below, and a figure that disagrees with the picture under it has to
          // say why before anyone asks.
          <p className="mt-1.5 text-sm text-stone-500">
            {reserved > 0 && 'after '}
            {dueNow > 0 && (
              <>
                <span data-money className="text-stone-700">
                  {formatMoney(dueNow, { whole: true })}
                </span>{' '}
                due now
              </>
            )}
            {dueNow > 0 && toCome > 0 && ' and '}
            {toCome > 0 && (
              <>
                <span data-money className="text-stone-700">
                  {formatMoney(toCome, { whole: true })}
                </span>{' '}
                still to come by {new Date(year, month, 0).getDate()}{' '}
                {monthName(month)}
              </>
            )}
            {expected > 0 && (
              <>
                {reserved > 0 ? ', counting ' : 'counting '}
                <span data-money className="text-stone-700">
                  {formatMoney(expected, { whole: true })}
                </span>{' '}
                of income still expected
              </>
            )}
          </p>
        )}

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
                  amount={Math.max(free, 0)}
                  frac={Math.max(free, 0) / denom}
                  onHover={setHover}
                />
                {/* The part of the leftover that is already spoken for. It
                  opens the list of what it is made of. */}
                {reservedDrawn > 0 && (
                  <Seg
                    className="bg-reserved"
                    color={SERIES.leftover}
                    label="Still to pay"
                    amount={reserved}
                    frac={reservedDrawn / denom}
                    onHover={setHover}
                    onSelect={() => {
                      setChosen('due')
                      writePanel('due')
                    }}
                    selectHint="show what is due"
                  />
                )}
                <Seg
                  className="bg-expense"
                  color={SERIES.expense}
                  label="Expense"
                  amount={expense}
                  frac={expense / denom}
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
            <Legend items={legend} />
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

      {/* How you stand, in three figures, before any scrolling: what is in the
          bank, what is still to pay, and whether this is a normal month. The
          last two open — the list of what is due, and the month day by day. */}
      <section className="space-y-3">
        <div
          className={`grid gap-2 ${isCurrentMonth ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-1'}`}
        >
          {isCurrentMonth && balances && (
            <Tile
              label="In the bank"
              value={formatMoney(balances.inBank, { whole: true })}
              note={
                balances.setAside > 0
                  ? `${formatMoney(balances.free, { whole: true })} outside funds`
                  : undefined
              }
            />
          )}
          {isCurrentMonth && outlook && (
            <Tile
              label="Still to pay"
              value={
                dueCount + comingCount > 0
                  ? formatMoney(
                      outlook.due.outgoing + outlook.upcoming.outgoing,
                      { whole: true },
                    )
                  : 'Nothing'
              }
              // Late is said in words and in the loan colour; never by the
              // colour alone.
              note={
                dueCount > 0
                  ? `${dueCount} due now${comingCount > 0 ? ` · ${comingCount} to come` : ''}`
                  : comingCount > 0
                    ? `${comingCount} to come`
                    : 'this month'
              }
              noteTone={dueCount > 0 ? 'text-debt' : undefined}
              open={panel === 'due'}
              onToggle={
                dueCount + comingCount > 0 ? () => toggle('due') : undefined
              }
            />
          )}
          {pace && paceSummary && paceSummary.lastDay > 0 && (
            <div
              className={
                isCurrentMonth ? 'col-span-2 grid sm:col-span-1' : 'grid'
              }
            >
              <Tile
                label={isCurrentMonth ? 'Spent so far' : 'Spent'}
                value={formatMoney(paceSummary.spent, { whole: true })}
                note={
                  paceSummary.diff === null ||
                  paceSummary.diffShare === null ? undefined : Math.abs(
                      paceSummary.diff,
                    ) < 100 ? (
                    'a typical month'
                  ) : (
                    <>
                      {paceSummary.diff > 0 ? '▲' : '▼'}{' '}
                      {formatPercent(paceSummary.diffShare)}{' '}
                      {paceSummary.diff > 0 ? 'over' : 'under'} typical
                    </>
                  )
                }
                noteTone={
                  paceSummary.diff !== null && Math.abs(paceSummary.diff) >= 100
                    ? paceSummary.diff > 0
                      ? 'text-status-over'
                      : 'text-status-under'
                    : undefined
                }
                open={panel === 'pace'}
                onToggle={() => toggle('pace')}
                aside={<PaceSpark data={pace} summary={paceSummary} />}
              />
            </div>
          )}
        </div>

        {panel === 'due' && isCurrentMonth && outlook && (
          <div className="space-y-3">
            {/* Due items are about now, so they show only while reading this
                month. */}
            <DueSoon />
            <ComingUp
              items={outlook.upcoming.items}
              through={outlook.through}
            />
          </div>
        )}
        {panel === 'pace' && pace && (
          <div className="rounded-2xl border border-stone-200 p-4">
            <MonthPace
              data={pace}
              year={year}
              month={month}
              isCurrentMonth={isCurrentMonth}
              onSelectDay={(day, dayLabel) =>
                show({ kind: 'day', day, label: `Spent ${dayLabel}` })
              }
            />
          </div>
        )}
      </section>

      {/* Where it went, without opening a tab to find out: the three largest
          categories, each against what a typical month had put there by now.
          The whole list is one press further, where it always was. */}
      {topCategories.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-base font-medium tracking-[-0.16px] text-stone-800">
              Where it went
            </h2>
            {(categories?.length ?? 0) > topCategories.length && (
              <button
                onClick={() => {
                  setLens('categories')
                  lensRef.current?.scrollIntoView?.({
                    behavior: 'smooth',
                    block: 'start',
                  })
                }}
                className="-my-3 py-3 text-sm text-brand underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                All {categories?.length} categories
              </button>
            )}
          </div>
          <ul className="grid gap-2 sm:grid-cols-3">
            {topCategories.map((c) => {
              const name = c.name ?? 'Uncategorised'
              const delta =
                c.typical !== null && c.typical > 0
                  ? (c.amount - c.typical) / c.typical
                  : null
              return (
                <li key={c.categoryId ?? 'none'} className="grid">
                  <button
                    onClick={() =>
                      show({
                        kind: 'category',
                        categoryId: c.categoryId,
                        label: name,
                      })
                    }
                    aria-label={`${name} ${formatMoney(c.amount)} — show these transactions`}
                    className="flex min-w-0 items-center gap-3 rounded-xl border border-stone-200 px-3 py-2.5 text-left hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                  >
                    <span
                      aria-hidden
                      className="grid size-9 shrink-0 place-items-center rounded-full"
                      style={{ backgroundColor: `${c.color ?? '#a8a29e'}1f` }}
                    >
                      <CategoryIcon
                        icon={c.icon ?? 'money'}
                        color={c.color ?? '#a8a29e'}
                        size={20}
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-stone-800">
                        {name}
                      </span>
                      <span
                        data-money
                        className="block truncate text-xs text-stone-400"
                      >
                        {delta === null ? (
                          expense > 0 ? (
                            `${formatPercent(c.amount / expense)} of spending`
                          ) : null
                        ) : Math.abs(delta) < 0.05 ? (
                          'about typical'
                        ) : (
                          <span
                            className={
                              delta > 0
                                ? 'text-status-over'
                                : 'text-status-under'
                            }
                          >
                            {delta > 0 ? '▲' : '▼'}{' '}
                            {formatPercent(Math.abs(delta))}{' '}
                            {delta > 0 ? 'over' : 'under'} typical
                          </span>
                        )}
                      </span>
                    </span>
                    <span data-money className="shrink-0 text-sm text-stone-800">
                      {formatMoney(c.amount, { whole: true })}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {stocks && (
        <StockTabs
          groups={stocks}
          period={isCurrentMonth ? 'this month' : `in ${monthName(month)}`}
        />
      )}

      {/* Lens row */}
      <div ref={lensRef} className="flex scroll-mt-20 items-center gap-3">
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
  selectHint = 'show these transactions',
}: {
  className: string
  color: string
  label: string
  amount: number
  frac: number
  onHover: (h: Hover | null) => void
  onSelect?: () => void
  /** What pressing it does, for the accessible name. */
  selectHint?: string
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
          ? `${label} ${formatMoney(amount)} — ${selectHint}`
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
