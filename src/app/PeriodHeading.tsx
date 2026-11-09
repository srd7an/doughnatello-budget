import { usePeriod } from '../period/PeriodContext'

/**
 * What you are looking at, and the other way of looking at it.
 *
 * The name of the period was written in one place: the control at the foot of
 * the screen. The top of the page — where a page says what it is — held a logo
 * and two buttons, and under them a figure that did not say which month it was
 * a figure for. Three months back, "Left from income 19.909" is a number
 * without a subject.
 *
 * The zoom sits beside it because that is the question it answers: this month,
 * or the year it is in. It was two rows in a menu behind the date, which made
 * the app's one piece of navigation the thing a new person finds last.
 */
export function PeriodHeading() {
  const { label, granularity, setGranularity } = usePeriod()
  return (
    <div className="mb-6 flex items-center justify-between gap-3">
      <h1 className="min-w-0 truncate text-xl font-medium tracking-[-0.2px] text-stone-800">
        {label}
      </h1>
      <div
        role="group"
        aria-label="Zoom"
        className="flex h-11 shrink-0 items-stretch rounded-full border border-stone-200 bg-white p-0.5 sm:h-8"
      >
        {(['month', 'year'] as const).map((g) => (
          <button
            key={g}
            onClick={() => setGranularity(g)}
            aria-pressed={granularity === g}
            className={`rounded-full px-3.5 text-sm font-medium capitalize focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:px-3 ${
              granularity === g
                ? 'bg-stone-800 text-white'
                : 'text-stone-500 hover:text-stone-800'
            }`}
          >
            {g}
          </button>
        ))}
      </div>
    </div>
  )
}
