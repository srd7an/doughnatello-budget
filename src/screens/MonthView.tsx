import { useState } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useHousehold } from '../household/HouseholdContext'
import { usePeriod } from '../period/PeriodContext'
import { formatMoney, formatPercent } from '../lib/format'
import { CaretRightIcon, CategoryIcon } from '../ui/icons'
import { Swatch } from '../ui/Swatch'
import { TransactionsList } from './TransactionsList'
import { CategoriesList, Toggle } from './CategoriesList'
import { DueSoon } from './DueSoon'

type Lens = 'transactions' | 'categories'

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
  const [grouped, setGrouped] = useState(false)

  const now = new Date()
  const isCurrentMonth =
    year === now.getFullYear() && month === now.getMonth() + 1

  const income = summary?.income ?? 0
  const denom = Math.max(income, 1)
  const leftToSpend = summary?.leftToSpend ?? 0

  // Per-pot savings this month, for the Savings metric expansion.
  const savingsByPot = groupSavings(rows ?? [])

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

        {/* Composition bar: Leftover · Expense · Savings, width = income */}
        <div className="mt-3 flex h-5 gap-1">
          {income > 0 ? (
            <>
              <Seg className="bg-leftover" frac={Math.max(leftToSpend, 0) / denom} />
              <Seg className="bg-expense" frac={(summary?.expense ?? 0) / denom} />
              <Seg className="bg-saved" frac={(summary?.savings ?? 0) / denom} />
            </>
          ) : (
            <div className="w-full rounded-sm bg-stone-100" />
          )}
        </div>

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
            breakdown={savingsByPot}
          />
        </div>
      </section>

      {/* Lens row. The grouping toggle lives here, not inside the Categories
          list, because the design shows it on BOTH tabs. */}
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
        <div className="ml-auto">
          <Toggle
            on={grouped}
            onChange={setGrouped}
            label="Group by needs and wants"
          />
        </div>
      </div>

      {lens === 'transactions' ? (
        <TransactionsList />
      ) : (
        <CategoriesList
          rows={rows ?? []}
          paidFromFunds={summary?.paidFromFunds ?? 0}
          grouped={grouped}
          onGroupedChange={setGrouped}
        />
      )}
    </div>
  )
}

function Seg({ className, frac }: { className: string; frac: number }) {
  const pct = Math.max(0, Math.min(1, frac)) * 100
  if (pct <= 0) return null
  // Keep a small segment visible so it never vanishes.
  return (
    <div
      className={`rounded-sm ${className}`}
      style={{ width: `${Math.max(pct, 1.5)}%` }}
    />
  )
}

type PotSaving = { potId: string; name: string; icon: string; amount: number }

function Metric({
  swatch,
  label,
  amount,
  share,
  breakdown,
}: {
  swatch: string
  label: string
  amount: number
  share: number | null
  breakdown?: PotSaving[]
}) {
  const [open, setOpen] = useState(false)
  const expandable = !!breakdown && breakdown.length > 0

  return (
    <div>
      <button
        type="button"
        disabled={!expandable}
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 text-sm text-stone-500 ${
          expandable ? 'hover:text-stone-700' : 'cursor-default'
        }`}
      >
        {label}
        <Swatch className={swatch} />
        {expandable && (
          <CaretRightIcon
            size={12}
            aria-hidden
            className={`text-stone-400 transition-transform ${open ? 'rotate-90' : ''}`}
          />
        )}
      </button>
      <p className="tnum mt-0.5 text-sm">
        <span className="text-stone-800">{formatMoney(amount)}</span>
        {share !== null && (
          <span className="ml-1.5 text-stone-500">{formatPercent(share)}</span>
        )}
      </p>
      {expandable && open && (
        <ul className="mt-1 space-y-0.5">
          {breakdown!.map((b) => (
            <li
              key={b.potId}
              className="tnum flex justify-between text-xs text-stone-500"
            >
              <span>
                <CategoryIcon icon={b.icon} size={14} /> {b.name}
              </span>
              <span>{formatMoney(b.amount)}</span>
            </li>
          ))}
        </ul>
      )}
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

type Row = {
  direction: string
  amount: number
  potId: string | null
  pot: { name: string; icon: string } | null
}

function groupSavings(rows: Row[]): PotSaving[] {
  const byPot = new Map<string, PotSaving>()
  for (const r of rows) {
    if (r.direction !== 'transfer' || !r.potId || !r.pot) continue
    const cur = byPot.get(r.potId)
    if (cur) cur.amount += r.amount
    else
      byPot.set(r.potId, {
        potId: r.potId,
        name: r.pot.name,
        icon: r.pot.icon,
        amount: r.amount,
      })
  }
  return [...byPot.values()].sort((a, b) => b.amount - a.amount)
}
