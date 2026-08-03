import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

/**
 * A small panel anchored under its trigger.
 *
 * Used where a grid of choices would otherwise sit permanently on the page —
 * fifteen swatches and thirty glyphs are noise until the moment you want to
 * change one. Closes on Escape, on an outside click, and after a choice.
 *
 * The panel is rendered into document.body rather than beside its trigger,
 * which is not fussiness: every place this is used sits inside something that
 * clips. The transaction card has overflow-hidden for its rounded corners, the
 * modal scrolls its own body, the settings panel scrolls too — and an
 * absolutely positioned child of any of those is cut off at the edge. The
 * repeat popover and the icon pickers were simply invisible below the fold of
 * their own card.
 *
 * Position is therefore measured, not inherited: fixed coordinates taken from
 * the trigger, flipped above it when there is no room below, and clamped to
 * the viewport so a right-aligned panel near the edge stays on screen.
 *
 * Deliberately not a modal: it does not trap focus or block the page, because
 * picking a colour is not a decision that deserves to interrupt anything.
 */
export function Popover({
  trigger,
  label,
  children,
  align = 'left',
  triggerClassName,
}: {
  /** Rendered inside the trigger button. */
  trigger: ReactNode
  /** Accessible name for the trigger. */
  label: string
  /** Receives a `close` callback so a choice can dismiss the panel. */
  children: (close: () => void) => ReactNode
  align?: 'left' | 'right'
  /** Replaces the default trigger styling — the transaction form's rows want
   *  a pill, and its "+ Loan" wants no chrome at all. */
  triggerClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  // Measured before paint, so it never appears in the wrong place first.
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const t = triggerRef.current?.getBoundingClientRect()
      const p = panelRef.current?.getBoundingClientRect()
      if (!t) return
      const w = p?.width ?? 0
      const h = p?.height ?? 0
      const gap = 4

      const below = t.bottom + gap
      const top = below + h > window.innerHeight - 8 && t.top - gap - h > 8
        ? t.top - gap - h // no room under it, and there is room over it
        : below

      const wanted = align === 'right' ? t.right - w : t.left
      const left = Math.min(Math.max(wanted, 8), window.innerWidth - w - 8)

      setPos({ top, left })
    }
    place()
    // A scroll or resize moves the trigger out from under the panel.
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, align])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      // The panel is not inside the trigger's tree any more, so both count as
      // "inside" — otherwise choosing an option would close it before the
      // click landed.
      if (panelRef.current?.contains(target)) return
      if (triggerRef.current?.contains(target)) return
      setOpen(false)
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
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        className={
          triggerClassName ??
          'flex min-h-11 items-center gap-2 rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-800 hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:min-h-9'
        }
      >
        {trigger}
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={label}
            className="fixed z-[60] rounded-xl border border-stone-200 bg-white p-2 shadow-[0px_6px_10px_-4px_rgba(0,0,0,0.1)]"
            style={{
              top: pos?.top ?? 0,
              left: pos?.left ?? 0,
              // Invisible until measured, rather than flashing at 0,0.
              visibility: pos ? 'visible' : 'hidden',
            }}
          >
            {children(() => setOpen(false))}
          </div>,
          document.body,
        )}
    </>
  )
}
