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
import { AccountPanel } from './screens/settings/AccountPanel'
import { FundsPanel } from './screens/settings/FundsPanel'
import { AssetsPanel } from './screens/settings/AssetsPanel'
import { LoansPanel } from './screens/settings/LoansPanel'
import { CategoriesPanel } from './screens/settings/CategoriesPanel'
import { PeoplePanel } from './screens/settings/PeoplePanel'
import { InvitesPanel } from './screens/settings/InvitesPanel'
import { FormatPanel } from './screens/settings/FormatPanel'
import { ExportPanel } from './screens/settings/ExportPanel'

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
              <Route path="settings/account" element={<AccountPanel />} />
              <Route path="settings/funds" element={<FundsPanel />} />
              <Route path="settings/assets" element={<AssetsPanel />} />
              <Route path="settings/loans" element={<LoansPanel />} />
              <Route path="settings/categories" element={<CategoriesPanel />} />
              <Route path="settings/repeating" element={<Repeating />} />
              <Route path="settings/people" element={<PeoplePanel />} />
              <Route path="settings/invites" element={<InvitesPanel />} />
              <Route path="settings/format" element={<FormatPanel />} />
              <Route path="settings/export" element={<ExportPanel />} />
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
