import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { useOverlay } from '../period/PeriodContext'
import { formatMonth, formatMoney } from '../lib/format'
import { dayLabel, formatDayMonthYear } from '../lib/dates'
import { CategoryIcon } from '../ui/icons'
import { BarRow, TxnList, type Txn } from './CategoriesList'

/**
 * One tag, in full — the whole point of tagging.
 *
 * A holiday is booked in March, paid for in July and refunded in September, out
 * of four categories and sometimes out of a fund. No screen in this app could
 * show it as one thing, because every other screen is a period or a category or
 * a fund, and this is none of those. So it gets a page of its own, and the page
 * is all of time: the period control does not govern it, exactly as it does not
 * govern a fund's.
 *
 * The three totals are never added together. Spending, money that came back,
 * and money set aside for it are different facts — netting them would produce
 * one figure that answers no question anybody asked. Spent leads, because it is
 * the one everyone opened this page for.
 */
export function TagPage() {
  const { tagId } = useParams<{ tagId: string }>()
  const navigate = useNavigate()
  const overlay = useOverlay()
  const tag = useQuery(
    api.tags.detail,
    tagId ? { tagId: tagId as Id<'tags'> } : 'skip',
  )
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  // A transaction found by opening a category is the same transaction as one
  // found down the list below — so it opens the same editor.
  const openTransaction = (id: Id<'transactions'>) => {
    const { to, options } = overlay(`/transactions/${id}`)
    navigate(to, options)
  }

  if (tag === undefined) {
    return <p className="py-8 text-center text-sm text-stone-400">Loading…</p>
  }

  // Newest first, grouped by month — a tag's history spans months by nature,
  // which is the reason it exists.
  const groups: { month: string; rows: typeof tag.rows }[] = []
  for (const row of tag.rows) {
    const month = row.occurredOn.slice(0, 7)
    const last = groups.at(-1)
    if (last && last.month === month) last.rows.push(row)
    else groups.push({ month, rows: [row] })
  }

  /**
   * The spending inside one category of this tag. Expenses only, so the rows
   * that open under a figure add up to the figure they opened out of — the
   * refund and the transfer are elsewhere on this page, in their own words.
   */
  const spentBy = (categoryId: string): Txn[] =>
    tag.rows
      .filter(
        (r) =>
          r.direction === 'expense' && (r.categoryId ?? 'none') === categoryId,
      )
      .map((r) => ({
        id: r._id,
        payee: r.payee || r.category?.name || '—',
        occurredOn: r.occurredOn,
        amount: r.amount,
      }))
      .sort((a, b) => (a.occurredOn < b.occurredOn ? 1 : -1))

  return (
    <div className="space-y-6">
      <section>
        <p className="flex items-center gap-2 text-sm text-stone-500">
          <CategoryIcon
            icon={tag.icon}
            color={tag.color}
            className="shrink-0"
          />
          {tag.name}
          {tag.isArchived && (
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">
              Archived
            </span>
          )}
        </p>
        <p className="tnum mt-1">
          <span className="text-[32px] leading-none text-stone-800">
            {formatMoney(tag.spent)}
          </span>
          <span className="ml-2 text-sm text-stone-500">spent</span>
        </p>

        <div className="mt-4 flex flex-wrap gap-8">
          {tag.received > 0 && (
            <Fact label="Came back" value={formatMoney(tag.received)} />
          )}
          {tag.setAside > 0 && (
            <Fact label="Set aside for it" value={formatMoney(tag.setAside)} />
          )}
          <Fact
            label={tag.count === 1 ? 'Transaction' : 'Transactions'}
            value={String(tag.count)}
          />
          {tag.firstOn && tag.lastOn && (
            <Fact
              label="Ran"
              value={
                tag.firstOn === tag.lastOn
                  ? formatDayMonthYear(tag.firstOn)
                  : `${formatDayMonthYear(tag.firstOn)} – ${formatDayMonthYear(tag.lastOn)}`
              }
            />
          )}
        </div>

        <button
          onClick={() => {
            const { to, options } = overlay(`/settings/tags/${tag._id}`)
            navigate(to, options)
          }}
          className="mt-4 flex min-h-11 items-center rounded-full border border-stone-200 px-4 text-sm text-stone-700 hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:min-h-9"
        >
          Edit in settings
        </button>
      </section>

      {/* What the money went ON. The categories are still doing their own job —
          fuel is fuel whether or not it happened in Greece — and this is the
          second axis laid across them, which is the only thing a tag ever is.
          Shares are of the tag's OWN spending, not of income: the question here
          is what a holiday was made of, not what a month was. */}
      {tag.byCategory.length > 0 && (
        <section>
          <h2 className="mb-3 text-base font-medium tracking-[-0.16px] text-stone-800">
            What it went on
          </h2>
          {/* The SAME row the overview's category list draws — two layers of
              one hue, the faint one the whole and the stronger one this row's
              share of it — down to the chevron that opens the transactions
              inside. Drawn a second time by hand it came out a bar on a dashed
              rule with no track behind it, which is a different encoding of
              the same number on two screens showing the same thing. */}
          <div className="flex flex-col gap-1">
            {tag.byCategory.map((c) => (
              <div key={c.categoryId}>
                <BarRow
                  share={tag.spent > 0 ? c.total / tag.spent : 0}
                  tone="bg-stone-200 group-hover:bg-stone-300"
                  track="bg-stone-50"
                  expanded={open.has(c.categoryId)}
                  onClick={() => toggle(c.categoryId)}
                  icon={c.icon}
                  iconColor={c.color}
                  label={c.name}
                  amount={c.total}
                  shareTitle="Share of this tag's spending"
                />
                {open.has(c.categoryId) && (
                  <TxnList
                    txns={spentBy(c.categoryId)}
                    onOpen={openTransaction}
                  />
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-base font-medium tracking-[-0.16px] text-stone-800">
          Everything in it
        </h2>
        {groups.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-stone-200 bg-white p-8 text-center">
            <p className="text-stone-500">Nothing tagged yet.</p>
            <p className="mt-1 text-sm text-stone-400">
              Open a month, tap “Tag several”, and pick the rows that belong
              here.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map((g) => (
              <div key={g.month}>
                <h3 className="mb-1 text-xs tracking-[0.24px] text-stone-600 uppercase">
                  {formatMonth(
                    Number(g.month.slice(0, 4)),
                    Number(g.month.slice(5, 7)),
                  )}
                </h3>
                <ul className="flex flex-col gap-1">
                  {g.rows.map((row) => (
                    <li key={row._id}>
                      <button
                        onClick={() => openTransaction(row._id)}
                        className="flex min-h-11 w-full items-center gap-2 border-b border-dashed border-stone-300 px-3 py-1.5 text-left hover:rounded-lg hover:border-transparent hover:bg-stone-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand sm:min-h-9"
                      >
                        <CategoryIcon
                          icon={row.category?.icon ?? row.pot?.icon}
                          color={
                            row.category?.color ?? row.pot?.color ?? '#a8a29e'
                          }
                          className="shrink-0"
                        />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-stone-800">
                          {row.payee ||
                            row.category?.name ||
                            row.pot?.name ||
                            '—'}
                        </span>
                        <span className="hidden shrink-0 text-xs text-stone-500 sm:block">
                          {dayLabel(row.occurredOn)}
                        </span>
                        <span
                          data-money
                          className={`w-[100px] shrink-0 text-right text-sm ${
                            row.direction === 'income'
                              ? 'text-gain'
                              : 'text-stone-800'
                          }`}
                        >
                          {row.direction === 'expense' ? '−' : ''}
                          {formatMoney(row.amount)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm text-stone-500">{label}</p>
      <p data-money className="mt-0.5 text-sm text-stone-800">
        {value}
      </p>
    </div>
  )
}
