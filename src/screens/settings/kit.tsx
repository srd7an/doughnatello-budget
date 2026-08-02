import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { formatMoney, toPara } from '../../lib/format'
import { CategoryIcon, ICON_KEYS } from '../../ui/icons'

/**
 * Shared furniture for the Settings detail panels.
 *
 * Settings is config, not flow: no period control, no charts, one subject per
 * screen with a way back. Nine panels share these pieces so they read as one
 * screen visited nine times rather than nine screens.
 */

export function Panel({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-5">
      <section>
        <Link
          to="/settings"
          className="text-sm text-stone-500 hover:text-stone-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          ← Settings
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-stone-500">{description}</p>
        )}
      </section>
      {children}
    </div>
  )
}

export function Card({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={`rounded-2xl border border-stone-200 bg-white ${className}`}
    >
      {children}
    </section>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-stone-200 bg-white p-6 text-center text-sm text-stone-500">
      {children}
    </p>
  )
}

export function Loading() {
  return <p className="py-8 text-center text-sm text-stone-400">Loading…</p>
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="px-1 text-xs text-stone-400">{children}</p>
}

export function Field({
  label,
  hint,
  className = '',
  children,
}: {
  label: string
  hint?: string
  className?: string
  children: ReactNode
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-xs font-medium tracking-wide text-stone-400 uppercase">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-stone-400">{hint}</span>}
    </label>
  )
}

export const inputClass =
  'w-full rounded-lg border border-stone-200 px-3 py-2 text-sm outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-violet-200'

export function TextInput(
  props: React.InputHTMLAttributes<HTMLInputElement>,
) {
  return <input {...props} className={`${inputClass} ${props.className ?? ''}`} />
}

/**
 * Money in, money out — dinars at the edge, para underneath. Never let a
 * component do its own arithmetic on stored amounts.
 */
export function MoneyInput({
  para,
  onChange,
  ...rest
}: {
  para: number
  onChange: (para: number) => void
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [draft, setDraft] = useState(String(Math.round(para / 100)))
  return (
    <div className="flex items-center gap-2">
      <input
        {...rest}
        inputMode="numeric"
        value={draft}
        onChange={(e) => {
          const clean = e.target.value.replace(/[^\d]/g, '')
          setDraft(clean)
          onChange(toPara(Number(clean || '0')))
        }}
        className={`${inputClass} tnum text-right`}
      />
      <span className="text-xs text-stone-400">RSD</span>
    </div>
  )
}

export function PrimaryButton({
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={`min-h-11 rounded-full bg-brand px-4 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-40 ${rest.className ?? ''}`}
    >
      {children}
    </button>
  )
}

export function GhostButton({
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={`min-h-9 rounded-full border border-stone-200 px-3 text-sm text-stone-600 hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-40 ${rest.className ?? ''}`}
    >
      {children}
    </button>
  )
}

/**
 * Destructive actions ask twice, in place. A second click on the same button is
 * cheaper than a modal and — unlike window.confirm — cannot wedge the app.
 */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  className = '',
}: {
  label: string
  confirmLabel: string
  onConfirm: () => void | Promise<unknown>
  className?: string
}) {
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!armed) {
    return (
      <button
        onClick={() => setArmed(true)}
        className={`min-h-9 rounded-full px-3 text-sm text-stone-500 hover:bg-stone-50 hover:text-debt focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${className}`}
      >
        {label}
      </button>
    )
  }
  return (
    <span className="flex items-center gap-1">
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try {
            await onConfirm()
          } finally {
            setBusy(false)
            setArmed(false)
          }
        }}
        className="min-h-9 rounded-full bg-debt px-3 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-40"
      >
        {confirmLabel}
      </button>
      <button
        onClick={() => setArmed(false)}
        className="min-h-9 px-2 text-sm text-stone-500 hover:text-stone-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        Cancel
      </button>
    </span>
  )
}


// Identity colours for categories and funds. Deliberately NOT the composition
// or status tokens — those carry meaning that a user-chosen colour must not
// borrow.
export const COLORS = [
  '#E8632A', '#E0A400', '#EA580C', '#D6336C', '#EC4899', '#DB2777',
  '#22C55E', '#16A34A', '#65A30D', '#3B82F6', '#0EA5E9', '#B45309',
]

export function IconPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (icon: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {ICON_KEYS.map((i) => (
        <button
          key={i}
          type="button"
          aria-label={i}
          aria-pressed={value === i}
          onClick={() => onChange(i)}
          className={`grid size-11 place-items-center rounded-lg border text-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
            value === i
              ? 'border-brand bg-violet-50'
              : 'border-stone-200 hover:bg-stone-50'
          }`}
        >
          <CategoryIcon icon={i} />
        </button>
      ))}
    </div>
  )
}

export function ColorPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (color: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={c}
          aria-pressed={value === c}
          onClick={() => onChange(c)}
          className={`size-11 rounded-lg border-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
            value === c ? 'border-stone-900' : 'border-transparent'
          }`}
        >
          <span
            aria-hidden
            className="block size-full rounded-md"
            style={{ backgroundColor: c }}
          />
        </button>
      ))}
    </div>
  )
}

/** A figure with its label, for the small summary strips atop a panel. */
export function Stat({
  label,
  amount,
  tone,
}: {
  label: string
  amount: number
  tone?: 'saved' | 'debt'
}) {
  return (
    <div>
      <p className="text-xs text-stone-500">{label}</p>
      <p
        data-money
        className={`mt-0.5 font-semibold ${
          tone === 'saved' ? 'text-gain' : tone === 'debt' ? 'text-debt' : ''
        }`}
      >
        {formatMoney(amount)}
      </p>
    </div>
  )
}
