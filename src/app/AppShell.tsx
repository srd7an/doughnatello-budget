import { useEffect } from 'react'
import {
  Link,
  Outlet,
  useLocation,
  useMatch,
  useNavigate,
} from 'react-router-dom'
import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { Button } from '../ui/Button'
import { SM, useMediaQuery } from '../lib/useMediaQuery'
import { useKeepPeriod } from '../period/PeriodContext'
import { PlusIcon } from '../ui/icons'
import { Logo } from '../ui/Logo'
import { useHousehold } from '../household/HouseholdContext'
import { AvatarMenu } from './AvatarMenu'
import { PeriodControl } from './PeriodControl'
import {
  AddTransactionPopover,
  AddTransactionSheet,
} from './AddTransactionModal'
import { TransactionDetail } from '../screens/TransactionDetail'
import { SettingsModal } from '../screens/settings/SettingsModal'
import { CaretLeftIcon } from '../ui/icons'
import type { Id } from '../../convex/_generated/dataModel'

/**
 * The shell has no tab nav — the period control (in the header) is the whole
 * navigation. Settings lives in the avatar menu; Add transaction is a modal
 * reachable from the header (and a FAB on mobile).
 *
 * Settings is the exception: it is CONFIG, not flow. A period means nothing
 * there (a category has no July), and logging a transaction is not what you came
 * to do, so both controls are hidden and the header collapses to brand + avatar.
 * The brand mark is the way home from anywhere.
 *
 * Every overlay is a route rather than a piece of state: the back button closes
 * it, a link to one can be shared, and a reload keeps you where you were.
 * Closing means going BACK when there is somewhere to go back to, so the entry
 * that opened the overlay leaves the history with it; a cold load lands home.
 *
 * The period control is the navigation on the overview, and it scopes nothing
 * on a fund's page — a fund's balance is all of time, not August. So that page
 * takes the slot for its own way back, and the header stays honest.
 */
export function AppShell() {
  const { household } = useHousehold()
  const sync = useMutation(api.recurring.sync)
  const navigate = useNavigate()
  const location = useLocation()

  // EVERY useMatch is called on every render, unconditionally. Combining them
  // with ?? or || short-circuits the calls, React sees a different number of
  // hooks between two routes, and the app goes white on the way from one to
  // the other. Match first, decide after.
  const addMatch = useMatch('/add')
  const txMatch = useMatch('/transactions/:transactionId')
  const settingsItem = useMatch('/settings/:section/:itemId')
  const settingsSection = useMatch('/settings/:section')
  const settingsRoot = useMatch('/settings')
  const potMatch = useMatch('/funds/:potId')
  const assetMatch = useMatch('/assets/:assetId')

  const addOpen = !!addMatch
  const settingsMatch = settingsItem ?? settingsSection ?? settingsRoot
  const onPage = !!potMatch || !!assetMatch

  const isDesktop = useMediaQuery(SM)

  /** Opening an overlay keeps the period in the URL, or the page behind it
   *  would jump to today the moment you pressed Add. */
  const keepPeriod = useKeepPeriod()
  const open = (pathname: string) => navigate(keepPeriod(pathname))

  const close = () => {
    if (location.key === 'default') navigate('/', { replace: true })
    else navigate(-1)
  }

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
            <AvatarMenu onOpenSettings={() => open('/settings')} />
          </div>

          {/* Row 2: period control (the nav) + add */}
          <div className="relative mt-2 flex items-center justify-between gap-2">
            {onPage ? <BackLink /> : <PeriodControl />}
            {/* One Add per screen, and it is a different one on each: the
                labelled button up here where there is room for words, the FAB
                down there where a thumb is. Rendered, not hidden — two of them
                existing and one being display:none is how they both showed up
                on a phone. */}
            {isDesktop && (
              <Button variant="primary" onClick={() => open('/add')}>
                Add transaction
              </Button>
            )}
            {addOpen && isDesktop && <AddTransactionPopover onClose={close} />}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[800px] px-4 pb-28 pt-4 sm:pb-12">
        <Outlet />
      </main>

      {!isDesktop && (
        <button
          onClick={() => open('/add')}
          aria-label="Add transaction"
          className="fixed right-4 bottom-6 z-30 grid size-14 place-items-center rounded-full bg-brand text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <PlusIcon className="size-6" />
        </button>
      )}

      {addOpen && !isDesktop && <AddTransactionSheet onClose={close} />}

      <TransactionDetail
        transactionId={
          (txMatch?.params.transactionId as Id<'transactions'>) ?? null
        }
        onClose={close}
      />
      <SettingsModal
        open={!!settingsMatch}
        section={settingsMatch?.params.section}
        itemId={settingsItem?.params.itemId}
        onClose={close}
      />
    </div>
  )
}

/** The way back off a page, in the slot the period control usually holds. */
function BackLink() {
  const navigate = useNavigate()
  const location = useLocation()
  return (
    <button
      onClick={() =>
        location.key === 'default' ? navigate('/') : navigate(-1)
      }
      className="flex h-11 items-center gap-1.5 rounded-full border border-stone-200 bg-white pr-4 pl-2.5 text-sm font-medium text-stone-700 hover:bg-stone-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand sm:h-8"
    >
      <CaretLeftIcon size={16} aria-hidden />
      Back
    </button>
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
      className="grid size-11 shrink-0 place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:size-8"
    >
      <Logo size={28} />
    </Link>
  )
}
