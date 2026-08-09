import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useHousehold } from '../household/HouseholdContext'
import { usePeriod } from '../period/PeriodContext'
import { formatMoney, initials } from '../lib/format'
import { ArrowRightIcon, CategoryIcon, XIcon } from '../ui/icons'
import { dayLabel } from '../lib/dates'
import type { Id } from '../../convex/_generated/dataModel'

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

/**
 * What the list has been narrowed to, and what to call it on screen.
 *
 * One filter at a time, and it always comes from clicking the thing it names —
 * a bar segment, a fund. There is no filter UI to build up a query in, because
 * the question is always "show me the ones behind THAT number".
 */
export type TxFilter =
  | { kind: 'direction'; direction: 'expense' | 'income' | 'transfer'; label: string }
  | { kind: 'pot'; potId: Id<'pots'>; label: string }

function matches(row: Row, filter: TxFilter): boolean {
  if (filter.kind === 'direction') return row.direction === filter.direction
  // Everything that touched this fund: money set aside into it, moved out of
  // it, and spending it paid for.
  return (
    row.potId === filter.potId ||
    row.fromPotId === filter.potId ||
    row.fundedFromPotId === filter.potId
  )
}

export function TransactionsList({
  filter,
  onClearFilter,
}: {
  filter?: TxFilter | null
  onClearFilter?: () => void
} = {}) {
  const all = useMonthRows()
  const navigate = useNavigate()
  const location = useLocation()

  if (all === undefined) {
    return <p className="py-8 text-center text-sm text-stone-400">Loading…</p>
  }
  const rows = filter ? all.filter((r) => matches(r, filter)) : all

  // A visible, removable chip whenever the list is showing less than it has.
  // A list that quietly holds 8 of 40 rows is how people conclude their data
  // is missing.
  const chip = filter && (
    <button
      onClick={onClearFilter}
      className="mb-3 inline-flex min-h-11 sm:min-h-9 items-center gap-1.5 rounded-full border border-brand bg-violet-50 px-3 text-sm text-stone-900 hover:bg-violet-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      {filter.label}
      <XIcon size={14} aria-hidden />
      <span className="sr-only">Clear filter</span>
    </button>
  )

  if (rows.length === 0) {
    return (
      <div>
        {chip}
        <div className="rounded-2xl border border-dashed border-stone-200 bg-white p-8 text-center">
          <p className="text-stone-500">
            {filter
              ? `Nothing here for ${filter.label.toLowerCase()} this month.`
              : 'Nothing logged this month yet.'}
          </p>
          <p className="mt-1 text-sm text-stone-400">
            {filter ? 'Clear the filter to see the rest.' : 'Tap Add transaction to start.'}
          </p>
        </div>
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
      {chip}
      {groups.map((g) => (
        <section key={g.day}>
          <h3 className="mb-1 text-xs tracking-[0.24px] text-stone-600 uppercase">
            {dayLabel(g.day)}
          </h3>
          <ul className="flex flex-col gap-1">
            {g.rows.map((row) => (
              <TransactionRow
                key={row._id}
                row={row}
                onOpen={() => navigate({ pathname: `/transactions/${row._id}`, search: location.search })}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function TransactionRow({ row, onOpen }: { row: Row; onOpen: () => void }) {
  // The category you chose is what the row wears. A fund or a loan is context —
  // where the money came from, what it paid off — and it says so in the pill
  // beside the name; letting it take the icon meant picking Grocery and being
  // shown a piggy bank. Only a transfer, which has no category, falls back to
  // the fund. Same order as DueSoon and Repeating.
  const glyph = row.category ?? row.pot ?? row.fromPot
  const color = glyph?.color ?? '#a8a29e'
  // A release has no destination, so the fund it left is what names it.
  const name =
    row.payee || row.category?.name || row.pot?.name || row.fromPot?.name || '—'

  /**
   * A transfer is not a thing that happened to a category — it is money moving
   * between two named places, and the row says so in full: the source, an
   * arrow, the destination, each with its own glyph. Unset ends are this
   * month's income, which is what "from nowhere in particular" means here.
   *
   * It replaces the single-icon-plus-pill an expense wears, because on a
   * transfer that pill was carrying the whole meaning of the row in the
   * smallest type on it.
   */
  const isMove = row.direction === 'transfer'
  const ends = isMove
    ? {
        from: row.fromPot ?? null,
        to: row.pot ?? null,
      }
    : null

  return (
    <li>
      {/* The dashed rule belongs to the ROW, not to the gap under it. Sitting
          on its rule the row is square; hovering swaps the rule for a filled,
          8px-rounded shape. The radius arrives WITH the fill — a corner on a
          row that is only a line has nothing to round. */}
      <button
        onClick={onOpen}
        className="flex min-h-11 w-full items-center gap-2 border-b border-dashed border-stone-300 px-3 py-1.5 text-left hover:rounded-lg hover:border-transparent hover:bg-stone-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand sm:min-h-9"
      >
        {ends ? (
          <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium text-stone-800">
            <End pot={ends.from} />
            <ArrowRightIcon size={14} className="shrink-0 text-stone-400" aria-hidden />
            <End pot={ends.to} />
          </span>
        ) : (
          <>
            {/* A bare icon in the category's own colour. The design has no disc
              behind it — the tinted circle it replaced added weight to every
              single row. */}
            <CategoryIcon icon={glyph?.icon} color={color} className="shrink-0" />

            <span className="min-w-0 flex-1 truncate text-sm font-medium text-stone-800">
              {name}
            </span>

            {/* Which fund or loan this touched, and WHICH WAY. The bare name
                could not say whether the money came out of it or went into it —
                on an expense the two are opposite facts, and one word fixes it:
                "From Cash fund" against "To KIA Sportage". */}
            {(row.fundedFromPot || row.pot) && (
              <span className="hidden shrink-0 items-center gap-1 rounded-md bg-stone-100 px-1.5 py-0.5 text-xs text-stone-800 sm:inline-flex">
                <span className="text-stone-500">
                  {row.fundedFromPot ? 'From' : 'To'}
                </span>
                {(row.fundedFromPot ?? row.pot)?.name}
              </span>
            )}
          </>
        )}

        <span
          aria-label={`Paid by ${row.paidByName}`}
          title={row.paidByName}
          className="grid size-5 shrink-0 place-items-center rounded-full bg-stone-200 text-[10px] font-medium text-stone-600"
        >
          {initials(row.paidByName)}
        </span>

        {/* Only income is green. A transfer into a fund is money MOVING, not money
          arriving — painting it as a gain was the old bug. */}
        <span
          data-money
          className={`w-[100px] shrink-0 text-right text-sm ${
            row.direction === 'income' ? 'text-gain' : 'text-stone-800'
          }`}
        >
          {row.direction === 'expense' ? '−' : ''}
          {formatMoney(row.amount)}
        </span>
      </button>
    </li>
  )
}

/**
 * One end of a transfer. An unset pot is this month's income — the money that
 * has not been promised to anything, which is where a plain "set some aside"
 * comes from and where a release puts it back.
 */
function End({ pot }: { pot: { name: string; icon: string; color: string } | null }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <CategoryIcon
        icon={pot?.icon ?? 'wallet'}
        color={pot?.color}
        size={18}
        className="shrink-0"
      />
      <span className="truncate">{pot?.name ?? 'Income'}</span>
    </span>
  )
}
