import { useEffect, useRef, useState } from 'react'
import { usePeriod } from '../period/PeriodContext'
import {
  CalendarDotsIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CheckIcon,
} from '../ui/icons'

/**
 * The primary navigation. Prev/next steps within the current granularity; the
 * calendar button opens a small menu to switch between Month and Year — which
 * is how you move between the two overview zoom levels.
 */
export function PeriodControl() {
  const { granularity, label, isCurrent, step, setGranularity, goToToday } =
    usePeriod()
  const [menuOpen, setMenuOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

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
        <Step label="Next period" onClick={() => step(1)}>
          <CaretRightIcon size={16} aria-hidden />
        </Step>
        <span aria-hidden className="w-px self-stretch bg-stone-200" />
        <button
          onClick={() => setMenuOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="flex items-center gap-1.5 px-2.5 text-sm font-medium text-stone-700 hover:bg-stone-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
        >
          <CalendarDotsIcon size={16} className="text-stone-500" aria-hidden />
          <span aria-live="polite">{label}</span>
        </button>
      </div>

      {/* Only when you have wandered off. A "Today" that is always there is a
          button that usually does nothing, and its absence is how you know
          where you are. */}
      {!isCurrent && (
        <button
          onClick={goToToday}
          className="ml-2 flex h-11 items-center rounded-full px-3 text-sm text-brand hover:bg-violet-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:h-8"
        >
          Today
        </button>
      )}

      {menuOpen && (
        <div
          role="menu"
          className="absolute left-0 top-full z-40 mt-2 w-36 rounded-xl border border-stone-200 bg-white p-1"
        >
          <MenuItem
            active={granularity === 'month'}
            onClick={() => {
              setGranularity('month')
              setMenuOpen(false)
            }}
          >
            Month
          </MenuItem>
          <MenuItem
            active={granularity === 'year'}
            onClick={() => {
              setGranularity('year')
              setMenuOpen(false)
            }}
          >
            Year
          </MenuItem>
        </div>
      )}
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

function MenuItem({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      role="menuitemradio"
      aria-checked={active}
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      {children}
      {active && <CheckIcon size={16} className="text-brand" aria-hidden />}
    </button>
  )
}
