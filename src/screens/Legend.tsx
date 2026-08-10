import { formatMoney, formatPercent } from '../lib/format'
import { Swatch } from '../ui/Swatch'

export type LegendItem = {
  /** A Tailwind background class. Absent for the whole the others are parts of. */
  swatch?: string
  label: string
  amount: number
  /** Share of the whole. Null where the idea does not apply. */
  share: number | null
}

/**
 * The key to the bar above it, and the same one on both overviews.
 *
 * A list, not a row of columns. Three or four entries laid out horizontally
 * force each figure into a narrow column, and money in a narrow column either
 * wraps or truncates — on a phone it did both. Stacked, every amount ends at
 * the same right edge and the eye runs down them, which is what you do with
 * money: compare it.
 *
 * The percentages get a column of their own, before the amounts rather than
 * after. A share belongs to the label — it is what that colour is OF — and
 * putting it after the figure made two numbers race for the same edge.
 */
export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <dl className="flex flex-col">
      {items.map((it) => (
        <div key={it.label} className="flex min-h-9 items-center gap-3">
          <dt className="flex min-w-0 flex-1 items-center gap-2 text-sm text-stone-600">
            {/* Income has no swatch: it is not a segment of the bar, it is the
                length of it, and the others are shares of that. */}
            <span className="grid w-3 place-items-center">
              {it.swatch ? (
                <Swatch className={it.swatch} />
              ) : (
                <span
                  aria-hidden
                  className="size-3 rounded-[3px] border border-stone-300"
                />
              )}
            </span>
            <span className="truncate">{it.label}</span>
          </dt>
          <dd
            data-money
            className="w-12 shrink-0 text-right text-sm text-stone-400"
          >
            {it.share !== null ? formatPercent(it.share) : ''}
          </dd>
          <dd
            data-money
            className="w-28 shrink-0 text-right text-sm text-stone-800"
          >
            {formatMoney(it.amount)}
          </dd>
        </div>
      ))}
    </dl>
  )
}
