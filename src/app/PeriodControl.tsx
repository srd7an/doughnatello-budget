import { useEffect, useRef, useState } from 'react'
import { usePeriod } from '../period/PeriodContext'
import { SM, useMediaQuery } from '../lib/useMediaQuery'
import { monthName } from '../lib/format'
import {
  CalendarDotsIcon,
  CaretLeftIcon,
  CaretRightIcon,
} from '../ui/icons'

/**
 * The primary navigation: which period, and a way to any other.
 *
 * ‹ November 2026 › — the arrows on either side of the thing they step, which
 * is where every calendar puts them. They sat together on the left, before the
 * name, and read as two buttons that happened to be next to a date.
 *
 * The name opens a picker rather than a two-line menu. The menu could only say
 * Month or Year; getting from November to February was nine presses of an
 * arrow, or a detour through the year to click a column nobody had been told
 * was a button. The picker is a year of months and the year itself: one press
 * to anywhere in it.
 */
export function PeriodControl() {
  const { label, shortLabel, isCurrent, step, goToToday } = usePeriod()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const wide = useMediaQuery(SM)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative flex items-center" ref={ref}>
      {/* The height is the whole control, border included — box-sizing is
          border-box — and the segments stretch into it rather than setting a
          height of their own, so the dividers and the hover fills reach both
          edges.

          44px on a phone, 32px from sm up: a thumb needs the target, a pointer
          does not, and this is the primary navigation so it is the one control
          that cannot be a near miss. */}
      <div className="flex h-11 items-stretch overflow-hidden rounded-full border border-stone-200 bg-white sm:h-8">
        <Step label="Previous period" onClick={() => step(-1)}>
          <CaretLeftIcon size={16} aria-hidden />
        </Step>
        <span aria-hidden className="w-px self-stretch bg-stone-200" />
        <button
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`${label} — choose a period`}
          // Never wraps. The whole word on a phone left "October 2026" on two
          // lines the moment Today appeared beside it, in a control whose
          // height is fixed — so the short form there, the long one where
          // there is room.
          className="flex items-center gap-1.5 px-2.5 text-sm font-medium whitespace-nowrap text-stone-700 hover:bg-stone-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
        >
          <CalendarDotsIcon size={16} className="text-stone-500" aria-hidden />
          <span aria-live="polite">{wide ? label : shortLabel}</span>
        </button>
        <span aria-hidden className="w-px self-stretch bg-stone-200" />
        <Step label="Next period" onClick={() => step(1)}>
          <CaretRightIcon size={16} aria-hidden />
        </Step>
      </div>

      {/* Only when you have wandered off. A "Today" that is always there is a
          button that usually does nothing, and its absence is how you know
          where you are. */}
      {!isCurrent && (
        <button
          onClick={goToToday}
          className="ml-1 flex h-11 items-center rounded-full px-3 text-sm text-brand hover:bg-violet-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:ml-2 sm:h-8"
        >
          Today
        </button>
      )}

      {open && <Picker onClose={() => setOpen(false)} />}
    </div>
  )
}

/**
 * A year of months, and the year.
 *
 * It opens on the year you are in and its own arrows turn the page without
 * going anywhere — choosing is the click on a month, so looking at 2025 to find
 * March does not move the screen behind it until you have found it.
 *
 * Three states a month can be in, each said twice so none is colour alone:
 * the one on screen is filled and `aria-current`; today's wears a ring and says
 * so in its name; a month that has not happened is dimmed and still opens —
 * a rule that posts in January is a reason to look at January.
 */
function Picker({ onClose }: { onClose: () => void }) {
  const { granularity, year, month, openMonth, openYear } = usePeriod()
  const [shown, setShown] = useState(year)
  const now = new Date()
  const thisYear = now.getFullYear()
  const thisMonth = now.getMonth() + 1

  return (
    <div
      role="dialog"
      aria-label="Choose a period"
      // Upward: this control sits at the foot of the screen, and a panel
      // dropping from there is a panel below the fold.
      className="absolute bottom-full left-0 z-40 mb-2 w-64 rounded-2xl border border-stone-200 bg-white p-2 shadow-[0px_6px_10px_-4px_rgba(0,0,0,0.1)]"
    >
      <div className="flex items-center justify-between">
        <button
          onClick={() => setShown((y) => y - 1)}
          aria-label="Previous year"
          className="grid size-11 place-items-center rounded-full text-stone-600 hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-brand sm:size-8"
        >
          <CaretLeftIcon size={16} aria-hidden />
        </button>
        <span aria-live="polite" className="text-sm font-medium text-stone-800">
          {shown}
        </span>
        <button
          onClick={() => setShown((y) => y + 1)}
          aria-label="Next year"
          className="grid size-11 place-items-center rounded-full text-stone-600 hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-brand sm:size-8"
        >
          <CaretRightIcon size={16} aria-hidden />
        </button>
      </div>

      <div className="mt-1 grid grid-cols-4 gap-1">
        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
          const selected =
            granularity === 'month' && shown === year && m === month
          const today = shown === thisYear && m === thisMonth
          const future =
            shown > thisYear || (shown === thisYear && m > thisMonth)
          return (
            <button
              key={m}
              onClick={() => {
                openMonth(shown, m)
                onClose()
              }}
              aria-current={selected ? 'date' : undefined}
              aria-label={`${monthName(m)} ${shown}${today ? ', this month' : ''}`}
              className={`h-11 rounded-lg text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:h-9 ${
                selected
                  ? 'bg-brand font-medium text-white'
                  : `hover:bg-stone-100 ${future ? 'text-stone-400' : 'text-stone-700'} ${
                      today ? 'ring-1 ring-brand ring-inset' : ''
                    }`
              }`}
            >
              {monthName(m, true)}
            </button>
          )
        })}
      </div>

      <button
        onClick={() => {
          openYear(shown)
          onClose()
        }}
        aria-current={
          granularity === 'year' && shown === year ? 'true' : undefined
        }
        className={`mt-2 flex h-11 w-full items-center justify-center rounded-lg text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:h-9 ${
          granularity === 'year' && shown === year
            ? 'bg-brand text-white'
            : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
        }`}
      >
        All of {shown}
      </button>
    </div>
  )
}

function Step({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    // No radius of its own: the hover fill is the whole segment, corner to
    // corner, and the pill's own overflow-hidden rounds off the outer ends.
    <button
      onClick={onClick}
      aria-label={label}
      className="grid w-11 place-items-center text-stone-600 hover:bg-stone-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand sm:w-8"
    >
      {children}
    </button>
  )
}
