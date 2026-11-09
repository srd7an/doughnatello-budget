import { useLayoutEffect, useRef, useState } from 'react'
import { formatMoney } from '../lib/format'
import { formatDayMonthYear } from '../lib/dates'
import { ChartTooltip } from '../ui/ChartTooltip'

const HEIGHT = 120

export type Movement = {
  occurredOn: string // YYYY-MM-DD
  /** What the row did to this fund: + in, − out. On a loan, + is a payment. */
  potAmount: number
}

/**
 * The figure after each movement, oldest first.
 *
 * A fund starts empty and is the running sum. A loan starts at what was
 * borrowed and every payment takes it down — the same rows, read the other
 * way, because on a loan the number that matters is what is LEFT.
 */
export function runningBalance(
  rows: Movement[],
  loan: { original: number } | null,
) {
  const sorted = [...rows].sort((a, b) =>
    a.occurredOn < b.occurredOn ? -1 : a.occurredOn > b.occurredOn ? 1 : 0,
  )
  let run = loan ? loan.original : 0
  return sorted.map((r) => {
    run += loan ? -r.potAmount : r.potAmount
    return { on: r.occurredOn, value: run, change: r.potAmount }
  })
}

/**
 * How fast it has been moving lately, per month, and when that gets it to
 * where it is going.
 *
 * "Lately" is the last six months, because the question is about the habit
 * now, not the average since the fund was opened — a fund fed 5.000 a month
 * for two years and 20.000 since spring is a 20.000 fund. Null when there is
 * nowhere to get to, or the pace is not getting there.
 *
 * On a loan this ignores interest, and the screen says so. The rate is known
 * but the schedule is not; a date that pretends otherwise is worse than one
 * that names what it left out.
 */
export function projectFinish(
  rows: Movement[],
  remaining: number,
  today: string,
): { perMonth: number; month: string } | null {
  const from = shiftMonths(today.slice(0, 7), -6)
  const recent = rows
    .filter((r) => r.occurredOn.slice(0, 7) > from && r.occurredOn <= today)
    .reduce((s, r) => s + r.potAmount, 0)
  const perMonth = recent / 6
  if (remaining <= 0 || perMonth <= 0) return null
  const months = Math.ceil(remaining / perMonth)
  // Past a lifetime is not a forecast.
  if (months > 600) return null
  return { perMonth, month: shiftMonths(today.slice(0, 7), months) }
}

function shiftMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const idx = y * 12 + (m - 1) + delta
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
}

const toTime = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/**
 * The fund's balance over its whole life, as steps.
 *
 * Steps, not a slope: money arrives on a day and sits there. A line drawn
 * between two transfers says the fund grew a little every day in between, and
 * it did not.
 *
 * It replaces nothing — the list underneath is still every movement — but the
 * list of a healthy fund is the same row twenty times, "20.000" all the way
 * down, and the two things anyone wants from it are not in it: the shape, and
 * the one month something came OUT.
 */
export function PotHistory({
  rows,
  loan,
  goal,
  color,
  today,
}: {
  rows: Movement[]
  loan: { original: number } | null
  /** A fund's target. Drawn as a line to reach when it is near enough to be
   *  on the same picture as the balance. */
  goal: number | null
  color: string
  today: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(
    null,
  )

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth || 640)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width || 640))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const points = runningBalance(rows, loan)
  // One movement is a figure, not a history.
  if (points.length < 2) return null

  const start = loan ? loan.original : 0
  const t0 = toTime(points[0].on)
  const t1 = Math.max(toTime(today), toTime(points[points.length - 1].on))
  const span = Math.max(t1 - t0, 1)
  const xOf = (iso: string) => ((toTime(iso) - t0) / span) * width

  const values = points.map((p) => p.value)
  const peak = Math.max(start, ...values)
  // The target shares the picture only when the balance is a visible part of
  // the way there. A fund at 2% of its goal is a flat line under a far one.
  const showGoal = !loan && goal !== null && goal > 0 && goal <= peak * 4
  const top = Math.max(peak, showGoal && goal ? goal : 0, 1) * 1.06
  const bottom = Math.min(0, ...values)
  const yOf = (v: number) => HEIGHT - ((v - bottom) / (top - bottom)) * HEIGHT

  let d = `M0,${yOf(start).toFixed(1)}`
  let prev = start
  for (const p of points) {
    const x = xOf(p.on).toFixed(1)
    d += ` L${x},${yOf(prev).toFixed(1)} L${x},${yOf(p.value).toFixed(1)}`
    prev = p.value
  }
  d += ` L${width},${yOf(prev).toFixed(1)}`
  const area = `${d} L${width},${yOf(bottom).toFixed(1)} L0,${yOf(bottom).toFixed(1)} Z`

  const last = points[points.length - 1]
  const firstYear = points[0].on.slice(0, 4)
  const lastYear = today.slice(0, 4)

  return (
    <div
      ref={ref}
      className="relative"
      onPointerMove={(e) => {
        const r = ref.current?.getBoundingClientRect()
        if (!r) return
        const x = e.clientX - r.left
        // The movement in force under the pointer: the last one at or before it.
        let i = 0
        for (let k = 0; k < points.length; k++) if (xOf(points[k].on) <= x) i = k
        setHover({ i, x: e.clientX, y: e.clientY })
      }}
      onPointerLeave={() => setHover(null)}
    >
      <svg
        width={width}
        height={HEIGHT}
        className="block overflow-visible"
        role="img"
        aria-label={`${loan ? 'What was owed' : 'The balance'} over time, from ${formatMoney(start, { whole: true })} on ${formatDayMonthYear(points[0].on)} to ${formatMoney(last.value, { whole: true })} now, across ${points.length} movements.`}
      >
        {showGoal && goal !== null && (
          <g>
            <line
              x1={0}
              x2={width}
              y1={yOf(goal)}
              y2={yOf(goal)}
              className="stroke-stone-300"
              strokeDasharray="2 3"
            />
            <text
              x={2}
              y={yOf(goal) - 5}
              data-money
              className="fill-stone-400 text-[11px]"
            >
              Target {formatMoney(goal, { whole: true })}
            </text>
          </g>
        )}
        <path d={area} style={{ fill: color }} opacity={0.12} />
        <path
          d={d}
          fill="none"
          style={{ stroke: color }}
          strokeWidth={2}
          strokeLinejoin="round"
        />
        <line
          x1={0}
          x2={width}
          y1={yOf(Math.max(bottom, 0))}
          y2={yOf(Math.max(bottom, 0))}
          className="stroke-stone-200"
        />
        <circle
          cx={width}
          cy={yOf(last.value)}
          r={4}
          style={{ fill: color }}
          className="stroke-white"
          strokeWidth={2}
        />
        {hover && (
          <line
            x1={xOf(points[hover.i].on)}
            x2={xOf(points[hover.i].on)}
            y1={0}
            y2={HEIGHT}
            className="stroke-stone-300"
          />
        )}
      </svg>
      <p className="mt-1.5 flex justify-between text-xs text-stone-400">
        <span>{formatDayMonthYear(points[0].on)}</span>
        <span>{firstYear === lastYear ? 'Today' : `Today, ${lastYear}`}</span>
      </p>

      {hover && (
        <ChartTooltip
          x={hover.x}
          y={hover.y}
          title={formatDayMonthYear(points[hover.i].on)}
          rows={[
            {
              label: loan ? 'still owed' : 'in the fund',
              value: formatMoney(points[hover.i].value),
              color,
              lead: true,
            },
            {
              label: loan
                ? 'paid'
                : points[hover.i].change < 0
                  ? 'taken out'
                  : 'put in',
              value: formatMoney(Math.abs(points[hover.i].change)),
            },
          ]}
        />
      )}
    </div>
  )
}
