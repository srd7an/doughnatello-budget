import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
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
 *
 * Settings is the exception: it is CONFIG, not flow. A period means nothing
 * there (a category has no July), and logging a transaction is not what you came
 * to do, so both controls are hidden and the header collapses to brand + avatar.
 * The brand mark is the way home from anywhere.
 */
export function AppShell() {
  const [addOpen, setAddOpen] = useState(false)
  const { household } = useHousehold()
  const sync = useMutation(api.recurring.sync)
  const inSettings = useLocation().pathname.startsWith('/settings')

  // Materialise anything that came due since the last visit, so the Due block is
  // right on first paint instead of waiting for the nightly cron. Idempotent, so
  // racing the cron is harmless; failures are silent because a missed sync is
  // caught by the next open or by the cron.
  useEffect(() => {
    void sync({ householdId: household._id }).catch(() => {})
  }, [sync, household._id])

  return (
    <div className="min-h-svh bg-white text-stone-800">
      <header className="sticky top-0 z-30 bg-white/90 px-4 pt-3 pb-2 backdrop-blur">
        <div className="mx-auto max-w-[800px]">
          {/* Row 1: brand + account */}
          <div className="flex items-center justify-between">
            <BrandMark />
            <AvatarMenu />
          </div>

          {/* Row 2: period control (the nav) + add. Neither applies to config. */}
          {!inSettings && (
            <div className="mt-2 flex items-center justify-between gap-2">
              <PeriodControl />
              <button
                onClick={() => setAddOpen(true)}
                className="hidden items-center gap-1.5 rounded-full border border-violet-800 bg-brand px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:flex"
              >
                Add transaction
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-[800px] px-4 pb-28 pt-4 sm:pb-12">
        <Outlet />
      </main>

      {/* Mobile: Add FAB for thumb reach */}
      {!inSettings && (
        <button
          onClick={() => setAddOpen(true)}
          aria-label="Add transaction"
          className="fixed bottom-6 right-4 z-30 grid size-14 place-items-center rounded-full bg-brand text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:hidden"
        >
          <PlusIcon className="size-6" />
        </button>
      )}

      <AddTransactionModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  )
}

/**
 * Placeholder brand mark — a purple pill. Real logo comes from Figma.
 *
 * It links home, the convention every site shares. That alone is too quiet to
 * be the ONLY way back, which is why Settings also carries an explicit link.
 */
function BrandMark() {
  return (
    <Link
      to="/"
      aria-label="doughnatello — home"
      className="block h-6 w-8 rounded-full border-[6px] border-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    />
  )
}
