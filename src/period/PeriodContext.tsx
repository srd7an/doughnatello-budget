import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { formatMonth } from '../lib/format'

/**
 * The period control IS the navigation (2026-07-25 IA revision). There are no
 * Home/Spending/Plan tabs. Instead one overview shows at two granularities:
 *  - "year"  → the net-worth / 12-month view
 *  - "month" → the income / spending view
 * Switching granularity is how you move between them; stepping moves within.
 *
 * It lives in the URL, as `?p=2026-01` or `?p=2026`, for the reason every other
 * screen does: a reload used to drop you back on today, which after twenty
 * minutes of working through January is not where you were. It also makes a
 * month a thing you can link to.
 *
 * Stepping REPLACES the entry rather than pushing one. Twelve months of
 * browsing would otherwise be twelve presses of Back before the app would let
 * you leave, and the button most people reach for after stepping is not "the
 * month I was on before this one".
 */
type Granularity = 'year' | 'month'

type Period = {
  granularity: Granularity
  year: number
  month: number // 1-12
  label: string // "2026" or "July 2026", matching the current granularity
  /** Whether this is the period today falls in — the one you return to. */
  isCurrent: boolean
  setGranularity: (g: Granularity) => void
  step: (delta: number) => void // steps year or month depending on granularity
  /** Jump straight to a month and zoom in — what clicking a column does. */
  openMonth: (year: number, month: number) => void
  /** Back to the period today is in, at whatever granularity is showing. */
  goToToday: () => void
}

const PeriodContext = createContext<Period | null>(null)

/** `2026-07` → July 2026 · `2026` → the year · anything else → today. */
function parse(param: string | null): {
  granularity: Granularity
  year: number
  month: number
} {
  const now = new Date()
  const fallback = {
    granularity: 'month' as const,
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  }
  if (!param) return fallback

  const monthly = param.match(/^(\d{4})-(\d{2})$/)
  if (monthly) {
    const month = Number(monthly[2])
    if (month < 1 || month > 12) return fallback
    return { granularity: 'month', year: Number(monthly[1]), month }
  }
  const yearly = param.match(/^(\d{4})$/)
  if (yearly) {
    return { granularity: 'year', year: Number(yearly[1]), month: fallback.month }
  }
  return fallback
}

const write = (g: Granularity, y: number, m: number) =>
  g === 'year' ? String(y) : `${y}-${String(m).padStart(2, '0')}`

export function PeriodProvider({ children }: { children: ReactNode }) {
  const [params, setParams] = useSearchParams()
  const { granularity, year, month } = parse(params.get('p'))

  const set = useCallback(
    (g: Granularity, y: number, m: number) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('p', write(g, y, m))
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )

  const step = useCallback(
    (delta: number) => {
      if (granularity === 'year') {
        set('year', year + delta, month)
        return
      }
      // Month index arithmetic, so December + 1 rolls the year.
      const idx = year * 12 + (month - 1) + delta
      set('month', Math.floor(idx / 12), (((idx % 12) + 12) % 12) + 1)
    },
    [granularity, year, month, set],
  )

  const now = new Date()
  const isCurrent =
    granularity === 'year'
      ? year === now.getFullYear()
      : year === now.getFullYear() && month === now.getMonth() + 1

  const value = useMemo<Period>(
    () => ({
      granularity,
      year,
      month,
      label: granularity === 'year' ? String(year) : formatMonth(year, month),
      isCurrent,
      setGranularity: (g) => set(g, year, month),
      step,
      openMonth: (y, m) => set('month', y, m),
      goToToday: () => {
        const today = new Date()
        set(granularity, today.getFullYear(), today.getMonth() + 1)
      },
    }),
    [granularity, year, month, isCurrent, step, set],
  )

  return (
    <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>
  )
}

export function usePeriod(): Period {
  const ctx = useContext(PeriodContext)
  if (!ctx) throw new Error('usePeriod must be used within a PeriodProvider')
  return ctx
}

/**
 * A destination that keeps the period you are looking at.
 *
 * The period lives in the query string, and `navigate('/somewhere')` throws a
 * query string away — so every jump that leaves the overview showing has to
 * carry it, or the page behind an overlay silently snaps back to today. That
 * happened twice: once opening the add form, and again moving between panels
 * inside Settings. It is a hook rather than a rule to remember.
 */
export function useKeepPeriod() {
  const location = useLocation()
  return (pathname: string) => ({ pathname, search: location.search })
}
