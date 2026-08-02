import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * A small panel anchored under its trigger.
 *
 * Used where a grid of choices would otherwise sit permanently on the page —
 * fifteen swatches and thirty glyphs are noise until the moment you want to
 * change one. Closes on Escape, on an outside click, and after a choice.
 *
 * Deliberately not a modal: it does not trap focus or block the page, because
 * picking a colour is not a decision that deserves to interrupt anything.
 */
export function Popover({
  trigger,
  label,
  children,
  align = 'left',
}: {
  /** Rendered inside the trigger button. */
  trigger: ReactNode
  /** Accessible name for the trigger. */
  label: string
  /** Receives a `close` callback so a choice can dismiss the panel. */
  children: (close: () => void) => ReactNode
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        className="flex min-h-9 items-center gap-2 rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-800 hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        {trigger}
      </button>

      {open && (
        <div
          role="dialog"
          className={`absolute top-full z-50 mt-1 rounded-xl border border-stone-200 bg-white p-2 shadow-[0px_6px_10px_-4px_rgba(0,0,0,0.1)] ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}
