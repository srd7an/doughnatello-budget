import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useHousehold } from '../household/HouseholdContext'
import { usePeriod, useOverlay } from '../period/PeriodContext'
import { formatMoney } from '../lib/format'
import {
  ArrowRightIcon,
  CategoryIcon,
  CheckIcon,
  TagIcon,
  XIcon,
} from '../ui/icons'
import { TagChip } from '../ui/TagChip'
import { TagOptions } from '../ui/TagPicker'
import { Popover } from '../ui/Popover'
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
  | {
      kind: 'direction'
      direction: 'expense' | 'income' | 'transfer'
      label: string
    }
  | { kind: 'pot'; potId: Id<'pots'>; label: string }
  | { kind: 'tag'; tagId: Id<'tags'>; label: string }
  /** One day's spending — what clicking a day on the pace chart asks for. */
  | { kind: 'day'; day: string; label: string }
  /** One category's spending. Null is the uncategorised remainder. */
  | { kind: 'category'; categoryId: Id<'categories'> | null; label: string }

function matches(row: Row, filter: TxFilter): boolean {
  if (filter.kind === 'day')
    return row.occurredOn === filter.day && row.direction === 'expense'
  if (filter.kind === 'category')
    return row.direction === 'expense' && row.categoryId === filter.categoryId
  if (filter.kind === 'direction') return row.direction === filter.direction
  if (filter.kind === 'tag') return row.tags.some((t) => t._id === filter.tagId)
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
  const { household } = useHousehold()
  const all = useMonthRows()
  const navigate = useNavigate()
  const overlay = useOverlay()
  const tagList = useQuery(api.tags.list, { householdId: household._id })
  const createTag = useMutation(api.tags.create)
  const applyTag = useMutation(api.tags.applyToMany)
  /**
   * Which rows are picked out, or null when nothing is being picked.
   *
   * Null rather than an empty set plus a boolean: "selecting nothing" and "not
   * selecting" are the same state as far as this list is concerned, and two
   * fields that must agree are one field waiting to disagree.
   */
  const [picked, setPicked] = useState<Set<Id<'transactions'>> | null>(null)
  const [busy, setBusy] = useState(false)
  const { month } = usePeriod()

  // A selection belongs to the month it was made in, like the filter above it.
  useEffect(() => setPicked(null), [month])

  if (all === undefined) {
    return <p className="py-8 text-center text-sm text-stone-400">Loading…</p>
  }
  const rows = filter ? all.filter((r) => matches(r, filter)) : all
  const tags = tagList ?? []
  const pickedRows = picked ? rows.filter((r) => picked.has(r._id)) : []

  const toggle = (id: Id<'transactions'>) =>
    setPicked((prev) => {
      const next = new Set(prev ?? [])
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  /**
   * Put a tag on everything picked — or, when they ALL have it already, take
   * it off. One control, and its meaning is read off the rows rather than off a
   * mode you had to choose first.
   */
  const apply = async (tagId: Id<'tags'>) => {
    if (pickedRows.length === 0) return
    const everyone = pickedRows.every((r) =>
      r.tags.some((t) => t._id === tagId),
    )
    setBusy(true)
    try {
      await applyTag({
        tagId,
        transactionIds: pickedRows.map((r) => r._id),
        on: !everyone,
      })
    } finally {
      setBusy(false)
    }
  }

  // A visible, removable chip whenever the list is showing less than it has.
  // A list that quietly holds 8 of 40 rows is how people conclude their data
  // is missing.
  const chip = filter && (
    <button
      onClick={onClearFilter}
      className="inline-flex min-h-11 sm:min-h-9 items-center gap-1.5 rounded-full border border-brand bg-violet-50 px-3 text-sm text-stone-900 hover:bg-violet-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      {filter.label}
      <XIcon size={14} aria-hidden />
      <span className="sr-only">Clear filter</span>
    </button>
  )

  if (rows.length === 0) {
    return (
      <div>
        <div className="mb-3">{chip}</div>
        <div className="rounded-2xl border border-dashed border-stone-200 bg-white p-8 text-center">
          <p className="text-stone-500">
            {filter
              ? `Nothing here for ${filter.label.toLowerCase()} this month.`
              : 'Nothing logged this month yet.'}
          </p>
          <p className="mt-1 text-sm text-stone-400">
            {filter
              ? 'Clear the filter to see the rest.'
              : 'Tap Add transaction to start.'}
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

  // Which tags are on ALL of the picked rows, and which on only some. The
  // difference is what stops one tap from stripping a tag off the rows that
  // already had it while adding it to the rest.
  const onAll = tags
    .filter(
      (t) =>
        pickedRows.length > 0 &&
        pickedRows.every((r) => r.tags.some((x) => x._id === t._id)),
    )
    .map((t) => t._id)
  const onSome = tags
    .filter((t) => pickedRows.some((r) => r.tags.some((x) => x._id === t._id)))
    .map((t) => t._id)

  return (
    <div className="space-y-6">
      {/* Left, with everything else on the page. It sat on the right, which
          only made sense while the left held a filter chip — and there is no
          chip on almost every visit, so the row read as one control stranded
          across an empty line from nothing. */}
      <div className="flex flex-wrap items-center gap-2">
        {chip}
        <div className="flex items-center gap-2">
          {picked === null ? (
            // The way in. Off by default: on almost every visit this list is
            // read, not edited, and a checkbox on every row would say otherwise.
            <button
              onClick={() => setPicked(new Set())}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-stone-200 px-3 text-sm text-stone-700 hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:min-h-9"
            >
              <TagIcon size={16} aria-hidden />
              Tag several
            </button>
          ) : (
            <>
              <span data-money className="text-sm text-stone-500">
                {picked.size} selected
              </span>
              <button
                onClick={() =>
                  setPicked(
                    picked.size === rows.length
                      ? new Set()
                      : new Set(rows.map((r) => r._id)),
                  )
                }
                className="min-h-11 rounded-full border border-stone-200 px-3 text-sm text-stone-700 hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:min-h-9"
              >
                {picked.size === rows.length ? 'None' : 'All'}
              </button>
              <Popover
                label="Tag the selected transactions"
                align="right"
                triggerClassName={`inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm sm:min-h-9 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                  picked.size === 0 || busy
                    ? 'pointer-events-none bg-stone-100 text-stone-400'
                    : 'bg-brand text-white hover:opacity-90'
                }`}
                trigger={
                  <>
                    <TagIcon size={16} aria-hidden />
                    Tag
                  </>
                }
              >
                {() => (
                  <TagOptions
                    tags={tags}
                    selected={onAll}
                    partial={onSome}
                    onToggle={(id) => void apply(id)}
                    onCreate={async (name) => {
                      const id = await createTag({
                        householdId: household._id,
                        name,
                      })
                      await apply(id)
                    }}
                  />
                )}
              </Popover>
              <button
                onClick={() => setPicked(null)}
                className="min-h-11 rounded-full px-3 text-sm text-stone-500 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:min-h-9"
              >
                Done
              </button>
            </>
          )}
        </div>
      </div>

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
                picking={picked !== null}
                picked={picked?.has(row._id) ?? false}
                onOpen={() => {
                  // While picking, a row is a checkbox. Opening the editor from
                  // under a half-made selection would throw it away.
                  if (picked) {
                    toggle(row._id)
                    return
                  }
                  const { to, options } = overlay(`/transactions/${row._id}`)
                  navigate(to, options)
                }}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

/**
 * No "who paid" avatar. On a one-person household it was the same two letters
 * on all 564 rows — a column of identical marks, which is a column carrying no
 * information at all. The server still reports `paidByName` and the field is
 * still recorded; it is worth showing again the day a household has two people
 * whose spending you would want to tell apart, and nothing about that is lost
 * by not drawing it today.
 */
function TransactionRow({
  row,
  onOpen,
  picking,
  picked,
}: {
  row: Row
  onOpen: () => void
  /** The list is in selecting mode: the row is a checkbox, not a door. */
  picking?: boolean
  picked?: boolean
}) {
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
        aria-pressed={picking ? picked : undefined}
        className={`flex min-h-11 w-full items-center gap-2 border-b border-dashed border-stone-300 px-3 py-1.5 text-left hover:rounded-lg hover:border-transparent hover:bg-stone-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand sm:min-h-9 ${
          picked ? 'rounded-lg border-transparent bg-violet-50' : ''
        }`}
      >
        {picking && (
          <span
            aria-hidden
            className={`grid size-5 shrink-0 place-items-center rounded-md border ${
              picked ? 'border-brand bg-brand text-white' : 'border-stone-300'
            }`}
          >
            {picked && <CheckIcon size={14} />}
          </span>
        )}

        {ends ? (
          <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium text-stone-800">
            <End pot={ends.from} />
            <ArrowRightIcon
              size={14}
              className="shrink-0 text-stone-400"
              aria-hidden
            />
            <End pot={ends.to} />
          </span>
        ) : (
          <>
            {/* A bare icon in the category's own colour. The design has no disc
              behind it — the tinted circle it replaced added weight to every
              single row. */}
            <CategoryIcon
              icon={glyph?.icon}
              color={color}
              className="shrink-0"
            />

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

        {/* What it belongs to, whichever kind of row it is — a transfer into
            the holiday fund is as much part of the holiday as the dinners.
            First one only, with a count for the rest: a row is a line, and
            three chips on it leave no room for the name the row is actually
            called. The full set is on the transaction, and on the tag's page. */}
        {row.tags.length > 0 && (
          <span className="flex shrink-0 items-center gap-1">
            <TagChip
              name={row.tags[0].name}
              color={row.tags[0].color}
              className="max-w-24"
            />
            {row.tags.length > 1 && (
              <span data-money className="text-xs text-stone-400">
                +{row.tags.length - 1}
              </span>
            )}
          </span>
        )}

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
function End({
  pot,
}: {
  pot: { name: string; icon: string; color: string } | null
}) {
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
