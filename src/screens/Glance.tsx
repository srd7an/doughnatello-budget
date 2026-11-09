import type { ReactNode } from 'react'
import { CaretDownIcon, CaretRightIcon } from '../ui/icons'

/**
 * One figure worth knowing before you scroll, in a box.
 *
 * The overview had a headline and then, a screen further down, everything
 * else. What was missing was the middle: the three or four numbers a person
 * opening the app wants beside the headline — what is in the bank, what is
 * still to pay, whether this is a normal month. These are those.
 *
 * A tile is either a statement or a way in. Given `onToggle` it is a button
 * that opens the detail underneath the row, and it says so with a caret and
 * `aria-expanded`; without it, it is a figure and nothing happens when you
 * press it, so it does not look as though something would.
 */
export function Tile({
  label,
  value,
  note,
  noteTone = 'text-stone-400',
  open,
  onToggle,
  onGo,
  aside,
}: {
  label: string
  value: ReactNode
  note?: ReactNode
  /** A text-colour class. Tone is never the only signal — the note says it. */
  noteTone?: string
  open?: boolean
  onToggle?: () => void
  /** Goes somewhere instead of opening something: a caret that points away,
   *  not down, and no `aria-expanded` — nothing here expands. */
  onGo?: () => void
  /** A small picture at the far end, where there is room for one. */
  aside?: ReactNode
}) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-xs text-stone-500">
          <span className="truncate">{label}</span>
          {onToggle && (
            <CaretDownIcon
              size={12}
              aria-hidden
              className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
            />
          )}
          {onGo && <CaretRightIcon size={12} aria-hidden className="shrink-0" />}
        </span>
        <span
          data-money
          className="mt-0.5 block truncate text-base text-stone-800"
        >
          {value}
        </span>
        {note && (
          <span data-money className={`block truncate text-xs ${noteTone}`}>
            {note}
          </span>
        )}
      </span>
      {aside}
    </>
  )
  const box =
    'flex min-w-0 items-center gap-3 rounded-xl border px-3 py-2.5 text-left'
  return onToggle || onGo ? (
    <button
      type="button"
      onClick={onToggle ?? onGo}
      aria-expanded={onToggle ? open : undefined}
      className={`${box} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
        open
          ? 'border-stone-400 bg-stone-50'
          : 'border-stone-200 hover:bg-stone-50'
      }`}
    >
      {body}
    </button>
  ) : (
    <div className={`${box} border-stone-200`}>{body}</div>
  )
}
