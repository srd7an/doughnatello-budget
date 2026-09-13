import { useState } from 'react'
import { SearchField } from './SearchField'
import { CheckIcon, MinusIcon, PlusCircleIcon } from './icons'
import { fold, matches } from '../lib/search'

export type PickableTag = {
  _id: string
  name: string
  color: string
  count?: number
}

/**
 * The panel behind every tag picker — the one on the transaction form, and the
 * one over a selection of rows.
 *
 * Shared because the two are the same question asked about a different number
 * of transactions, and a picker that could create a tag in one place but not
 * the other is how you end up going to Settings to record that you went to
 * Greece. Typing filters and names at once: a tag is always invented in the
 * middle of entering the thing that needs it.
 *
 * It never closes itself. Tagging is plural by nature — a dinner is Greece 2026
 * AND Anniversary — so shutting after each tick would make the second one cost
 * a second opening.
 */
export function TagOptions<T extends string>({
  tags,
  selected,
  partial = [],
  onToggle,
  onCreate,
}: {
  tags: (PickableTag & { _id: T })[]
  /** On every transaction this applies to. */
  selected: T[]
  /** On some but not all of them — only ever the case over a selection. */
  partial?: T[]
  onToggle: (id: T) => void
  /** Makes a tag with this name and applies it. */
  onCreate: (name: string) => void
}) {
  const [query, setQuery] = useState('')
  const results = query ? tags.filter((t) => matches(t.name, query)) : tags
  const typed = query.trim()
  // Only when it is genuinely new. "Grčka" typed while Grčka exists is someone
  // searching for it, not someone making a second one.
  const canCreate =
    typed.length > 0 && !tags.some((t) => fold(t.name) === fold(typed))

  return (
    <div className="w-64">
      {/* Always shown, unlike the other pickers: this field is how a tag is
          made, so it cannot wait until there are eight of them. */}
      <SearchField
        value={query}
        onChange={setQuery}
        label="Search or name a tag"
        empty={false}
      />
      <ul className="max-h-64 overflow-y-auto">
        {canCreate && (
          <li>
            <button
              type="button"
              onClick={() => {
                onCreate(typed)
                setQuery('')
              }}
              className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-sm text-brand hover:bg-violet-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand sm:min-h-9"
            >
              <PlusCircleIcon size={16} className="shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">Make “{typed}”</span>
            </button>
          </li>
        )}
        {results.map((t) => {
          const on = selected.includes(t._id)
          const some = !on && partial.includes(t._id)
          return (
            <li key={t._id}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onToggle(t._id)}
                className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-sm text-stone-800 hover:bg-stone-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand sm:min-h-9"
              >
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: t.color }}
                />
                <span className="min-w-0 flex-1 truncate">{t.name}</span>
                {t.count !== undefined && !on && !some && (
                  <span data-money className="shrink-0 text-xs text-stone-400">
                    {t.count}
                  </span>
                )}
                {/* A dash, not a tick: over a selection, "some of these" is a
                    third state, and drawing it as unticked would make one tap
                    silently take the tag off the rows that already had it. */}
                {some && (
                  <MinusIcon
                    size={16}
                    className="shrink-0 text-stone-400"
                    aria-hidden
                  />
                )}
                {on && (
                  <CheckIcon
                    size={16}
                    className="shrink-0 text-brand"
                    aria-hidden
                  />
                )}
              </button>
            </li>
          )
        })}
        {results.length === 0 && !canCreate && (
          <li className="px-2 py-3 text-center text-sm text-stone-500">
            No tags yet
          </li>
        )}
      </ul>
    </div>
  )
}
