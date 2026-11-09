import { useLayoutEffect, useRef, useState } from 'react'
import { formatMoney, formatPercent } from '../lib/format'
import { ChartTooltip, SERIES, type TooltipRow } from '../ui/ChartTooltip'
import { Swatch } from '../ui/Swatch'

export type PaceData = {
  days: number
  /** Spending on each day of the month, para. */
  daily: number[]
  /** Income landing on each day of the month, para. */
  income: number[]
  /** What a typical earlier month had spent by each day — null with no history. */
  typical: number[] | null
  typicalMonths: number
}

const HEIGHT = 168
const STRIP = 44
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/**
 * HOW the month went, where the bar above only says how it ENDED.
 *
 * Two pictures on one shared day axis, never one picture with two scales:
 *
 *  - the running total of spending, against what a typical month had spent by
 *    the same day (the average of the earlier months, dashed). Above the dashed
 *    line is a month running hot; below it, a calm one. On the month you are
 *    in, the line stops at today and a dotted continuation shows where the
 *    current pace lands by the last day.
 *  - underneath, each day's spending as a column, so the lumps that made the
 *    line jump — rent, the big shop — have a place to be seen and clicked.
 *
 * Income is a ceiling, drawn as a rule, only when it is close enough to the
 * spending to be worth the room: a ceiling far above every line would flatten
 * them into the floor and say nothing but "you did not spend all of it".
 */
export function MonthPace({
  data,
  year,
  month,
  isCurrentMonth,
  onSelectDay,
}: {
  data: PaceData
  year: number
  month: number
  isCurrentMonth: boolean
  /** Given a YYYY-MM-DD — clicking a day asks for its transactions. */
  onSelectDay?: (day: string, label: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  const [hover, setHover] = useState<{ d: number; x: number; y: number } | null>(
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

  const { days, daily, typical } = data
  const now = new Date()
  // The last day that has happened. A past month has happened in full; a
  // future one not at all.
  const lastDay = isCurrentMonth
    ? now.getDate()
    : new Date(year, month - 1, 1) > now
      ? 0
      : days

  const cumulative: number[] = []
  daily.reduce((run, x, i) => (cumulative[i] = run + x), 0)
  const spent = lastDay > 0 ? cumulative[lastDay - 1] : 0
  const totalIncome = data.income.reduce((s, x) => s + x, 0)

  const typicalNow = typical && lastDay > 0 ? typical[lastDay - 1] : null
  const typicalEnd = typical ? typical[days - 1] : null

  // Whole dinars: a pace is an estimate, and kopecks on it claim a precision
  // it does not have.
  const whole = (para: number) => Math.round(para / 100) * 100
  const perDay = lastDay > 0 ? whole(spent / lastDay) : 0

  // Where the month lands if the rest of it goes as the rest of a typical
  // month does. Not today's average times thirty: a month that paid its rent on
  // the 1st would "be on pace" for thirty rents. Without history, the same idea
  // from this month alone — its average day, leaving out its single biggest.
  const projected = (() => {
    if (!isCurrentMonth || lastDay < 3 || lastDay >= days) return null
    if (typical && typicalEnd !== null && typicalNow !== null) {
      return whole(spent + (typicalEnd - typicalNow))
    }
    const seen = daily.slice(0, lastDay)
    const ordinary = (spent - Math.max(...seen)) / (lastDay - 1)
    return whole(spent + ordinary * (days - lastDay))
  })()

  const peak = Math.max(
    spent,
    projected ?? 0,
    typicalEnd ?? 0,
    ...cumulative.slice(0, lastDay),
    1,
  )
  const showIncome = totalIncome > 0 && totalIncome <= peak * 1.6
  const yMax = Math.max(peak, showIncome ? totalIncome : 0) * 1.08

  const step = width / days
  const xOf = (d: number) => (d + 0.5) * step // centre of day d (0-based)
  const yOf = (v: number) => HEIGHT - (v / yMax) * HEIGHT

  const spentPts = cumulative
    .slice(0, lastDay)
    .map((v, d) => `${xOf(d).toFixed(1)},${yOf(v).toFixed(1)}`)
  const spentLine = spentPts.length ? `M${xOf(0) - step / 2},${HEIGHT} L${spentPts.join(' L')}` : ''
  const spentArea = spentPts.length
    ? `${spentLine} L${xOf(lastDay - 1).toFixed(1)},${HEIGHT} Z`
    : ''
  const typicalLine = typical
    ? `M${xOf(0) - step / 2},${HEIGHT} L` +
      typical.map((v, d) => `${xOf(d).toFixed(1)},${yOf(v).toFixed(1)}`).join(' L')
    : ''

  const dailyMax = Math.max(...daily.slice(0, Math.max(lastDay, 1)), 1)
  const barW = Math.max(Math.min(step * 0.6, 14), 2)

  // The few figures worth reading without the picture.
  const spendDays = daily.slice(0, lastDay).filter((x) => x > 0).length
  const quietDays = lastDay - spendDays
  const biggest = daily
    .slice(0, lastDay)
    .reduce((best, x, d) => (x > daily[best] ? d : best), 0)

  const dayIso = (d: number) =>
    `${year}-${String(month).padStart(2, '0')}-${String(d + 1).padStart(2, '0')}`
  const dayName = (d: number) => `${d + 1} ${MONTHS[month - 1]}`

  const diff = typicalNow !== null ? spent - typicalNow : null
  const diffShare = typicalNow ? Math.abs(diff ?? 0) / typicalNow : null

  const rowsFor = (d: number): TooltipRow[] => {
    const rows: TooltipRow[] = [
      { label: 'spent this day', value: formatMoney(daily[d]), color: SERIES.leftover },
    ]
    if (d < lastDay) {
      rows.unshift({
        label: 'spent so far',
        value: formatMoney(cumulative[d]),
        color: SERIES.expense,
        lead: true,
      })
    }
    if (typical) {
      rows.push({
        label: 'typical by now',
        value: formatMoney(typical[d]),
        color: SERIES.income,
      })
      if (d < lastDay) {
        const delta = cumulative[d] - typical[d]
        rows.push({
          label: delta > 0 ? 'above typical' : 'below typical',
          value: formatMoney(Math.abs(delta)),
        })
      }
    }
    return rows
  }

  const pick = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return null
    return Math.min(days - 1, Math.max(0, Math.floor((clientX - r.left) / step)))
  }

  // Ticks on the day axis: the 1st, every week, and the last day.
  const ticks = [0, 6, 13, 20, 27, days - 1].filter(
    (d, i, a) => d < days && a.indexOf(d) === i && !(d === 27 && days - 1 - d < 2),
  )

  if (lastDay === 0) {
    return (
      <section aria-label="Spending pace">
        <h2 className="text-base font-medium tracking-[-0.16px] text-stone-800">
          Spending pace
        </h2>
        <p className="mt-1 text-sm text-stone-500">
          This month has not started yet.
        </p>
      </section>
    )
  }

  return (
    <section aria-label="Spending pace">
      <h2 className="text-base font-medium tracking-[-0.16px] text-stone-800">
        Spending pace
      </h2>
      {/* The chart as a sentence. Status is said in words and an arrow, never
          by the colour of the number alone. */}
      <p className="mt-1 text-sm text-stone-500">
        <span data-money className="text-stone-800">
          {formatMoney(spent)}
        </span>{' '}
        spent {lastDay < days ? `by ${dayName(lastDay - 1)}` : 'this month'}
        {diff !== null && diffShare !== null && Math.abs(diff) >= 100 ? (
          <>
            {' — '}
            <span
              className={
                diff > 0 ? 'text-status-over' : 'text-status-under'
              }
            >
              {diff > 0 ? '▲' : '▼'}{' '}
              <span data-money>{formatMoney(Math.abs(diff))}</span> (
              {formatPercent(diffShare)}) {diff > 0 ? 'more' : 'less'}
            </span>{' '}
            than a typical month{lastDay < days ? ' by this day' : ''}
          </>
        ) : diff !== null ? (
          ' — right on a typical month'
        ) : null}
        .
      </p>

      {/* Key. One coloured series and two neutral references, each named. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-500">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-3 rounded-full bg-expense" />
          Spent so far
        </span>
        {typical && (
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="w-3 border-t border-dashed border-stone-400" />
            Typical month
            <span className="text-stone-400">
              (avg. of last {data.typicalMonths})
            </span>
          </span>
        )}
        {projected !== null && (
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="w-3 border-t-2 border-dotted border-expense" />
            Where it is heading
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <Swatch className="bg-leftover" orient="column" />
          Each day
        </span>
      </div>

      <div
        ref={ref}
        className="relative mt-3 touch-pan-y select-none"
        onPointerMove={(e) => {
          const d = pick(e.clientX)
          if (d !== null) setHover({ d, x: e.clientX, y: e.clientY })
        }}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => {
          const d = pick(e.clientX)
          if (d !== null && d < lastDay && daily[d] > 0)
            onSelectDay?.(dayIso(d), dayName(d))
        }}
      >
        <svg
          width={width}
          height={HEIGHT + 8 + STRIP}
          className="block overflow-visible"
          role="img"
          aria-label={`Spent ${formatMoney(spent)} by day ${lastDay} of ${days}${
            typicalNow !== null ? `; a typical month had spent ${formatMoney(typicalNow)} by then` : ''
          }${projected !== null ? `; heading for ${formatMoney(projected)}` : ''}.`}
        >
          {/* Recessive guides: the floor, and a quarter-way grid. */}
          {[0.25, 0.5, 0.75].map((f) => (
            <line
              key={f}
              x1={0}
              x2={width}
              y1={HEIGHT * f}
              y2={HEIGHT * f}
              className="stroke-stone-100"
            />
          ))}

          <path d={spentArea} className="fill-violet-100/70" />

          {showIncome && (
            <g>
              <line
                x1={0}
                x2={width}
                y1={yOf(totalIncome)}
                y2={yOf(totalIncome)}
                className="stroke-stone-300"
                strokeDasharray="2 3"
              />
              <text
                x={width - 2}
                y={yOf(totalIncome) - 5}
                textAnchor="end"
                className="fill-stone-400 text-[11px]"
              >
                Income {formatMoney(totalIncome)}
              </text>
            </g>
          )}

          {/* Today, on the month you are in. */}
          {isCurrentMonth && lastDay < days && (
            <line
              x1={xOf(lastDay - 1)}
              x2={xOf(lastDay - 1)}
              y1={0}
              y2={HEIGHT}
              className="stroke-stone-200"
            />
          )}

          {typical && (
            <path
              d={typicalLine}
              fill="none"
              className="stroke-stone-400"
              strokeWidth={1.5}
              strokeDasharray="4 4"
            />
          )}

          {projected !== null && (
            <line
              x1={xOf(lastDay - 1)}
              y1={yOf(spent)}
              x2={xOf(days - 1)}
              y2={yOf(projected)}
              className="stroke-expense"
              strokeWidth={2}
              strokeDasharray="1 4"
              strokeLinecap="round"
            />
          )}

          <path
            d={spentLine}
            fill="none"
            className="stroke-expense"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Direct labels at the ends, where the eye finishes reading. */}
          <circle
            cx={xOf(lastDay - 1)}
            cy={yOf(spent)}
            r={4}
            className="fill-expense stroke-white"
            strokeWidth={2}
          />
          {projected !== null && (
            <text
              x={xOf(days - 1)}
              y={yOf(projected) - 8}
              textAnchor="end"
              className="fill-stone-500 text-[11px]"
            >
              ≈ {formatMoney(projected)}
            </text>
          )}

          <line x1={0} x2={width} y1={HEIGHT} y2={HEIGHT} className="stroke-stone-200" />

          {/* The days, as their own small chart under the shared axis. */}
          <g transform={`translate(0 ${HEIGHT + 8})`}>
            {daily.map((v, d) => {
              if (d >= lastDay) {
                return (
                  <rect
                    key={d}
                    x={xOf(d) - 1}
                    y={STRIP - 2}
                    width={2}
                    height={2}
                    rx={1}
                    className="fill-stone-200"
                  />
                )
              }
              const h = v > 0 ? Math.max((v / dailyMax) * STRIP, 2) : 0
              const active = hover?.d === d
              return (
                <rect
                  key={d}
                  x={xOf(d) - barW / 2}
                  y={STRIP - h}
                  width={barW}
                  height={h}
                  rx={Math.min(2, barW / 2)}
                  className={active ? 'fill-expense' : 'fill-leftover'}
                />
              )
            })}
          </g>

          {hover && (
            <g pointerEvents="none">
              <line
                x1={xOf(hover.d)}
                x2={xOf(hover.d)}
                y1={0}
                y2={HEIGHT + 8 + STRIP}
                className="stroke-stone-300"
              />
              {hover.d < lastDay && (
                <circle
                  cx={xOf(hover.d)}
                  cy={yOf(cumulative[hover.d])}
                  r={4}
                  className="fill-white stroke-expense"
                  strokeWidth={2}
                />
              )}
            </g>
          )}
        </svg>

        {/* Day axis */}
        <div className="relative mt-1.5 h-4 text-xs text-stone-400">
          {ticks.map((d) => (
            <span
              key={d}
              className="tnum absolute -translate-x-1/2"
              style={{ left: xOf(d) }}
            >
              {d + 1}
            </span>
          ))}
        </div>

        {hover && (
          <ChartTooltip
            x={hover.x}
            y={hover.y}
            title={dayName(hover.d)}
            rows={rowsFor(hover.d)}
            footnote={
              onSelectDay && hover.d < lastDay && daily[hover.d] > 0
                ? 'Click to see this day'
                : undefined
            }
          />
        )}
      </div>

      {/* The figures a person asks of a month, readable with no pointer. */}
      <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <Stat label="Per day" value={formatMoney(perDay)} />
        <Stat
          label="Biggest day"
          value={daily[biggest] > 0 ? formatMoney(daily[biggest]) : '—'}
          note={daily[biggest] > 0 ? dayName(biggest) : undefined}
          onClick={
            daily[biggest] > 0 && onSelectDay
              ? () => onSelectDay(dayIso(biggest), dayName(biggest))
              : undefined
          }
        />
        <Stat
          label="No-spend days"
          value={String(quietDays)}
          note={`of ${lastDay}`}
        />
        {projected !== null ? (
          <Stat
            label="Heading for"
            value={formatMoney(projected)}
            note={
              typicalEnd
                ? `typical ${formatMoney(typicalEnd)}`
                : totalIncome > 0
                  ? `${formatPercent(projected / totalIncome)} of income`
                  : undefined
            }
          />
        ) : (
          <Stat
            label={typicalEnd !== null ? 'Typical month' : 'Spent'}
            value={formatMoney(typicalEnd ?? spent)}
            note={
              typicalEnd !== null && lastDay === days && typicalEnd > 0
                ? `${spent > typicalEnd ? '+' : '−'}${formatPercent(
                    Math.abs(spent - typicalEnd) / typicalEnd,
                  )} this month`
                : undefined
            }
          />
        )}
      </div>
    </section>
  )
}

function Stat({
  label,
  value,
  note,
  onClick,
}: {
  label: string
  value: string
  note?: string
  onClick?: () => void
}) {
  const body = (
    <>
      <p className="text-xs text-stone-500">{label}</p>
      <p className="tnum mt-0.5 text-base text-stone-800">
        <span data-money>{value}</span>
      </p>
      {note && <p className="text-xs text-stone-400">{note}</p>}
    </>
  )
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className="text-left underline-offset-4 hover:[&_[data-money]]:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      {body}
    </button>
  ) : (
    <div>{body}</div>
  )
}
