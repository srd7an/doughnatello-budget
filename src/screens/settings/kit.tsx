import { useState, type ReactNode } from 'react'
import {
  formatMoney,
  inputToPara,
  paraToInput,
  sanitizeMoneyInput,
} from '../../lib/format'
import { Button } from '../../ui/Button'
import { CaretRightIcon, CategoryIcon, ICON_KEYS } from '../../ui/icons'
import { Popover } from '../../ui/Popover'
import { SearchField, useSearch } from '../../ui/SearchField'

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

/**
 * A list of things, in the row language the rest of the app speaks.
 *
 * The month's transactions, the category list and the pickers all draw a row
 * the same way: a dashed rule underneath, and on hover the rule is replaced by
 * a filled shape with an 8px radius — the corner arrives WITH the fill, because
 * a row that is only a line has nothing to round. Settings used to draw
 * something else entirely: solid dividers inside a bordered card, and two
 * buttons parked under every single row.
 *
 * The buttons are gone. The ROW is the button, exactly as a transaction row is,
 * and what you could do to the thing lives inside the editor it opens. A panel
 * of twenty-five categories was fifty buttons at rest; now it is twenty-five
 * rows, and the one you want is the one you press.
 */
export function Rows({ children }: { children: ReactNode }) {
  return <ul>{children}</ul>
}

const ROW =
  'flex min-h-11 w-full items-center gap-2 border-b border-dashed border-stone-300 px-3 py-1.5 text-left sm:min-h-9'

const ROW_PRESSABLE =
  'hover:rounded-lg hover:border-transparent hover:bg-stone-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand'

export function ItemRow({
  icon,
  color,
  /** Anything that is not a category icon — a member's initials, say. */
  leading,
  name,
  /** Small stone pills after the name — "Paused", "Automatic". */
  tags,
  /** The quiet second line: a cadence, a target, what it is funded from. */
  meta,
  /** The figure on the right. Always mono, because every figure in this app is. */
  figure,
  figureClass = '',
  /** Faded, for archived things that are shown but no longer in play. */
  muted,
  onClick,
  /** For rows that are not editable and carry their own controls instead. */
  trailing,
}: {
  icon?: string
  color?: string
  leading?: ReactNode
  name: string
  tags?: ReactNode
  meta?: ReactNode
  figure?: string
  figureClass?: string
  muted?: boolean
  onClick?: () => void
  trailing?: ReactNode
}) {
  const body = (
    <>
      {leading}
      {leading === undefined && icon !== undefined && (
        <span className={muted ? 'opacity-50' : undefined}>
          <CategoryIcon icon={icon} color={color} className="shrink-0" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span
            className={`truncate text-sm font-medium ${
              muted ? 'text-stone-500' : 'text-stone-800'
            }`}
          >
            {name}
          </span>
          {tags}
        </span>
        {meta && <span className="block truncate text-xs text-stone-400">{meta}</span>}
      </span>
      {figure && (
        <span data-money className={`shrink-0 text-sm ${figureClass}`}>
          {figure}
        </span>
      )}
    </>
  )

  return (
    <li>
      {onClick ? (
        <button type="button" onClick={onClick} className={`${ROW} ${ROW_PRESSABLE}`}>
          {body}
        </button>
      ) : (
        <div className={ROW}>
          {body}
          {trailing}
        </div>
      )}
    </li>
  )
}

/** A row that is one open editor. It keeps the rule so the list still reads as
 *  a list while you are part-way through changing one of its rows. Padding is
 *  the form's own, so the two do not stack up into a gap. */
export function EditRow({ children }: { children: ReactNode }) {
  return <li className="border-b border-dashed border-stone-300">{children}</li>
}

/** The heading over a list, with what it totals on the right. */
export function ListHeader({
  label,
  figure,
  figureClass = 'text-stone-800',
}: {
  label: string
  figure?: string
  figureClass?: string
}) {
  return (
    <div className="flex items-baseline justify-between px-3 pb-1">
      <span className="text-xs font-medium tracking-wide text-stone-400 uppercase">
        {label}
      </span>
      {figure && (
        <span data-money className={`text-sm ${figureClass}`}>
          {figure}
        </span>
      )}
    </div>
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

export function Note({
  children,
  tone = 'quiet',
}: {
  children: ReactNode
  /** `warn` for something that will go wrong if you carry on. */
  tone?: 'quiet' | 'warn'
}) {
  return (
    <p
      className={
        tone === 'warn'
          ? 'rounded-lg bg-orange-50 px-3 py-2 text-xs text-status-near'
          : 'px-1 text-xs text-stone-400'
      }
    >
      {children}
    </p>
  )
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

export function PrimaryButton(
  props: React.ButtonHTMLAttributes<HTMLButtonElement>,
) {
  return <Button variant="primary" {...props} />
}

export function GhostButton(
  props: React.ButtonHTMLAttributes<HTMLButtonElement>,
) {
  return <Button variant="secondary" {...props} />
}

/**
 * The bottom of an editor: what you came to do on the left, what you might do
 * to the thing itself pushed to the far right.
 *
 * Archiving and deleting live HERE now rather than beside every row in the
 * list. You cannot archive something without first choosing it, which is the
 * same order of operations you already follow in your head, and it costs the
 * resting list two controls per row it never needed.
 */
export function FormActions({
  onSave,
  onCancel,
  busy,
  disabled,
  destructive,
}: {
  onSave: () => void
  onCancel: () => void
  busy?: boolean
  disabled?: boolean
  destructive?: ReactNode
}) {
  return (
    <div className="flex items-center gap-2">
      <PrimaryButton onClick={onSave} disabled={disabled || busy}>
        {busy ? 'Saving…' : 'Save'}
      </PrimaryButton>
      <GhostButton onClick={onCancel}>Cancel</GhostButton>
      {destructive && <span className="ml-auto">{destructive}</span>}
    </div>
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
      <Button
        variant="ghost"
        onClick={() => setArmed(true)}
        className={`hover:text-debt ${className}`}
      >
        {label}
      </Button>
    )
  }
  return (
    <span className="flex items-center gap-1">
      <Button
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
        className="border-transparent bg-debt text-white hover:opacity-90"
      >
        {confirmLabel}
      </Button>
      <Button variant="ghost" onClick={() => setArmed(false)}>
        Cancel
      </Button>
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
      {(close) => <IconGrid value={value} onChange={onChange} close={close} />}
    </Popover>
  )
}

/** Seventy glyphs is not a grid you scan, it is a grid you give up on — so the
 *  name each one is filed under is searchable. Split out for the state. */
function IconGrid({
  value,
  onChange,
  close,
}: {
  value: string
  onChange: (icon: string) => void
  close: () => void
}) {
  const { query, setQuery, show, results } = useSearch(ICON_KEYS, (i) => i)

  return (
    <div className="w-64">
      {show && (
        <SearchField
          value={query}
          onChange={setQuery}
          label="Search icons"
          empty={results.length === 0}
        />
      )}
      <div className="grid max-h-64 grid-cols-6 gap-1 overflow-y-auto">
        {results.map((i) => (
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
    <section>
      <div className="px-3 pb-1">
        <h2 className="text-xs font-medium tracking-wide text-stone-400 uppercase">
          Archived
        </h2>
        <p className="text-xs text-stone-400">
          Kept so past months still add up. Anything nothing points at any more
          can be deleted for good.
        </p>
        {error && <p className="mt-1 text-xs text-debt">{error}</p>}
      </div>
      <Rows>
        {items.map((it) => (
          <ItemRow
            key={it.id}
            name={it.name}
            muted
            trailing={
              <span className="flex shrink-0 items-center gap-1">
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
                  confirmLabel="Yes, delete for good"
                  onConfirm={async () => {
                    setError(null)
                    try {
                      await onDelete(it.id)
                    } catch (e) {
                      setError(e instanceof Error ? e.message : 'Could not delete')
                    }
                  }}
                />
              </span>
            }
          />
        ))}
      </Rows>
    </section>
  )
}
