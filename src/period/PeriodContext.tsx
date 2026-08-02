import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { formatMonth } from '../lib/format'

/**
 * The period control IS the navigation (2026-07-25 IA revision). There are no
 * Home/Spending/Plan tabs. Instead one overview shows at two granularities:
 *  - "year"  → the net-worth / 12-month view
 *  - "month" → the income / spending view
 * Switching granularity is how you move between them; stepping moves within.
 */
type Granularity = 'year' | 'month'

type Period = {
  granularity: Granularity
  year: number
  month: number // 1-12
  label: string // "2026" or "July 2026", matching the current granularity
  setGranularity: (g: Granularity) => void
  step: (delta: number) => void // steps year or month depending on granularity
  /** Jump straight to a month and zoom in — what clicking a column does. */
  openMonth: (year: number, month: number) => void
}

const PeriodContext = createContext<Period | null>(null)

export function PeriodProvider({ children }: { children: ReactNode }) {
  const now = new Date()
  const [granularity, setGranularity] = useState<Granularity>('month')
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)

  const stepMonth = useCallback((delta: number) => {
    setMonth((m) => {
      const zero = m - 1 + delta
      const rolledYears = Math.floor(zero / 12)
      if (rolledYears !== 0) setYear((y) => y + rolledYears)
      return (((zero % 12) + 12) % 12) + 1
    })
  }, [])

  const step = useCallback(
    (delta: number) => {
      if (granularity === 'year') setYear((y) => y + delta)
      else stepMonth(delta)
    },
    [granularity, stepMonth],
  )

  // Stepping moves within a granularity; this is the other move — picking a
  // month out of the year you are looking at, which is what makes the twelve
  // columns navigation rather than decoration.
  const openMonth = useCallback((y: number, m: number) => {
    setYear(y)
    setMonth(m)
    setGranularity('month')
  }, [])

  const value = useMemo<Period>(
    () => ({
      granularity,
      year,
      month,
      label: granularity === 'year' ? String(year) : formatMonth(year, month),
      setGranularity,
      step,
      openMonth,
    }),
    [granularity, year, month, step, openMonth],
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
