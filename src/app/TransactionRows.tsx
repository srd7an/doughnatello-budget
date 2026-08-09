import type { ReactNode } from 'react'
import { Popover } from '../ui/Popover'
import { SearchField, useSearch } from '../ui/SearchField'
import { CategoryIcon } from '../ui/icons'

/**
 * The pieces the transaction form is made of.
 *
 * Every field is one row: a glyph, then the value, on a dashed rule. There are
 * NO labels. A label beside a value that already says what it is — a date next
 * to "Date", a shop next to "Payee" — is a word you read once and then read
 * past forever, and eight of them made the card twice as tall as its content.
 * The glyph carries the meaning, and the value carries itself.
 *
 * Three kinds of row, and the difference is what you can do to them:
 *
 *   PICK  — opens a list. The value is always there because something is
 *           always chosen.
 *   TYPE  — an input. Its placeholder is the only prompt it gets, so the
 *           placeholder has to be a prompt and not a label.
 *   ACT   — violet, and not a row at all until you use it. "Pay from a fund"
 *           is nothing on most transactions, and a row that says nothing on
 *           most transactions should not be there on most transactions.
 */

const ROW =
  'flex min-h-11 w-full items-center gap-3 border-b border-dashed border-stone-200 px-1 text-left text-sm sm:min-h-10'

/** The glyph column, so every row's text starts at the same x. */
function Glyph({ children }: { children: ReactNode }) {
  return <span className="grid w-5 shrink-0 place-items-center">{children}</span>
}

/** A row you type into. */
export function TypeRow({
  icon,
  value,
  onChange,
  placeholder,
  label,
  last,
}: {
  icon: ReactNode
  value: string
  onChange: (v: string) => void
  placeholder: string
  /** The accessible name, since nothing on screen carries one. */
  label: string
  last?: boolean
}) {
  return (
    <div className={`${ROW} ${last ? 'border-b-0' : ''}`}>
      <Glyph>{icon}</Glyph>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="min-w-0 flex-1 bg-transparent text-stone-800 outline-none placeholder:text-stone-400"
      />
    </div>
  )
}

/** A row that opens something — a date picker, the repeat panel. */
export function OpenRow({
  icon,
  label,
  children,
  last,
}: {
  icon: ReactNode
  label: string
  /** Receives nothing; the caller wires its own control inside. */
  children: ReactNode
  last?: boolean
}) {
  return (
    <div className={`${ROW} relative ${last ? 'border-b-0' : ''}`}>
      <Glyph>{icon}</Glyph>
      <span className="min-w-0 flex-1">{children}</span>
      <span className="sr-only">{label}</span>
    </div>
  )
}

/** A row whose value you pick from a list. */
export function PickRow<T>({
  icon,
  label,
  value,
  trailing,
  options,
  onPick,
  last,
}: {
  icon?: ReactNode
  label: string
  value: { icon?: string; color?: string; text: string } | null
  /** A badge at the far right — the category's Needs/Wants, say. */
  trailing?: ReactNode
  options: {
    key: string
    icon?: string
    color?: string
    text: string
    hint?: string
    value: T
  }[]
  onPick: (value: T) => void
  last?: boolean
}) {
  return (
    <div className={`${ROW} ${last ? 'border-b-0' : ''} p-0`}>
      <Popover
        label={label}
        align="left"
        triggerClassName={`${ROW} border-b-0 hover:bg-stone-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand`}
        trigger={
          <>
            <Glyph>
              {value?.icon !== undefined ? (
                <CategoryIcon icon={value.icon} color={value.color} size={20} />
              ) : (
                icon
              )}
            </Glyph>
            <span className="min-w-0 flex-1 truncate text-stone-800">
              {value?.text}
            </span>
            {trailing}
          </>
        }
      >
        {(close) => (
          <Options options={options} onPick={onPick} close={close} label={label} />
        )}
      </Popover>
    </div>
  )
}

/**
 * Something you can add, shown as an invitation rather than as an empty field.
 * It becomes an ordinary row the moment it holds a value.
 */
export function ActionRow({
  icon,
  label,
  onClick,
  last,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
  last?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${ROW} ${last ? 'border-b-0' : ''} rounded-lg text-brand hover:bg-violet-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand`}
    >
      <Glyph>{icon}</Glyph>
      <span className="flex-1">{label}</span>
    </button>
  )
}

/**
 * One end of a transfer: a filled block, because on a transfer these two ARE
 * the transaction and everything below them is detail. The word — From, Into —
 * sits at the far right, where the category's Needs/Wants badge sits, and is
 * what tells the two blocks apart at a glance.
 */
export function EndBlock<T>({
  label,
  side,
  value,
  options,
  onPick,
}: {
  label: string
  side: 'From' | 'Into'
  value: { icon?: string; color?: string; text: string }
  options: {
    key: string
    icon?: string
    color?: string
    text: string
    hint?: string
    value: T
  }[]
  onPick: (value: T) => void
}) {
  return (
    <Popover
      label={label}
      align="left"
      triggerClassName="flex min-h-11 w-full items-center gap-3 rounded-xl bg-stone-100 px-3 text-left text-sm hover:bg-stone-200 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
      trigger={
        <>
          <CategoryIcon
            icon={value.icon ?? 'wallet'}
            color={value.color}
            size={20}
            className="shrink-0"
          />
          <span className="min-w-0 flex-1 truncate text-stone-800">{value.text}</span>
          <span className="shrink-0 rounded-md bg-white px-2 py-0.5 text-xs text-stone-600">
            {side}
          </span>
        </>
      }
    >
      {(close) => (
        <Options options={options} onPick={onPick} close={close} label={label} />
      )}
    </Popover>
  )
}

/** The panel behind a picker: a search field once the list is long, and the
 *  matching options under it. Split out because the search needs state, and a
 *  render prop is not a component. */
function Options<T>({
  options,
  onPick,
  close,
  label,
}: {
  options: {
    key: string
    icon?: string
    color?: string
    text: string
    hint?: string
    value: T
  }[]
  onPick: (value: T) => void
  close: () => void
  label: string
}) {
  const { query, setQuery, show, results } = useSearch(options, (o) => o.text)

  return (
    <div className="w-56">
      {show && (
        <SearchField
          value={query}
          onChange={setQuery}
          label={`Search ${label.toLowerCase()}`}
          empty={results.length === 0}
        />
      )}
      <ul className="max-h-64 overflow-y-auto">
        {results.map((o) => (
          <li key={o.key}>
            <button
              type="button"
              onClick={() => {
                onPick(o.value)
                close()
              }}
              className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-sm text-stone-800 hover:bg-stone-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand sm:min-h-9"
            >
              {o.icon !== undefined && (
                <CategoryIcon
                  icon={o.icon}
                  color={o.color}
                  size={16}
                  className="shrink-0"
                />
              )}
              <span className="min-w-0 flex-1 truncate">{o.text}</span>
              {o.hint && (
                <span data-money className="shrink-0 text-xs text-stone-500">
                  {o.hint}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * A row that is not ready yet.
 *
 * It holds the layout still. The form's rows depend on queries — how many there
 * are depends on whether you have funds and loans at all — so rendering against
 * empty data drew a short card that grew a row at a time as the answers
 * arrived. Same box, same height, nothing in it.
 */
export function SkeletonRow({ last }: { last?: boolean }) {
  return (
    <div className={`${ROW} ${last ? 'border-b-0' : ''}`}>
      <Glyph>
        <span aria-hidden className="size-5 rounded bg-stone-100" />
      </Glyph>
      <span aria-hidden className="h-4 w-28 rounded bg-stone-100" />
    </div>
  )
}
