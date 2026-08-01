import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { PlusIcon } from '../ui/icons'
import { useHousehold } from '../household/HouseholdContext'
import { AvatarMenu } from './AvatarMenu'
import { PeriodControl } from './PeriodControl'
import { AddTransactionModal } from './AddTransactionModal'

/**
 * The shell has no tab nav — the period control (in the header) is the whole
 * navigation. Settings lives in the avatar menu; Add transaction is a modal
 * reachable from the header (and a FAB on mobile).
 */
export function AppShell() {
  const [addOpen, setAddOpen] = useState(false)
  const { household } = useHousehold()
  const sync = useMutation(api.recurring.sync)

  // Materialise anything that came due since the last visit, so the Due block is
  // right on first paint instead of waiting for the nightly cron. Idempotent, so
  // racing the cron is harmless; failures are silent because a missed sync is
  // caught by the next open or by the cron.
  useEffect(() => {
    void sync({ householdId: household._id }).catch(() => {})
  }, [sync, household._id])

  return (
    <div className="min-h-svh bg-stone-50 text-stone-900">
      <header className="sticky top-0 z-30 bg-stone-50/90 px-4 pt-3 pb-2 backdrop-blur">
        <div className="mx-auto max-w-5xl">
          {/* Row 1: brand + account */}
          <div className="flex items-center justify-between">
            <BrandMark />
            <AvatarMenu />
          </div>

          {/* Row 2: period control (the nav) + add */}
          <div className="mt-2 flex items-center justify-between gap-2">
            <PeriodControl />
            <button
              onClick={() => setAddOpen(true)}
              className="hidden items-center gap-1.5 rounded-full bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:flex"
            >
              Add transaction
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-28 pt-4 sm:pb-12">
        <Outlet />
      </main>

      {/* Mobile: Add FAB for thumb reach */}
      <button
        onClick={() => setAddOpen(true)}
        aria-label="Add transaction"
        className="fixed bottom-6 right-4 z-30 grid size-14 place-items-center rounded-full bg-brand text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:hidden"
      >
        <PlusIcon className="size-6" />
      </button>

      <AddTransactionModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  )
}

/** Placeholder brand mark — a purple pill. Real logo comes from Figma. */
function BrandMark() {
  return (
    <div
      aria-label="doughnatello"
      className="h-6 w-11 rounded-full border-[3px] border-brand"
    />
  )
}
