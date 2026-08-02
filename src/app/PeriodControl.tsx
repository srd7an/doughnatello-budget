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
  const { granularity, label, step, setGranularity } = usePeriod()
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
      <div className="flex items-center rounded-full border border-stone-200 bg-white">
        <Step label="Previous period" onClick={() => step(-1)}>
          <CaretLeftIcon size={20} aria-hidden />
        </Step>
        <span className="h-6 w-px bg-stone-200" />
        <Step label="Next period" onClick={() => step(1)}>
          <CaretRightIcon size={20} aria-hidden />
        </Step>
        <span className="h-6 w-px bg-stone-200" />
        <button
          onClick={() => setMenuOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="flex min-h-11 items-center gap-2 rounded-r-full px-3 text-sm font-medium text-stone-700 hover:bg-stone-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
        >
          <CalendarDotsIcon size={20} className="text-stone-500" aria-hidden />
          <span aria-live="polite">{label}</span>
        </button>
      </div>

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
    <button
      onClick={onClick}
      aria-label={label}
      className="grid size-11 place-items-center rounded-full text-stone-600 hover:bg-stone-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
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
