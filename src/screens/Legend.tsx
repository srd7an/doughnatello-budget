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
 * The key to the bar, and two genuinely different shapes rather than one shape
 * squeezed.
 *
 * WIDE: a row above the picture. Four figures side by side, each under its own
 * name, read in one glance — and there is room for them, so they take it.
 *
 * NARROW: a list below the picture. The same four laid out horizontally force
 * every figure into a column a third the width, and money in a column that
 * narrow either wraps or truncates; on a phone it did both. Stacked, every
 * amount ends at the same right edge and the eye runs down them, which is what
 * anyone does with money — compare it.
 *
 * The order flips with the shape, and that is not decoration. Wide, the key
 * reads before the picture because four series stacked in a column are worth
 * knowing the names of first. Narrow, the bar is the headline's own summary and
 * belongs against it, with the detail underneath.
 *
 * Written out twice on purpose. A `dl` of rows and a flex row of columns are
 * not the same tree, and the version that tries to be both with enough utility
 * classes is the one nobody can change later.
 */
export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <>
      {/* Wide */}
      <div className="hidden flex-wrap gap-8 sm:flex">
        {items.map((it) => (
          <div key={it.label}>
            <p className="flex items-center gap-1.5 text-sm text-stone-500">
              {it.label}
              <Mark swatch={it.swatch} />
            </p>
            <p className="tnum mt-0.5 text-sm">
              <span className="text-stone-800">{formatMoney(it.amount)}</span>
              {it.share !== null && (
                <span className="ml-1.5 text-stone-500">
                  {formatPercent(it.share)}
                </span>
              )}
            </p>
          </div>
        ))}
      </div>

      {/* Narrow */}
      <dl className="flex flex-col sm:hidden">
        {items.map((it) => (
          <div key={it.label} className="flex min-h-9 items-center gap-3">
            <dt className="flex min-w-0 flex-1 items-center gap-2 text-sm text-stone-600">
              <Mark swatch={it.swatch} />
              <span className="truncate">{it.label}</span>
            </dt>
            <dd data-money className="w-12 shrink-0 text-right text-sm text-stone-400">
              {it.share !== null ? formatPercent(it.share) : ''}
            </dd>
            <dd data-money className="w-28 shrink-0 text-right text-sm text-stone-800">
              {formatMoney(it.amount)}
            </dd>
          </div>
        ))}
      </dl>
    </>
  )
}

/** Income has no colour: it is not a segment of the bar, it is the length of
 *  it, and the others are shares of that. An outline says "the whole". */
function Mark({ swatch }: { swatch?: string }) {
  return (
    <span className="grid w-3 shrink-0 place-items-center">
      {swatch ? (
        <Swatch className={swatch} />
      ) : (
        <span aria-hidden className="size-3 rounded-[3px] border border-stone-300" />
      )}
    </span>
  )
}
