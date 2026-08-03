import { useEffect, useRef, useState } from 'react'
import { matches, SEARCH_FROM } from '../lib/search'
import { SM, useMediaQuery } from '../lib/useMediaQuery'
import { MagnifyingGlassIcon } from './icons'

/**
 * A search field at the top of a popover, and the filtering behind it.
 *
 * It appears only once a list is long enough to be worth searching (see
 * SEARCH_FROM) — a picker with four funds in it needs a field to type in about
 * as much as a light switch needs a manual.
 *
 * Focus is deliberate rather than automatic on a phone: autofocus raises the
 * keyboard, which on a small screen covers the very list you opened. A pointer
 * has no such cost, so the field takes focus from `sm` up and waits to be
 * tapped below it.
 */
export function useSearch<T>(items: T[], toText: (item: T) => string) {
  const [query, setQuery] = useState('')
  const show = items.length >= SEARCH_FROM
  const results = show && query ? items.filter((i) => matches(toText(i), query)) : items
  return { query, setQuery, show, results }
}

export function SearchField({
  value,
  onChange,
  label,
  /** Rendered when the query matches nothing — the list itself would be blank. */
  empty,
}: {
  value: string
  onChange: (v: string) => void
  label: string
  empty?: boolean
}) {
  const ref = useRef<HTMLInputElement>(null)
  const pointer = useMediaQuery(SM)

  useEffect(() => {
    if (pointer) ref.current?.focus()
  }, [pointer])

  return (
    <>
      <div className="mb-1 flex items-center gap-1.5 rounded-lg bg-stone-100 px-2">
        <MagnifyingGlassIcon size={14} className="shrink-0 text-stone-500" aria-hidden />
        <input
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          // Escape belongs to the popover once the field is empty, so one press
          // clears a search and the next closes the panel.
          onKeyDown={(e) => {
            if (e.key === 'Escape' && value) {
              e.stopPropagation()
              onChange('')
            }
          }}
          type="search"
          placeholder="Search"
          aria-label={label}
          className="h-9 min-w-0 flex-1 bg-transparent text-sm text-stone-800 outline-none placeholder:text-stone-500 [&::-webkit-search-cancel-button]:hidden"
        />
      </div>
      {empty && (
        <p className="px-2 py-3 text-center text-sm text-stone-500">Nothing matches</p>
      )}
    </>
  )
}
