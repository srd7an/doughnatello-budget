import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useHousehold } from '../household/HouseholdContext'
import { usePeriod } from '../period/PeriodContext'
import { formatMoney } from '../lib/format'
import { Popover } from '../ui/Popover'
import { CaretDownIcon } from '../ui/icons'
import { YearChart } from './YearChart'
import { Legend } from './Legend'
import { StockTabs } from './StockTabs'
import { CategoriesList } from './CategoriesList'

// Year zoom: FLOW over twelve months. Hero is net worth (a stock, deliberately
// the one exception on this flow screen), with the year's change beside it. The
// chart shows the path; the accordion rows show the endpoints.
export function YearView() {
  const { household } = useHousehold()
  const { year, openMonth } = usePeriod()
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
    year === now.getFullYear() ? now.getMonth() : year < now.getFullYear() ? 11 : -1

  if (data === undefined) {
    return <p className="py-8 text-center text-sm text-stone-400">Loading…</p>
  }

  const change = data.netWorthChange
  const income = data.totals.income

  return (
    <div className="space-y-8">
      <section>
        <p className="text-sm text-stone-500">Net worth</p>
        <p className="tnum flex items-baseline gap-2">
          <span className="text-[32px] leading-none text-stone-800">
            {formatMoney(data.netWorth)}
          </span>
          {change !== 0 && (
            <ChangeExplained change={change} parts={data.netWorthParts} />
          )}
        </p>
      </section>

      {/* Same stack and same two orders as the month: key before picture where
          there is room, picture against its headline where there is not. */}
      <div className="flex flex-col gap-4">
        {/* The twelve columns are navigation: click one to zoom into it. */}
        <div className="order-1 sm:order-2">
        <YearChart
          months={data.months}
          currentMonthIndex={currentMonthIndex}
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
      />

      <section>
        <h2 className="mb-3 text-base font-medium tracking-[-0.16px] text-stone-800">
          Categories
        </h2>
        <CategoriesList rows={rows ?? []} />
      </section>
    </div>
  )
}

/**
 * The year's change, and where it came from.
 *
 * This figure is the one number on the screen nobody can check. Income and
 * Expense sit right underneath it and do NOT subtract to it — a loan payment
 * is in one and not the other, and a flat that went up in value is in neither
 * — so the honest thing is to let the number show its own working rather than
 * leave the arithmetic looking wrong.
 *
 * A popover, not a page: it is a reading of a figure already on screen, and
 * nothing here can be acted on.
 */
function ChangeExplained({
  change,
  parts,
}: {
  change: number
  parts: {
    income: number
    spending: number
    revaluation: number
    loanPayments: number
  }
}) {
  const tone = change > 0 ? 'text-gain' : 'text-debt'
  return (
    <Popover
      label="How this year's change is made up"
      align="left"
      // Padding out and margin back in: the tap target is 44px tall while the
      // paint stays exactly the inline figure it was, so the hero line does not
      // grow a band of empty space around a word.
      triggerClassName={`-my-3 inline-flex items-center gap-1 rounded py-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${tone}`}
      trigger={
        <>
          {formatMoney(change, { signed: true })} this year
          <CaretDownIcon size={12} aria-hidden />
        </>
      }
    >
      {() => (
        <div className="w-72 max-w-[min(20rem,calc(100vw-2rem))]">
          <p className="px-1 pb-1 text-xs font-medium tracking-wide text-stone-400 uppercase">
            Net worth change
          </p>
          <dl className="text-sm">
            <Part label="Income" amount={parts.income} />
            <Part label="Spending" amount={-parts.spending} />
            {/* Only when the things you own actually moved. A row of zero
                revaluation on a household with no assets explains nothing. */}
            {parts.revaluation !== 0 && (
              <Part label="Assets revalued" amount={parts.revaluation} />
            )}
            <div className="mt-1 flex items-center gap-3 border-t border-stone-200 px-1 pt-2">
              <dt className="min-w-0 flex-1 text-stone-800">This year</dt>
              <dd data-money className={`tnum shrink-0 ${tone}`}>
                {formatMoney(change, { signed: true })}
              </dd>
            </div>
          </dl>
          <p className="mt-2 px-1 text-xs leading-relaxed text-stone-500">
            {parts.loanPayments > 0 ? (
              <>
                Loan payments (
                <span data-money className="tnum">
                  {formatMoney(parts.loanPayments)}
                </span>
                ) are not counted as spending here: the money left your account
                and your debt shrank by exactly as much. Money moved into a fund
                is left out for the same reason — it is still yours.
              </>
            ) : (
              'Money moved into a fund is left out: it is still yours, just in another pocket.'
            )}
          </p>
        </div>
      )}
    </Popover>
  )
}

/** One term of the sum. The sign is the point, so it is always drawn. */
function Part({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="flex items-center gap-3 px-1 py-1">
      <dt className="min-w-0 flex-1 text-stone-600">{label}</dt>
      <dd data-money className="tnum shrink-0 text-stone-800">
        {formatMoney(amount, { signed: true })}
      </dd>
    </div>
  )
}
