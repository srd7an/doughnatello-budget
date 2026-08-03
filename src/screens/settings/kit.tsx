import { useState, type ReactNode } from 'react'
import {
  formatMoney,
  inputToPara,
  paraToInput,
  sanitizeMoneyInput,
} from '../../lib/format'
import { CaretRightIcon, CategoryIcon, ICON_KEYS } from '../../ui/icons'
import { Popover } from '../../ui/Popover'

/**
 * Shared furniture for the Settings detail panels.
 *
 * Settings is config, not flow: no period control, no charts, one subject per
 * screen with a way back. Nine panels share these pieces so they read as one
 * screen visited nine times rather than nine screens.
 */

/**
 * The body of one settings section. The TITLE is not here — the modal renders
 * it, because the section is named in the sidebar too and the two must not be
 * able to disagree.
 */
export function Panel({
  description,
  children,
}: {
  description?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-5">
      {description && <p className="text-sm text-stone-500">{description}</p>}
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
  const [draft, setDraft] = useState(paraToInput(para))
  return (
    <div className="flex items-center gap-2">
      <input
        {...rest}
        inputMode="decimal"
        value={draft}
        onChange={(e) => {
          const clean = sanitizeMoneyInput(e.target.value)
          setDraft(clean)
          onChange(inputToPara(clean))
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
      className={`min-h-11 sm:min-h-9 rounded-full bg-brand px-4 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-40 ${rest.className ?? ''}`}
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
      className={`min-h-11 sm:min-h-9 rounded-full border border-stone-200 px-3 text-sm text-stone-600 hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-40 ${rest.className ?? ''}`}
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
        className={`min-h-11 sm:min-h-9 rounded-full px-3 text-sm text-stone-500 hover:bg-stone-50 hover:text-debt focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${className}`}
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
        className="min-h-11 sm:min-h-9 rounded-full bg-debt px-3 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-40"
      >
        {confirmLabel}
      </button>
      <button
        onClick={() => setArmed(false)}
        className="min-h-11 sm:min-h-9 px-2 text-sm text-stone-500 hover:text-stone-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        Cancel
      </button>
    </span>
  )
}


/**
 * Identity colours for categories and funds — one readable step of each hue,
 * balanced so no swatch shouts louder than its neighbours. Deliberately NOT the
 * composition or status tokens: those carry meaning a user-chosen colour must
 * not borrow.
 */
export const COLORS = [
  '#E11D48', '#F43F5E', '#EC4899', '#D946EF', // rose → fuchsia
  '#A855F7', '#8B5CF6', '#6366F1', '#3B82F6', // purple → blue
  '#0EA5E9', '#06B6D4', '#14B8A6', '#10B981', // sky → emerald
  '#22C55E', '#84CC16', '#EAB308', '#F59E0B', // green → amber
  '#F97316', '#EA580C', '#B45309', '#78716C', // orange → stone
]

export function IconPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (icon: string) => void
}) {
  return (
    <Popover
      label="Choose an icon"
      trigger={
        <>
          <CategoryIcon icon={value} />
          <CaretRightIcon size={12} className="rotate-90 text-stone-400" />
        </>
      }
    >
      {(close) => (
        <div className="grid max-h-64 w-64 grid-cols-6 gap-1 overflow-y-auto">
          {ICON_KEYS.map((i) => (
            <button
              key={i}
              type="button"
              aria-label={i}
              aria-pressed={value === i}
              onClick={() => {
                onChange(i)
                close()
              }}
              className={`grid size-9 place-items-center rounded-lg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand ${
                value === i ? 'bg-violet-100' : 'hover:bg-stone-100'
              }`}
            >
              <CategoryIcon icon={i} />
            </button>
          ))}
        </div>
      )}
    </Popover>
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
    <Popover
      label="Choose a colour"
      trigger={
        <>
          <span
            aria-hidden
            className="size-5 rounded-md"
            style={{ backgroundColor: value }}
          />
          <CaretRightIcon size={12} className="rotate-90 text-stone-400" />
        </>
      }
    >
      {(close) => (
        <div className="grid w-56 grid-cols-5 gap-1.5">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              aria-pressed={value === c}
              onClick={() => {
                onChange(c)
                close()
              }}
              className={`grid size-9 place-items-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                value === c ? 'ring-2 ring-stone-900' : ''
              }`}
            >
              <span
                aria-hidden
                className="size-6 rounded-md"
                style={{ backgroundColor: c }}
              />
            </button>
          ))}
        </div>
      )}
    </Popover>
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

/**
 * The archived tail of a list: restore, or delete for good.
 *
 * Deletion is refused by the server while anything still references the thing,
 * so the error is shown here rather than pre-emptively hiding the button —
 * "why can't I delete this?" deserves an answer, not a missing control.
 */
export function ArchivedList({
  items,
  onRestore,
  onDelete,
}: {
  items: { id: string; name: string }[]
  onRestore: (id: string) => Promise<unknown>
  onDelete: (id: string) => Promise<unknown>
}) {
  const [error, setError] = useState<string | null>(null)
  if (items.length === 0) return null

  return (
    <Card>
      <div className="border-b border-stone-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-stone-500">Archived</h2>
        <p className="text-xs text-stone-400">
          Kept so past months still add up. Anything nothing points at any more
          can be deleted for good.
        </p>
        {error && <p className="mt-1 text-xs text-debt">{error}</p>}
      </div>
      <ul>
        {items.map((it) => (
          <li
            key={it.id}
            className="flex items-center gap-2 border-b border-stone-100 p-4 last:border-b-0"
          >
            <span className="min-w-0 flex-1 truncate text-sm text-stone-500">
              {it.name}
            </span>
            <GhostButton
              onClick={async () => {
                setError(null)
                await onRestore(it.id)
              }}
            >
              Restore
            </GhostButton>
            <ConfirmButton
              label="Delete"
              confirmLabel="Delete for good"
              onConfirm={async () => {
                setError(null)
                try {
                  await onDelete(it.id)
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Could not delete')
                }
              }}
            />
          </li>
        ))}
      </ul>
    </Card>
  )
}
