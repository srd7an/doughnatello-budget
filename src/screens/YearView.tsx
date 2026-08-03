import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useHousehold } from '../household/HouseholdContext'
import { usePeriod } from '../period/PeriodContext'
import { formatMoney } from '../lib/format'
import { CaretRightIcon, CategoryIcon } from '../ui/icons'
import { Swatch } from '../ui/Swatch'
import { YearChart } from './YearChart'
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

  return (
    <div className="space-y-6">
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

        {/* Metric row keyed to the chart legend */}
        <div className="mt-4 flex flex-wrap gap-8">
          <Metric label="Income" swatch={<Swatch className="border-stone-400" outline />} amount={data.totals.income} />
          <Metric label="Expense" swatch={<Swatch className="bg-expense" />} amount={data.totals.expense} />
          <Metric label="Savings" swatch={<Swatch className="bg-saved" />} amount={data.totals.savings} />
          <Metric label="Leftover" swatch={<Swatch className="bg-leftover" />} amount={data.totals.leftToSpend} />
        </div>
      </section>

      {/* The twelve columns are navigation: click one to zoom into it. */}
      <YearChart
        months={data.months}
        currentMonthIndex={currentMonthIndex}
        onOpenMonth={(i) => openMonth(year, i + 1)}
      />

      {/* Stock accordions — path is the chart, endpoints are these rows */}
      <div className="flex flex-col gap-1">
        {/* Every row opens the thing it names. A fund's page lists money
            moving; an asset's lists what it has been worth. */}
        <Accordion label="Funds" group={data.funds} linkTo="/funds" />
        <Accordion label="Assets" group={data.assets} linkTo="/assets" />
        <Accordion label="Loans" group={data.loans} paidLabel linkTo="/funds" />
      </div>

      <section>
        <h2 className="mb-3 text-base font-medium tracking-[-0.16px] text-stone-800">
          Categories
        </h2>
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
    <div>
      <div className="flex items-center gap-1.5 text-sm text-stone-500">
        {label}
        {swatch}
      </div>
      <p data-money className="mt-0.5 text-sm text-stone-800">
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
  linkTo,
}: {
  label: string
  group: Group
  paidLabel?: boolean
  /** Set when the rows open a page — the base path, id appended. */
  linkTo?: string
}) {
  const [open, setOpen] = useState(false)
  const empty = group.items.length === 0

  return (
    <div>
      <button
        onClick={() => !empty && setOpen((o) => !o)}
        aria-expanded={open}
        disabled={empty}
        className="flex min-h-11 w-full items-center gap-2 rounded-lg bg-stone-100 px-3 text-sm transition-colors hover:bg-stone-200 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand sm:min-h-9"
      >
        <span className="grid w-3 shrink-0 place-items-center" aria-hidden>
          {!empty && (
            <CaretRightIcon
              size={12}
              className={`text-stone-400 transition-transform ${open ? 'rotate-90' : ''}`}
            />
          )}
        </span>
        <span className="flex-1 text-left font-medium">{label}</span>
        <ChangeBalance
          change={group.change}
          balance={group.balance}
          paidLabel={paidLabel}
        />
      </button>
      {/* Exactly the shapes the rest of the app uses: an open group draws a
          rule down its left the way a category group does, and each row under
          it is a transaction row — square on its own dashed rule, rounded and
          filled only while hovered. */}
      {open && (
        <div className="mt-1 ml-4 flex flex-col gap-1 border-l border-stone-200 pl-4">
        {group.items.map((it) => {
          const cls = `flex min-h-11 items-center gap-2 border-b border-dashed border-stone-300 px-3 py-1.5 text-sm sm:min-h-9 ${
            linkTo
              ? 'hover:rounded-lg hover:border-transparent hover:bg-stone-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand'
              : ''
          }`
          const body = (
            <>
            {/* The icon is a flex sibling of the name, not a child of it:
                preflight renders an svg as a block, so inside the text it
                dropped onto its own line above the label. */}
            <span className="flex min-w-0 flex-1 items-center gap-2 text-stone-600">
              {it.icon && (
                <CategoryIcon
                  icon={it.icon}
                  color={it.color}
                  className="shrink-0"
                />
              )}
              <span className="truncate">{it.name}</span>
            </span>
            <ChangeBalance
              change={it.change}
              balance={it.balance}
              paidLabel={paidLabel}
            />
            </>
          )
          return linkTo ? (
            <Link key={it._id} to={`${linkTo}/${it._id}`} className={cls}>
              {body}
            </Link>
          ) : (
            <div key={it._id} className={cls}>
              {body}
            </div>
          )
        })}
        </div>
      )}
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
          change > 0 ? 'text-gain' : change < 0 ? 'text-debt' : 'text-stone-400'
        }`}
      >
        {change === 0
          ? 'No change'
          : `${formatMoney(change, { signed: true })}${paidLabel ? ' paid' : ''}`}
      </span>
      <span className="w-[100px] text-right font-medium">
        {formatMoney(balance)}
      </span>
    </span>
  )
}
