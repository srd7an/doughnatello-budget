import { useEffect } from 'react'
import { Link, Outlet, matchPath, useMatch, useNavigate } from 'react-router-dom'
import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { Button } from '../ui/Button'
import { SM, useMediaQuery } from '../lib/useMediaQuery'
import {
  useKeepPeriod,
  useOverlay,
  useRealLocation,
} from '../period/PeriodContext'
import { Logo } from '../ui/Logo'
import { PlusIcon } from '../ui/icons'
import { EyeIcon, EyeSlashIcon } from '../ui/icons'
import { usePrivacy } from '../lib/privacy'
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

  // TWO locations, and knowing which one a question belongs to is the whole of
  // it.
  //
  // This component sits inside `<Routes location={background}>`, so its router
  // hooks answer about the page UNDERNEATH. That is right for the page — the
  // header asks "is a fund on screen behind me?" — and wrong for the overlays,
  // which are the one thing that has to read the address bar. `useMatch` gave
  // them the background's answer, so nothing matched and no overlay opened at
  // all: Add, a transaction, Settings, every one of them.
  //
  // `matchPath` takes the pathname explicitly, which is what makes the choice
  // visible in the code rather than a hook quietly making it for you.
  const path = useRealLocation()
  const addMatch = matchPath('/add', path.pathname)
  const txMatch = matchPath('/transactions/:transactionId', path.pathname)
  const settingsItem = matchPath('/settings/:section/:itemId', path.pathname)
  const settingsSection = matchPath('/settings/:section', path.pathname)
  const settingsRoot = matchPath('/settings', path.pathname)

  // These two stay on the background deliberately: they ask what page is
  // BEHIND, so opening a transaction over a fund keeps the fund's Back link.
  const potMatch = useMatch('/funds/:potId')
  const assetMatch = useMatch('/assets/:assetId')

  const addOpen = !!addMatch
  const settingsMatch = settingsItem ?? settingsSection ?? settingsRoot
  const onPage = !!potMatch || !!assetMatch

  const isDesktop = useMediaQuery(SM)

  /** Opening an overlay keeps the period in the URL, or the page behind it
   *  would jump to today the moment you pressed Add. */
  const overlay = useOverlay()
  const open = (pathname: string) => {
    const { to, options } = overlay(pathname)
    navigate(to, options)
  }

  // Closing is going back — an overlay is a history entry — unless there is no
  // back to go to, which is what a cold load straight onto an overlay URL looks
  // like. The real location's key, not the background's: on a cold load the
  // background IS the overlay, so reading its key was right there by accident
  // and wrong everywhere else.
  const close = () => {
    if (path.key === 'default') navigate('/', { replace: true })
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
      {/* pt carries the notch: installed to the Home Screen there is no
          browser chrome, so row one starts at y=0 — under the clock. The inset
          is 0 in a browser tab, so this is the same header in both. */}
      {/* Both strips float ON the page rather than sitting above and below it,
          so each fades into what it overlaps: the header is solid white at the
          top and nothing by its lower edge, the footer the reverse. A hard edge
          would cut the content in half; a gradient lets it run under and
          disappear. Deliberately no blur — the fade is doing that job, and
          backdrop-filter makes an element the containing block for its fixed
          descendants, which is how the add sheet once ended up pinned to the
          header instead of to the screen. */}
      <header className="sticky top-0 z-30 bg-gradient-to-b from-white via-white to-transparent px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-6">
        <div className="mx-auto max-w-[800px]">
          {/* Row 1: brand + account */}
          <div className="flex items-center justify-between">
            <BrandMark />
            <div className="flex items-center gap-3">
              <PrivacyToggle />
              <AvatarMenu onOpenSettings={() => open('/settings')} />
            </div>
          </div>

          {/* Leaving a page is navigation OUT of it, so it stays at the top
              where a back link belongs. Moving between months is not — it is
              the thing you do while reading, and it went to the bottom with
              the rest of the controls. */}
          {onPage && (
            <div className="mt-2">
              <BackLink />
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-[800px] px-4 pt-4 pb-32">
        <Outlet />
      </main>

      {/* The controls, at the bottom and over the page.
          Where your thumb already is on a phone, and where your eye ends up on
          a desktop after reading down. No bar, no backdrop — the two controls
          float on the content, and the gap between them is not a surface, so
          `pointer-events-none` on the strip lets a click through it to what is
          underneath. Only the controls themselves take clicks. */}
      {!onPage && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-white via-white to-transparent px-4 pt-8 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <div className="mx-auto flex max-w-[800px] items-center justify-between gap-2">
            <div className="pointer-events-auto relative">
              <PeriodControl />
            </div>
            {/* A plus on a phone. The sentence is worth its width on a desktop
                and costs half the strip on a phone, where a plus in a circle is
                the most legible button there is. Rendered, not hidden: two of
                them existing with one display:none is how they both once showed
                up at the same time. */}
            <div className="pointer-events-auto relative">
              {isDesktop ? (
                <Button variant="primary" onClick={() => open('/add')}>
                  Add transaction
                </Button>
              ) : (
                <button
                  onClick={() => open('/add')}
                  aria-label="Add transaction"
                  className="grid size-14 place-items-center rounded-full bg-brand text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  <PlusIcon className="size-6" />
                </button>
              )}
              {addOpen && isDesktop && <AddTransactionPopover onClose={close} />}
            </div>
          </div>
        </div>
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

/**
 * The way back off a page, in the slot the period control usually holds.
 *
 * Back through HISTORY rather than to a fixed destination, because a fund can
 * be reached from the month or from the year and "back" means the one you came
 * from. The fallback only fires when there is no history to walk — a shared
 * link opened cold — and it carries the period, or backing out of a fund you
 * were reading in March would land you in today.
 */
function BackLink() {
  const navigate = useNavigate()
  const path = useRealLocation()
  const keepPeriod = useKeepPeriod()
  return (
    <button
      onClick={() =>
        path.key === 'default' ? navigate(keepPeriod('/')) : navigate(-1)
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
/**
 * The curtain over the figures.
 *
 * In the header rather than in Settings, because it is not a preference you set
 * once — it is something you reach for as somebody sits down next to you, and a
 * control you have to go and find is one you will not reach in time.
 */
function PrivacyToggle() {
  const { hidden, toggle } = usePrivacy()
  return (
    // The word only where there is room for it. On a phone the header already
    // carries the brand and the avatar, and a third labelled control pushes one
    // of them off — the eye alone says enough there, and the accessible name
    // says the rest for anyone who cannot see it.
    <button
      onClick={toggle}
      aria-pressed={hidden}
      aria-label={hidden ? 'Show amounts' : 'Hide amounts'}
      title={hidden ? 'Show amounts' : 'Hide amounts'}
      // A circle while it is only an icon, and a pill once the word joins it.
      // Padding around an 18px glyph gave 38 wide by 44 tall — an egg. Fixing
      // the size rather than the padding is the only way that stays round.
      className="grid size-11 shrink-0 place-items-center rounded-full border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 hover:text-stone-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:flex sm:size-auto sm:min-h-8 sm:items-center sm:gap-1.5 sm:px-2.5 sm:text-sm"
    >
      {hidden ? (
        <EyeSlashIcon size={18} aria-hidden />
      ) : (
        <EyeIcon size={18} aria-hidden />
      )}
      <span className="hidden sm:inline">
        {hidden ? 'Show numbers' : 'Hide numbers'}
      </span>
    </button>
  )
}

function BrandMark() {
  return (
    <Link
      to="/"
      aria-label="doughnatello — home"
      // The same box as the avatar at the other end of the header, at both
      // breakpoints: 44px for a thumb, 32px for a pointer. They sit on one row
      // and any difference between them reads as a mistake.
      className="block size-11 shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:size-8"
    >
      <Logo className="size-full" />
    </Link>
  )
}
