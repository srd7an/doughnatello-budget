import { useState } from 'react'
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useQuery,
} from 'convex/react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { api } from '../convex/_generated/api'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { SignInForm } from './SignInForm'
import { AcceptInvite, CreateHousehold } from './Onboarding'
import { HouseholdProvider } from './household/HouseholdContext'
import {
  PeriodProvider,
  RealLocationProvider,
  useBackgroundLocation,
} from './period/PeriodContext'
import { AppShell } from './app/AppShell'
import { Overview } from './screens/Overview'
import { PotPage } from './screens/PotPage'
import { AssetPage } from './screens/AssetPage'
import { TagPage } from './screens/TagPage'

function inviteTokenFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get('invite')
}

function App() {
  return (
    <ErrorBoundary>
      <AuthLoading>
        <Splash>Loading…</Splash>
      </AuthLoading>
      <Unauthenticated>
        <SignInForm />
      </Unauthenticated>
      <Authenticated>
        <AuthedApp />
      </Authenticated>
    </ErrorBoundary>
  )
}

function AuthedApp() {
  const households = useQuery(api.households.listMine)
  const [inviteToken, setInviteToken] = useState<string | null>(
    inviteTokenFromUrl,
  )

  const clearInvite = () => {
    setInviteToken(null)
    window.history.replaceState({}, '', window.location.pathname)
  }

  if (households === undefined) {
    return <Splash>Loading…</Splash>
  }

  if (inviteToken) {
    return <AcceptInvite token={inviteToken} onDone={clearInvite} />
  }

  if (households.length === 0) {
    return <CreateHousehold />
  }

  return (
    <HouseholdProvider households={households}>
      <BrowserRouter>
        <PeriodProvider>
          <Shell />
        </PeriodProvider>
      </BrowserRouter>
    </HouseholdProvider>
  )
}

/**
 * The page routes, matched against the location UNDERNEATH the overlays.
 *
 * Split out because it has to be inside the router to read the location at all.
 * See `useOverlay`: an overlay records which page it was opened over, and the
 * page routes match that rather than the address bar — so opening a transaction
 * from a fund leaves the fund on screen, which is what it always claimed to do.
 */
function Shell() {
  const background = useBackgroundLocation()
  return (
    // Out here the router still answers about the address bar; inside the
    // Routes below it answers about `background`. AppShell lives inside and
    // draws the overlays, so the real one is handed past them on the way in.
    <RealLocationProvider>
      <Routes location={background}>
        <Route element={<AppShell />}>
          <Route index element={<Overview />} />
          {/* A fund or a loan is the one thing besides the overview that
                  is a PAGE — it has its own history to show and its own way
                  back. */}
          <Route path="funds/:potId" element={<PotPage />} />
          <Route path="assets/:assetId" element={<AssetPage />} />
          {/* A tag is a page for the same reason a fund is: it is all of
                  time, it has its own history to scroll, and it is a place you
                  come back to. */}
          <Route path="tags/:tagId" element={<TagPage />} />
          {/* Overlays. They are routes so the back button closes them and
                  a link to one can be shared, and they render over whatever
                  page they were opened from — Overview on a cold load. See
                  AppShell, which reads the path and draws them. */}
          <Route path="add" element={<Overview />} />
          <Route path="transactions/:transactionId" element={<Overview />} />
          <Route path="settings" element={<Overview />} />
          <Route path="settings/:section" element={<Overview />} />
          <Route path="settings/:section/:itemId" element={<Overview />} />
          <Route path="*" element={<Overview />} />
        </Route>
      </Routes>
    </RealLocationProvider>
  )
}

function Splash({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-svh place-items-center bg-stone-50 text-stone-400">
      {children}
    </div>
  )
}

export default App
