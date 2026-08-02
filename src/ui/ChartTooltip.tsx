import { useLayoutEffect, useRef, useState } from 'react'

export type TooltipRow = {
  label: string
  value: string
  /** A short stroke in the series colour. At tooltip density a filled box is
   *  data-weight ink doing a label's job. */
  color?: string
  /** The row the reader came for — the others are context. */
  lead?: boolean
}

/**
 * The readout that follows the pointer over a chart.
 *
 * Three rules it exists to keep:
 *  - It enhances, never gates. Every number in here is reachable without a
 *    pointer: the mark it belongs to carries the same text in its aria-label,
 *    and the metric row beside the chart names each series. That matters more
 *    than usual for us — the composition fills are pale by design and sit under
 *    3:1 against white, so they are never the only thing carrying a value.
 *  - Values lead, labels follow. The legend's hierarchy inverted: here the
 *    reader already has the series and wants the number.
 *  - It never eats a pointer event. Fixed, pointer-events-none, so it cannot
 *    flicker by landing under its own cursor.
 */
export function ChartTooltip({
  x,
  y,
  title,
  rows,
  footnote,
}: {
  x: number
  y: number
  title: string
  rows: TooltipRow[]
  /** What clicking would do — the affordance a cursor alone under-sells. */
  footnote?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    setWidth(ref.current?.offsetWidth ?? 0)
  }, [rows, title])

  // Keep it on screen: the columns at either end of a 12-month chart would
  // otherwise push half of it off the edge.
  const half = width / 2
  const left = Math.min(Math.max(x, half + 8), window.innerWidth - half - 8)

  return (
    <div
      ref={ref}
      role="presentation"
      className="pointer-events-none fixed z-40 -translate-x-1/2 -translate-y-full rounded-lg border border-stone-200 bg-white px-2.5 py-2 whitespace-nowrap shadow-[0px_2px_8px_rgba(0,0,0,0.08)]"
      style={{ left, top: y - 12 }}
    >
      <p className="text-xs font-medium text-stone-800">{title}</p>
      <ul className="mt-1 space-y-0.5">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center gap-2 text-xs">
            <span
              aria-hidden
              className="h-0.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: r.color ?? 'transparent' }}
            />
            <span
              className={`tnum mr-auto ${r.lead ? 'font-medium text-stone-900' : 'text-stone-800'}`}
            >
              {r.value}
            </span>
            <span className="pl-3 text-stone-500">{r.label}</span>
          </li>
        ))}
      </ul>
      {footnote && (
        <p className="mt-1.5 border-t border-stone-100 pt-1.5 text-xs text-stone-400">
          {footnote}
        </p>
      )}
    </div>
  )
}

/**
 * The composition colours, for inline use in a tooltip key.
 *
 * The three fills are our own theme tokens, so they are always emitted. Income
 * is the neutral outline the metric row gives it — written out rather than read
 * from `--color-stone-400`, because Tailwind only emits the variables its
 * utilities use, and a key that silently turns transparent when the last
 * stone-400 class is deleted is not worth the tidiness.
 */
export const SERIES = {
  leftover: 'var(--color-leftover)',
  expense: 'var(--color-expense)',
  saved: 'var(--color-saved)',
  income: '#a8a29e', // stone-400
} as const
