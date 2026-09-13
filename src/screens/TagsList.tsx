import { useNavigate } from 'react-router-dom'
import { useKeepPeriod } from '../period/PeriodContext'
import { CaretRightIcon } from '../ui/icons'
import { BarRow } from './CategoriesList'

export type TagRowData = {
  direction: string
  amount: number
  tags: { _id: string; name: string; color: string; icon: string }[]
}

/**
 * What the period on screen spent on each of the things you are tracking across
 * periods. Used by both zooms — the month's lens and the year's Tags section.
 *
 * Deliberately period-scoped, even though a tag is not. It says what THIS month
 * or year put into each; the tag's own page says what the whole thing came to.
 * Both are wanted and they are different questions — "how much of July went to
 * Greece" is not "what did Greece cost" — so the row carries the period's
 * figure and the chevron leads to the total.
 *
 * Derived from the rows already on screen: no extra query, and a tag with
 * nothing in this period simply is not here, which is the honest answer to
 * "what did this period have in it".
 */
export function TagsList({ rows }: { rows: TagRowData[] }) {
  const keepPeriod = useKeepPeriod()
  const navigate = useNavigate()

  const totals = new Map<
    string,
    { name: string; color: string; icon: string; spent: number; count: number }
  >()
  for (const row of rows) {
    for (const tag of row.tags) {
      const at = totals.get(tag._id) ?? {
        name: tag.name,
        color: tag.color,
        icon: tag.icon,
        spent: 0,
        count: 0,
      }
      // Only spending adds up here. A transfer into the holiday fund is money
      // moving, not money gone, and adding the two would give a figure that is
      // neither.
      if (row.direction === 'expense') at.spent += row.amount
      at.count += 1
      totals.set(tag._id, at)
    }
  }

  const items = [...totals.entries()].sort(
    (a, b) => b[1].spent - a[1].spent || a[1].name.localeCompare(b[1].name),
  )

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-stone-200 bg-white p-8 text-center">
        <p className="text-stone-500">Nothing tagged here yet.</p>
        <p className="mt-1 text-sm text-stone-400">
          Tags group things the months cannot — a holiday, a renovation. Open
          Transactions, tap “Tag several”, and label the rows that belong
          together.
        </p>
      </div>
    )
  }

  const total = items.reduce((sum, [, t]) => sum + t.spent, 0)

  return (
    // The same row the Categories list draws, because it is the same kind of
    // row: a name, a share, a figure, and a fill behind it carrying the share.
    // The bar is this tag's share of what the period's TAGGED spending came to
    // — not of income. Tags cover an arbitrary slice of a period, and measured
    // against income every bar would be a sliver, saying nothing about the one
    // comparison worth making here: these tags against each other.
    <div className="flex flex-col gap-1">
      {items.map(([id, t]) => (
        <BarRow
          key={id}
          share={total > 0 ? t.spent / total : 0}
          tone="bg-stone-200 group-hover:bg-stone-300"
          track="bg-stone-50"
          // It GOES to the tag's page rather than opening in place, so no
          // disclosure chevron at the front — the one at the end says "away".
          caret={false}
          expanded={false}
          onClick={() => navigate(keepPeriod(`/tags/${id}`))}
          icon={t.icon}
          iconColor={t.color}
          label={t.name}
          amount={t.spent}
          shareTitle="Share of what this period tagged"
          trailing={
            <>
              {/* How many rows this period put into it — the figure beside it
                  says how much, and on a tag the two are worth reading
                  together: eleven small ones and one big one are different
                  holidays. */}
              <span data-money className="shrink-0 text-xs text-stone-400">
                {t.count}
              </span>
              <CaretRightIcon
                size={16}
                className="shrink-0 text-stone-400"
                aria-hidden
              />
            </>
          }
        />
      ))}
    </div>
  )
}
