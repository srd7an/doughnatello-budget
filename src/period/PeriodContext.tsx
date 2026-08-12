import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from 'react'
import { useLocation, useSearchParams, type Location } from 'react-router-dom'
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

/**
 * A destination that keeps the period AND the page you are looking at.
 *
 * The overlays — add, a transaction, settings — are routes, so the back button
 * closes them and a link to one can be shared. But a route has to render
 * something, and every one of them was mapped to Overview. Opening a
 * transaction from a fund's page therefore replaced that page with the month
 * behind the modal, and closing it left you somewhere you had not gone.
 *
 * The remedy is React Router's own: remember which location was underneath and
 * match the page routes against THAT, while the overlay keeps reading the real
 * URL. Everything that opens an overlay goes through here so there is one place
 * that has to remember to do it.
 *
 * `background` is deliberately not carried forward when one overlay opens
 * another — settings moving between its own panels replaces rather than pushes,
 * and stacking backgrounds would make closing return you to a page you were
 * never on.
 */
export function useOverlay() {
  const location = useLocation()
  const state = location.state as { background?: Location } | null
  const background = state?.background ?? location
  /** `extra` ADDS to the carried query string rather than replacing it, for the
   *  overlay that takes an argument — `/add?copy=<id>` — so it does not drop
   *  the period it is also carrying. */
  return (pathname: string, extra?: Record<string, string>) => {
    const params = new URLSearchParams(location.search)
    for (const [k, v] of Object.entries(extra ?? {})) params.set(k, v)
    return {
      to: { pathname, search: params.toString() },
      options: { state: { background } },
    }
  }
}

/** The page the overlays are drawn over. The real location when there is none,
 *  which is what a cold load on an overlay URL looks like. */
export function useBackgroundLocation(): Location {
  const location = useLocation()
  const state = location.state as { background?: Location } | null
  return state?.background ?? location
}

/**
 * The address bar, for the few things that must read it rather than the page.
 *
 * Inside `<Routes location={background}>` every router hook answers about the
 * BACKGROUND. That is the whole point of passing a location and it is right for
 * the pages — but the overlays are drawn by the layout, which is INSIDE that
 * subtree, and they are the one thing that has to know the real URL. They took
 * the background's word for it, and so not one of them could open: Add, a
 * transaction, Settings, all of them.
 *
 * Provided from above the scoped Routes, where the router still answers about
 * the address bar. It throws rather than falling back to `useLocation` when the
 * provider is missing, because that silent fallback IS the bug.
 */
const RealLocation = createContext<Location | null>(null)

export function RealLocationProvider({ children }: { children: ReactNode }) {
  const location = useLocation()
  return <RealLocation.Provider value={location}>{children}</RealLocation.Provider>
}

export function useRealLocation(): Location {
  const ctx = useContext(RealLocation)
  if (!ctx) throw new Error('useRealLocation needs RealLocationProvider')
  return ctx
}
