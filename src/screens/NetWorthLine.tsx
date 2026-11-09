import { useLayoutEffect, useRef, useState } from 'react'
import { formatMoney, monthName } from '../lib/format'
import { SM, useMediaQuery } from '../lib/useMediaQuery'
import { ChartTooltip, type TooltipRow } from '../ui/ChartTooltip'

const HEIGHT = 64

/**
 * Net worth across the year, month end to month end.
 *
 * The year's headline is net worth, and the picture under it was income cut
 * into expense, savings and leftover — a different quantity, in different
 * units of meaning, under a title that named neither. This is the picture the
 * headline was missing: the same figure, twelve times, so "+2.897.436 this
 * year" has a shape — steady, or one jump in March when the flat was revalued.
 *
 * It shares the columns' horizontal rhythm: a point sits over the month the
 * column below it stands for, so the eye can drop from a kink in this line to
 * the month that made it.
 *
 * The vertical scale is NOT from zero, and says so. Eighteen million moving by
 * a hundred thousand a month is a flat line on a zero-based axis; the question
 * here is the movement, so the scale is the year's own range, and both ends of
 * it are written on the chart so nobody reads a doubling into a 2% rise.
 */
export function NetWorthLine({
  values,
  opening,
}: {
  /** Net worth at the end of each month; null for one that has not happened. */
  values: (number | null)[]
  /** Net worth on the last day of the year before — where the line starts. */
  opening: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(
    null,
  )
  const wide = useMediaQuery(SM)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth || 640)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width || 640))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const known = values.filter((v): v is number => v !== null)
  if (known.length === 0) return null

  // The same twelve columns and the same gap as the chart underneath.
  const gap = wide ? 8 : 4
  const col = (width - 11 * gap) / 12
  const xOf = (i: number) => i * (col + gap) + col / 2

  const lo = Math.min(opening, ...known)
  const hi = Math.max(opening, ...known)
  const span = Math.max(hi - lo, 1)
  const yOf = (v: number) => HEIGHT - 6 - ((v - lo) / span) * (HEIGHT - 12)

  const last = known.length - 1
  const path =
    `M0,${yOf(opening).toFixed(1)} ` +
    known.map((v, i) => `L${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ')

  const rowsFor = (i: number): TooltipRow[] => {
    const before = i === 0 ? opening : known[i - 1]
    return [
      { label: 'net worth', value: formatMoney(known[i], { whole: true }), lead: true },
      {
        label: 'in the month',
        value: formatMoney(known[i] - before, { signed: true, whole: true }),
      },
    ]
  }

  return (
    <div
      ref={ref}
      className="relative mt-4"
      onPointerMove={(e) => {
        const r = ref.current?.getBoundingClientRect()
        if (!r) return
        const i = Math.min(
          last,
          Math.max(0, Math.floor((e.clientX - r.left) / (col + gap))),
        )
        setHover({ i, x: e.clientX, y: e.clientY })
      }}
      onPointerLeave={() => setHover(null)}
    >
      <svg
        width={width}
        height={HEIGHT}
        className="block overflow-visible"
        role="img"
        aria-label={`Net worth month by month, from ${formatMoney(opening, { whole: true })} at the start of the year to ${formatMoney(known[last], { whole: true })} at the end of ${monthName(last + 1)}. Lowest ${formatMoney(lo, { whole: true })}, highest ${formatMoney(hi, { whole: true })}.`}
      >
        {/* The range, at both ends of it — the scale does not start at zero. */}
        <line x1={0} x2={width} y1={yOf(hi)} y2={yOf(hi)} className="stroke-stone-100" />
        <line x1={0} x2={width} y1={yOf(lo)} y2={yOf(lo)} className="stroke-stone-100" />

        <path
          d={path}
          fill="none"
          className="stroke-stone-800"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {known.map((v, i) => (
          <circle
            key={i}
            cx={xOf(i)}
            cy={yOf(v)}
            r={i === last || hover?.i === i ? 4 : 2.5}
            className={
              i === last || hover?.i === i
                ? 'fill-stone-800 stroke-white'
                : 'fill-stone-800'
            }
            strokeWidth={2}
          />
        ))}
      </svg>
      <p className="mt-1.5 flex justify-between text-xs text-stone-400">
        <span>
          Net worth by month · low{' '}
          <span data-money className="text-stone-500">
            {formatMoney(lo, { whole: true })}
          </span>
          , high{' '}
          <span data-money className="text-stone-500">
            {formatMoney(hi, { whole: true })}
          </span>
        </span>
      </p>

      {hover && (
        <ChartTooltip
          x={hover.x}
          y={hover.y}
          title={`End of ${monthName(hover.i + 1)}`}
          rows={rowsFor(hover.i)}
        />
      )}
    </div>
  )
}
