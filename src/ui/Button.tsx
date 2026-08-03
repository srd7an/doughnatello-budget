import type { ButtonHTMLAttributes } from 'react'
import { twMerge } from 'tailwind-merge'

/**
 * Every button in the app, in four kinds.
 *
 * It exists because the weights had drifted: Confirm was semibold, Save was
 * medium, Add transaction was normal, and nothing decided which was right —
 * each one had simply been typed at the time. A button's weight is not a
 * per-button decision, so it is not a per-button class. One place sets it, and
 * that place is here.
 *
 * The variants are what the app actually does, not a colour palette:
 *   primary    — the one thing this screen is for. One per view.
 *   secondary  — a real alternative to it, bordered.
 *   ghost      — an aside. No box until you point at it.
 *   danger     — destructive, and never the primary.
 *
 * Height follows the 44px touch rule: full on a phone, back to 36 from sm up
 * where a pointer does the aiming.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const BASE =
  'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-4 text-sm whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-40 sm:min-h-9'

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'border border-violet-800 bg-brand text-white shadow-[0px_1px_1px_#ddd6fe] hover:opacity-90',
  secondary: 'border border-stone-200 bg-white text-stone-600 hover:bg-stone-50',
  ghost: 'text-stone-500 hover:bg-stone-50 hover:text-stone-700',
  danger: 'text-debt hover:bg-red-50',
}

export function Button({
  variant = 'secondary',
  full = false,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  /** Spans its container — the one action at the bottom of a form. */
  full?: boolean
}) {
  return (
    <button
      {...rest}
      // twMerge, not concatenation: a caller's `hidden` has to beat the base
      // `inline-flex`, and with two display utilities in one class list the
      // winner is whichever Tailwind happened to emit last. That is how a
      // phone ended up with two Add transaction buttons.
      className={twMerge(
        BASE,
        VARIANTS[variant],
        full && 'w-full',
        className,
      )}
    />
  )
}
