import type { ReactNode } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useHousehold } from '../household/HouseholdContext'
import { usePeriod } from '../period/PeriodContext'
import { formatMoney, formatPercent, monthName } from '../lib/format'
import { formatDayMonthYear } from '../lib/dates'
import { Popover } from '../ui/Popover'
import { CaretDownIcon } from '../ui/icons'
import { YearChart } from './YearChart'
import { NetWorthLine } from './NetWorthLine'
import { Tile } from './Glance'
import { Legend } from './Legend'
import { StockTabs } from './StockTabs'
import { CategoriesList } from './CategoriesList'
import { TagsList } from './TagsList'

// Year zoom: FLOW over twelve months. Hero is net worth (a stock, deliberately
// the one exception on this flow screen), with the year's change beside it. The
// chart shows the path; the accordion rows show the endpoints.
export function YearView() {
  const { household } = useHousehold()
  const { year, month, openMonth } = usePeriod()
  const yearKey = String(year)

  const data = useQuery(api.overview.year, {
    householdId: household._id,
    year: yearKey,
  })
  const rows = useQuery(api.transactions.listYear, {
    householdId: household._id,
    year: yearKey,
  })

  const now = new Date()
  const currentMonthIndex =
    year === now.getFullYear()
      ? now.getMonth()
      : year < now.getFullYear()
        ? 11
        : -1

  if (data === undefined) {
    return <p className="py-8 text-center text-sm text-stone-400">Loading…</p>
  }

  const change = data.netWorthChange
  const income = data.totals.income

  // The year in three figures, for reading before the twelve columns: what a
  // month costs, how much of the income was kept, and which month to go and
  // look at. A month with nothing in it is not averaged in — December, in
  // June, is not a month that cost nothing.
  const lived = data.months.filter((m) => m.income > 0 || m.expense > 0)
  const averageSpend =
    lived.length > 0 ? data.totals.expense / lived.length : null
  const dearest = data.months.reduce(
    (best, m, i) => (m.expense > data.months[best].expense ? i : best),
    0,
  )

  return (
    <div className="space-y-8">
      <section>
        <p className="text-sm text-stone-500">Net worth</p>
        <p className="tnum flex flex-wrap items-baseline gap-x-2">
          <span className="text-[32px] leading-none text-stone-800">
            {formatMoney(data.netWorth, { whole: true })}
          </span>
          {change !== 0 && (
            <ChangeExplained
              netWorth={data.netWorth}
              change={change}
              parts={data.netWorthParts}
              bank={data.bank}
              assets={data.assets.balance}
              loans={data.loans.balance}
              funds={data.funds.balance}
            />
          )}
        </p>
        {/* The headline's own picture. Absent from a fixture or an old
            deployment that does not send it, and then simply not drawn. */}
        {data.netWorthByMonth && (
          <NetWorthLine
            values={data.netWorthByMonth}
            opening={data.netWorthParts.opening}
          />
        )}
      </section>

      {/* A second subject, and so a second heading. The columns are what the
          year's INCOME became — not net worth — and sat directly under the
          net-worth figure as though they were its chart. */}
      <section>
        <h2 className="mb-3 text-base font-medium tracking-[-0.16px] text-stone-800">
          Income and spending
        </h2>

        {lived.length > 0 && (
          <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {averageSpend !== null && (
              <Tile
                label="A month costs"
                value={formatMoney(averageSpend, { whole: true })}
                note={`on average, over ${lived.length}`}
              />
            )}
            {income > 0 && (
              <Tile
                label="Kept"
                value={formatPercent(
                  (data.totals.savings + data.totals.leftToSpend) / income,
                )}
                note="of income not spent"
              />
            )}
            {data.months[dearest].expense > 0 && (
              <div className="col-span-2 grid sm:col-span-1">
                <Tile
                  label="Most expensive"
                  value={monthName(dearest + 1)}
                  note={formatMoney(data.months[dearest].expense, {
                    whole: true,
                  })}
                  onGo={() => openMonth(year, dearest + 1)}
                />
              </div>
            )}
          </div>
        )}

        {/* Same stack and same two orders as the month: key before picture
            where there is room, picture against its headline where there is
            not. */}
        <div className="flex flex-col gap-4">
          {/* The twelve columns are navigation: click one to zoom into it. */}
          <div className="order-1 sm:order-2">
            <YearChart
              months={data.months}
              currentMonthIndex={currentMonthIndex}
              fromMonthIndex={month - 1}
              onOpenMonth={(i) => openMonth(year, i + 1)}
            />
          </div>

          <div className="order-2 sm:order-1">
            <Legend
              items={[
                { label: 'Income', amount: data.totals.income, share: null },
                {
                  swatch: 'bg-expense',
                  label: 'Expense',
                  amount: data.totals.expense,
                  share: income > 0 ? data.totals.expense / income : null,
                },
                {
                  swatch: 'bg-saved',
                  label: 'Savings',
                  amount: data.totals.savings,
                  share: income > 0 ? data.totals.savings / income : null,
                },
                {
                  swatch: 'bg-leftover',
                  label: 'Leftover',
                  amount: data.totals.leftToSpend,
                  share: income > 0 ? data.totals.leftToSpend / income : null,
                },
              ]}
            />
          </div>
        </div>
      </section>

      {/* The same three groups the month shows, in the same component. They
          were an accordion of Change and Total columns here and a row of chips
          there, which was two answers to one question — and the columns could
          not survive a phone, while cards simply scroll. */}
      <StockTabs
        groups={{
          funds: data.funds.items,
          loans: data.loans.items,
          assets: data.assets.items,
        }}
        period={year === now.getFullYear() ? 'this year' : `in ${year}`}
      />

      <section>
        <h2 className="mb-3 text-base font-medium tracking-[-0.16px] text-stone-800">
          Categories
        </h2>
        <CategoriesList rows={rows ?? []} />
      </section>

      {/* The year is the zoom a tag is actually read at: a holiday runs from
          the booking in March to the last card payment in September, and this
          is the first screen wide enough to hold the whole of it. Only when
          the year has some — a heading over nothing is a heading you learn to
          scroll past. */}
      {!!rows?.some((r) => r.tags.length > 0) && (
        <section>
          <h2 className="mb-3 text-base font-medium tracking-[-0.16px] text-stone-800">
            Tags
          </h2>
          <TagsList rows={rows} />
        </section>
      )}
    </div>
  )
}

/**
 * The hero, and where both halves of it come from.
 *
 *   WHAT IT IS       bank + assets − debt, today
 *   WHAT CHANGED     that same sheet, today, less the one from the last day
 *                    of last year — line by line
 *
 * The change is a DIFFERENCE OF TWO BALANCE SHEETS, not a sum of the year's
 * flows, and the panel is written that way because the flow version cannot be
 * checked and quietly disagrees at the edges. Here every line is "what this
 * was then, what it is now", and the three of them are the change by
 * construction.
 *
 * The Loans line is the one that needs saying out loud: net worth went up by
 * money that is GONE from the account. It is in the total because the debt
 * left with it, not because it is still yours to spend — which is exactly the
 * objection anyone has to this figure the first time they see it.
 *
 * Funds are deliberately NOT a line in the first sum. Money set aside in a
 * fund is money in the account; a fund is a partition of `bank`, not a thing
 * beside it, and adding the two is the double count the query is written to
 * avoid. It is named in the note instead, because "why is my fund not in
 * here?" is the question the panel would otherwise leave hanging.
 *
 * A popover, not a page: it is a reading of a figure already on screen, and
 * nothing here can be acted on.
 */
function ChangeExplained({
  netWorth,
  change,
  parts,
  bank,
  assets,
  loans,
  funds,
}: {
  netWorth: number
  change: number
  parts: {
    openedOn: string
    opening: number
    closing: number
    bank: number
    assets: number
    loans: number
  }
  bank: number
  assets: number
  /** Negative: what is still owed. */
  loans: number
  /** Only to decide whether the note about funds is worth saying. */
  funds: number
}) {
  const tone = change > 0 ? 'text-gain' : 'text-debt'
  return (
    <Popover
      label="What net worth is made of"
      align="left"
      // Padding out and margin back in: the tap target is 44px tall while the
      // paint stays exactly the inline figure it was, so the hero line does not
      // grow a band of empty space around a word.
      triggerClassName={`-my-3 inline-flex items-center gap-1 rounded py-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${tone}`}
      trigger={
        <>
          {formatMoney(change, { signed: true, whole: true })} this year
          <CaretDownIcon size={12} aria-hidden />
        </>
      }
    >
      {() => (
        <div className="w-72 max-w-[min(20rem,calc(100vw-2rem))]">
          <Block title="Net worth today">
            <Part label="Bank" amount={bank} signed={false} />
            {assets !== 0 && (
              <Part label="Assets" amount={assets} signed={false} />
            )}
            {loans !== 0 && (
              <Part label="Loans" amount={loans} signed={false} />
            )}
            <Total label="Net worth" amount={netWorth} />
          </Block>

          {funds !== 0 && (
            <Note>
              A fund is not a line of its own: money you have set aside is still
              money in the account, so it is already inside Bank.
            </Note>
          )}

          <Block
            title={`Since ${formatDayMonthYear(parts.openedOn)}`}
            className="mt-4"
          >
            {/* The three lines of the sheet above, each as far as it moved.
                They add up to the change by construction — it IS their sum.
                The figure they are measured FROM is in the note rather than in
                the column, because a stock sitting among three movements looks
                like a fourth term and adds up to nothing. */}
            <Part label="Bank" amount={parts.bank} />
            {parts.assets !== 0 && (
              <Part label="Assets" amount={parts.assets} />
            )}
            {parts.loans !== 0 && <Part label="Loans" amount={parts.loans} />}
            <Total label="Change" amount={change} tone={tone} signed />
          </Block>

          <Note>
            On {formatDayMonthYear(parts.openedOn)} you were worth{' '}
            <span data-money className="tnum">
              {formatMoney(parts.opening)}
            </span>
            .{' '}
            {parts.loans > 0 && (
              <>
                The Loans line is debt you paid off since: that money is gone
                from the account, and is here because the debt went with it —
                not because you still have it.
              </>
            )}
          </Note>
        </div>
      )}
    </Popover>
  )
}

function Block({
  title,
  className = '',
  children,
}: {
  title: string
  className?: string
  children: ReactNode
}) {
  return (
    <section className={className}>
      <p className="px-1 pb-1 text-xs font-medium tracking-wide text-stone-400 uppercase">
        {title}
      </p>
      <dl className="text-sm">{children}</dl>
    </section>
  )
}

/** One term of a sum. In the flow the sign is the point and is always drawn;
 *  in the stock it is not — a bank balance is not "+2.234.943". */
function Part({
  label,
  amount,
  signed = true,
}: {
  label: string
  amount: number
  signed?: boolean
}) {
  return (
    <div className="flex items-center gap-3 px-1 py-1">
      <dt className="min-w-0 flex-1 text-stone-600">{label}</dt>
      <dd data-money className="tnum shrink-0 text-stone-800">
        {formatMoney(amount, { signed })}
      </dd>
    </div>
  )
}

/** What the terms above it come to, under a rule. */
function Total({
  label,
  amount,
  tone = 'text-stone-800',
  signed = false,
}: {
  label: string
  amount: number
  tone?: string
  signed?: boolean
}) {
  return (
    <div className="mt-1 flex items-center gap-3 border-t border-stone-200 px-1 pt-2">
      <dt className="min-w-0 flex-1 text-stone-800">{label}</dt>
      <dd data-money className={`tnum shrink-0 ${tone}`}>
        {formatMoney(amount, { signed })}
      </dd>
    </div>
  )
}

/** The small print under a sum: what it left out, and why. */
function Note({ children }: { children: ReactNode }) {
  return (
    <p className="mt-2 px-1 text-xs leading-relaxed text-stone-500">
      {children}
    </p>
  )
}
