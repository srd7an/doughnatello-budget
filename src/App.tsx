import { useState } from 'react'
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useQuery,
} from 'convex/react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { api } from '../convex/_generated/api'
import { SignInForm } from './SignInForm'
import { AcceptInvite, CreateHousehold } from './Onboarding'
import { HouseholdProvider } from './household/HouseholdContext'
import { PeriodProvider } from './period/PeriodContext'
import { AppShell } from './app/AppShell'
import { Overview } from './screens/Overview'
import { PotPage } from './screens/PotPage'

function inviteTokenFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get('invite')
}

function App() {
  return (
    <>
      <AuthLoading>
        <Splash>Loading…</Splash>
      </AuthLoading>
      <Unauthenticated>
        <SignInForm />
      </Unauthenticated>
      <Authenticated>
        <AuthedApp />
      </Authenticated>
    </>
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
      <PeriodProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<Overview />} />
              {/* A fund or a loan is the one thing besides the overview that
                  is a PAGE — it has its own history to show and its own way
                  back. */}
              <Route path="funds/:potId" element={<PotPage />} />
              {/* Overlays. They are routes so the back button closes them and
                  a link to one can be shared, and they render over whatever
                  page they were opened from — Overview on a cold load. See
                  AppShell, which reads the path and draws them. */}
              <Route path="add" element={<Overview />} />
              <Route path="transactions/:transactionId" element={<Overview />} />
              <Route path="settings" element={<Overview />} />
              <Route path="settings/:section" element={<Overview />} />
              <Route path="*" element={<Overview />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </PeriodProvider>
    </HouseholdProvider>
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
