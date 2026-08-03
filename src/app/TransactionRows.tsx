import type { ReactNode } from 'react'
import { Popover } from '../ui/Popover'
import { CategoryIcon } from '../ui/icons'

/**
 * The pieces the transaction form is made of.
 *
 * Every field is one row: what it is on the left, what it says on the right,
 * a dashed rule between. The right side is one of two things, and the
 * difference carries meaning —
 *
 *   a PILL, bordered and white, for anything you pick from a list. It looks
 *   pressable because it is.
 *   plain TEXT for anything you type. Filled reads as stone-800, empty as
 *   stone-500. No border, because there is nothing to open.
 *
 * That is why an unset "Paying off" is a violet "+ Loan" rather than an empty
 * pill: nothing is chosen, so there is nothing to show — only something to do.
 */

/**
 * Every control on the right of a row is the SAME BOX — same height, same
 * padding, same border width. A transparent border on the ones that do not
 * show one is not a trick, it is the point: without it the row is 2px shorter
 * when nothing is chosen, and the whole form jumps a line every time you pick
 * something.
 */
const CONTROL =
  'flex h-11 items-center gap-1.5 rounded-full border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:h-8'

const PILL = `${CONTROL} border-stone-300 bg-white text-stone-800 shadow-[0px_1px_1px_rgba(0,0,0,0.05)] hover:bg-stone-50`

const ACTION = `${CONTROL} border-transparent text-brand hover:bg-violet-50`

/** One field. `first` drops the rule, because a rule above the first row is a
 *  line under the amount, which is not what it means. */
export function Row({
  label,
  first,
  children,
}: {
  label: string
  first?: boolean
  children: ReactNode
}) {
  return (
    <div
      className={`flex items-center gap-1.5 py-2 ${
        first ? '' : 'border-t border-dashed border-stone-300'
      }`}
    >
      <span className="min-w-0 flex-1 text-sm font-medium text-stone-800">
        {label}
      </span>
      {children}
    </div>
  )
}

/** A row whose value you pick from a list. */
export function PickerRow<T>({
  label,
  first,
  value,
  options,
  onPick,
  /** Shown instead of a pill when nothing is chosen — "+ Loan". */
  emptyAction,
}: {
  label: string
  first?: boolean
  value: { icon?: string; color?: string; text: string } | null
  options: {
    key: string
    icon?: string
    color?: string
    text: string
    hint?: string
    value: T
  }[]
  onPick: (value: T) => void
  emptyAction?: string
}) {
  return (
    <Row label={label} first={first}>
      <Popover
        label={label}
        align="right"
        triggerClassName={value || !emptyAction ? PILL : ACTION}
        trigger={
          value ? (
            <>
              {value.icon && (
                <CategoryIcon icon={value.icon} color={value.color} size={16} />
              )}
              {value.text}
            </>
          ) : (
            <>
              <span aria-hidden className="text-base leading-none">
                +
              </span>
              {emptyAction}
            </>
          )
        }
      >
        {(close) => (
          <ul className="max-h-64 w-56 overflow-y-auto">
            {options.map((o) => (
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
        )}
      </Popover>
    </Row>
  )
}

/** A row you type into. No pill: there is nothing to open. */
export function TextRow({
  label,
  first,
  value,
  onChange,
  placeholder,
}: {
  label: string
  first?: boolean
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  return (
    <Row label={label} first={first}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className={`${CONTROL} w-[55%] justify-end border-transparent text-right text-stone-800 outline-none placeholder:text-stone-500`}
      />
    </Row>
  )
}

export { PILL }
