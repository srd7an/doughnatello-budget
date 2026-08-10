import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useHousehold } from '../household/HouseholdContext'
import { usePeriod } from '../period/PeriodContext'
import { formatMoney } from '../lib/format'
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
            <span
              className={`text-sm ${change > 0 ? 'text-gain' : 'text-debt'}`}
            >
              {formatMoney(change, { signed: true })} this year
            </span>
          )}
        </p>
      </section>

      <div>
        {/* The twelve columns are navigation: click one to zoom into it. */}
        <YearChart
          months={data.months}
          currentMonthIndex={currentMonthIndex}
          onOpenMonth={(i) => openMonth(year, i + 1)}
        />

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
        <p className="text-sm text-stone-500">Net worth</p>
        <p className="tnum flex items-baseline gap-2">
          <span className="text-[32px] leading-none text-stone-800">
            {formatMoney(data.netWorth)}
          </span>
          {change !== 0 && (
            <span
              className={`text-sm ${change > 0 ? 'text-gain' : 'text-debt'}`}
            >
              {formatMoney(change, { signed: true })} this year
            </span>
          )}
        </p>
      </section>

      <div>
        {/* The twelve columns are navigation: click one to zoom into it. */}
        <YearChart
          months={data.months}
          currentMonthIndex={currentMonthIndex}
          onOpenMonth={(i) => openMonth(year, i + 1)}
        />

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

      <section>
        <h2 className="mb-3 text-base font-medium tracking-[-0.16px] text-stone-800">
          Categories
        </h2>
        <CategoriesList rows={rows ?? []} />
      </section>
    </div>
  )
}

