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
import { Settings } from './screens/Settings'
import { Repeating } from './screens/Repeating'

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
              <Route path="settings" element={<Settings />} />
              <Route path="settings/repeating" element={<Repeating />} />
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
