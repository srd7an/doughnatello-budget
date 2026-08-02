import { useState } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useHousehold } from '../household/HouseholdContext'
import { usePeriod } from '../period/PeriodContext'
import { formatMoney } from '../lib/format'
import { CategoryIcon } from '../ui/icons'
import { Swatch } from '../ui/Swatch'
import { YearChart } from './YearChart'
import { CategoriesList } from './CategoriesList'

// Year zoom: FLOW over twelve months. Hero is net worth (a stock, deliberately
// the one exception on this flow screen), with the year's change beside it. The
// chart shows the path; the accordion rows show the endpoints.
export function YearView() {
  const { household } = useHousehold()
  const { year } = usePeriod()
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

  return (
    <div className="space-y-6">
      <section>
        <p className="text-sm text-stone-500">Net worth</p>
        <p className="tnum flex items-baseline gap-2">
          <span className="text-4xl font-semibold tracking-tight">
            {formatMoney(data.netWorth)}
          </span>
          {change !== 0 && (
            <span
              className={`text-sm ${change > 0 ? 'text-saved' : 'text-debt'}`}
            >
              {formatMoney(change, { signed: true })} this year
            </span>
          )}
        </p>

        {/* Metric row keyed to the chart legend */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="Income" swatch={<Swatch className="border-stone-400" outline />} amount={data.totals.income} />
          <Metric label="Expense" swatch={<Swatch className="bg-expense" />} amount={data.totals.expense} />
          <Metric label="Savings" swatch={<Swatch className="bg-saved" />} amount={data.totals.savings} />
          <Metric label="Leftover" swatch={<Swatch className="bg-leftover" />} amount={data.totals.leftToSpend} />
        </div>
      </section>

      <YearChart months={data.months} currentMonthIndex={currentMonthIndex} />

      {/* Stock accordions — path is the chart, endpoints are these rows */}
      <div className="overflow-hidden rounded-2xl border border-stone-200">
        <Accordion label="Funds" group={data.funds} />
        <Accordion label="Assets" group={data.assets} />
        <Accordion label="Loans" group={data.loans} paidLabel />
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Categories</h2>
        <CategoriesList
          rows={rows ?? []}
          paidFromFunds={data.totals.paidFromFunds}
        />
      </section>
    </div>
  )
}

function Metric({
  label,
  swatch,
  amount,
}: {
  label: string
  swatch: React.ReactNode
  amount: number
}) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-3">
      <div className="flex items-center gap-1.5 text-sm text-stone-500">
        {swatch}
        {label}
      </div>
      <p data-money className="mt-1 text-lg font-semibold">
        {formatMoney(amount)}
      </p>
    </div>
  )
}

type StockItem = {
  _id: string
  name: string
  icon: string
  color: string
  balance: number
  change: number
  valuedOn?: string
}
type Group = { balance: number; change: number; items: StockItem[] }

function Accordion({
  label,
  group,
  paidLabel,
}: {
  label: string
  group: Group
  paidLabel?: boolean
}) {
  const [open, setOpen] = useState(false)
  const empty = group.items.length === 0

  return (
    <div className="border-b border-stone-100 last:border-b-0">
      <button
        onClick={() => !empty && setOpen((o) => !o)}
        aria-expanded={open}
        disabled={empty}
        className="flex min-h-12 w-full items-center gap-2 px-4 text-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
      >
        <span className="w-3 shrink-0 text-xs text-stone-400" aria-hidden>
          {empty ? '' : open ? '▾' : '▸'}
        </span>
        <span className="flex-1 text-left font-medium">{label}</span>
        <ChangeBalance
          change={group.change}
          balance={group.balance}
          paidLabel={paidLabel}
        />
      </button>
      {open &&
        group.items.map((it) => (
          <div
            key={it._id}
            className="flex items-center gap-2 border-t border-stone-100 py-2 pr-4 pl-9 text-sm"
          >
            <span className="flex-1 truncate text-stone-600">
              {it.icon && <CategoryIcon icon={it.icon} size={16} color={it.color} />}
              {it.name}
            </span>
            <ChangeBalance
              change={it.change}
              balance={it.balance}
              paidLabel={paidLabel}
            />
          </div>
        ))}
    </div>
  )
}

function ChangeBalance({
  change,
  balance,
  paidLabel,
}: {
  change: number
  balance: number
  paidLabel?: boolean
}) {
  return (
    <span className="tnum flex items-center gap-4">
      <span
        className={`text-sm ${
          change > 0 ? 'text-saved' : change < 0 ? 'text-debt' : 'text-stone-400'
        }`}
      >
        {change === 0
          ? 'No change'
          : `${formatMoney(change, { signed: true })}${paidLabel ? ' paid' : ''}`}
      </span>
      <span className="w-28 text-right font-medium">{formatMoney(balance)}</span>
    </span>
  )
}
