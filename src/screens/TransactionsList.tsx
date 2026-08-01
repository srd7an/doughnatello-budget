import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useHousehold } from '../household/HouseholdContext'
import { usePeriod } from '../period/PeriodContext'
import { formatMoney, initials } from '../lib/format'
import { categoryEmoji } from '../lib/categoryIcon'
import { dayLabel } from '../lib/dates'

type Row = NonNullable<ReturnType<typeof useMonthRows>>[number]

function useMonthRows() {
  const { household } = useHousehold()
  const { year, month } = usePeriod()
  const monthKey = `${year}-${String(month).padStart(2, '0')}`
  return useQuery(api.transactions.listMonth, {
    householdId: household._id,
    month: monthKey,
  })
}

export function TransactionsList() {
  const rows = useMonthRows()

  if (rows === undefined) {
    return <p className="py-8 text-center text-sm text-stone-400">Loading…</p>
  }
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-stone-200 bg-white p-8 text-center">
        <p className="text-stone-500">Nothing logged this month yet.</p>
        <p className="mt-1 text-sm text-stone-400">
          Tap Add transaction to start.
        </p>
      </div>
    )
  }

  // Group by day, newest first (rows already sorted newest-first).
  const groups: { day: string; rows: Row[] }[] = []
  for (const row of rows) {
    const last = groups.at(-1)
    if (last && last.day === row.occurredOn) last.rows.push(row)
    else groups.push({ day: row.occurredOn, rows: [row] })
  }

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g.day}>
          <h3 className="mb-1 text-xs font-medium tracking-wide text-stone-400 uppercase">
            {dayLabel(g.day)}
          </h3>
          <ul>
            {g.rows.map((row) => (
              <TransactionRow key={row._id} row={row} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function TransactionRow({ row }: { row: Row }) {
  const glyph = categoryEmoji(row.pot?.icon ?? row.category?.icon)
  const color = row.pot?.color ?? row.category?.color ?? '#a8a29e'
  const name = row.payee || row.category?.name || row.pot?.name || '—'

  return (
    <li className="flex items-center gap-3 border-b border-stone-100 py-2.5 last:border-b-0">
      <span
        aria-hidden
        className="grid size-8 shrink-0 place-items-center rounded-full text-sm"
        style={{ backgroundColor: `${color}1a` }}
      >
        {glyph}
      </span>

      <span className="min-w-0 flex-1 truncate font-medium text-stone-800">
        {name}
      </span>

      {row.pot && (
        <span className="hidden shrink-0 rounded-md border border-stone-200 px-2 py-0.5 text-xs text-stone-500 sm:inline">
          {row.direction === 'transfer' ? '→ ' : ''}
          {row.pot.name}
        </span>
      )}

      <span
        aria-label={`Paid by ${row.paidByName}`}
        title={row.paidByName}
        className="grid size-6 shrink-0 place-items-center rounded-full bg-stone-200 text-[10px] font-semibold text-stone-600"
      >
        {initials(row.paidByName)}
      </span>

      <span
        data-money
        className={`w-24 shrink-0 text-right font-medium ${
          row.direction === 'expense' ? 'text-stone-900' : 'text-saved'
        }`}
      >
        {row.direction === 'expense' ? '−' : ''}
        {formatMoney(row.amount)}
      </span>
    </li>
  )
}

