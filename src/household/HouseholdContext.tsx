import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Id } from '../../convex/_generated/dataModel'

export type Household = {
  _id: Id<'households'>
  name: string
  baseCurrency: string
  role: 'admin' | 'member'
  displayName: string
}

type HouseholdContextValue = {
  household: Household
  all: Household[]
  setActive: (id: Id<'households'>) => void
}

const HouseholdContext = createContext<HouseholdContextValue | null>(null)

/**
 * Most households are one or two people and belong to a single household, but a
 * user can be in several. We keep an "active" one; a switcher lives in the
 * avatar menu when there's more than one.
 */
export function HouseholdProvider({
  households,
  children,
}: {
  households: Household[]
  children: ReactNode
}) {
  const [activeId, setActiveId] = useState<Id<'households'>>(households[0]._id)

  const value = useMemo<HouseholdContextValue>(() => {
    const household =
      households.find((h) => h._id === activeId) ?? households[0]
    return { household, all: households, setActive: setActiveId }
  }, [households, activeId])

  return (
    <HouseholdContext.Provider value={value}>
      {children}
    </HouseholdContext.Provider>
  )
}

export function useHousehold(): HouseholdContextValue {
  const ctx = useContext(HouseholdContext)
  if (!ctx)
    throw new Error('useHousehold must be used within a HouseholdProvider')
  return ctx
}
