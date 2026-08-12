import { describe, expect, test } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { matchPath, Outlet, Route, Routes, useNavigate } from 'react-router-dom'
import { renderScreen, setFixtures } from '../test/render'
import {
  useBackgroundLocation,
  useOverlay,
  useRealLocation,
} from '../period/PeriodContext'

/**
 * An overlay is a route, so the back button closes it and a link to one can be
 * shared. But a route has to render SOMETHING, and every overlay route was
 * mapped to the overview — so opening a transaction from a fund's page replaced
 * that page with the month, and closing the modal left you somewhere you had
 * never gone.
 *
 * The fix is React Router's own: remember the location underneath and match the
 * page routes against that. This holds the behaviour rather than the mechanism,
 * because the mechanism is the part that will be rewritten.
 *
 * The shape below is the app's, and the shape is the point: the overlays are
 * drawn by the LAYOUT, which is inside the scoped Routes — where every router
 * hook answers about the background rather than about the address bar. Reading
 * the address bar there has to be a deliberate act, and this file is what says
 * so.
 *
 * The first version of this test had no overlay in it at all. It asserted the
 * page stays, which is half the requirement, and passed for weeks while not one
 * overlay in the app could open.
 */
function Shell() {
  // The address bar, handed in from above. `useRealLocation` and not
  // `useLocation`, which down here would answer "the fund page".
  const path = useRealLocation()
  const tx = matchPath('/transactions/:id', path.pathname)
  const settings = matchPath('/settings/:section', path.pathname)
  const add = matchPath('/add', path.pathname)
  const copy = new URLSearchParams(path.search).get('copy')
  return (
    <>
      <Outlet />
      {tx && <p>transaction {tx.params.id}</p>}
      {settings && <p>settings: {settings.params.section}</p>}
      {add && <p>add{copy ? `, copying ${copy}` : ''}</p>}
    </>
  )
}

function Pages() {
  const background = useBackgroundLocation()
  return (
    <Routes location={background}>
      <Route element={<Shell />}>
        <Route path="/" element={<p>the month</p>} />
        <Route path="/funds/:id" element={<p>the fund page</p>} />
        {/* Overlay routes, mapped to the overview exactly as the app maps
            them: what they draw is a BACKGROUND, not the overlay. */}
        <Route path="/transactions/:id" element={<p>the month</p>} />
        <Route path="/settings/*" element={<p>the month</p>} />
        <Route path="/add" element={<p>the month</p>} />
      </Route>
    </Routes>
  )
}

function App() {
  const overlay = useOverlay()
  const navigate = useNavigate()
  const go = (to: string, extra?: Record<string, string>) => {
    const { to: dest, options } = overlay(to, extra)
    navigate(dest, options)
  }
  return (
    <>
      <Pages />
      <button onClick={() => go('/transactions/t1')}>open a transaction</button>
      <button onClick={() => go('/settings/funds')}>open settings</button>
      <button onClick={() => go('/add', { copy: 't1' })}>duplicate</button>
    </>
  )
}

describe('an overlay opened from a page', () => {
  test('leaves that page underneath it', async () => {
    setFixtures({})
    renderScreen(<App />, { route: '/funds/p1' })
    expect(screen.getByText('the fund page')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'open a transaction' }))

    // The URL moved — the modal reads it — but the page did not.
    expect(screen.getByText('the fund page')).toBeInTheDocument()
    expect(screen.queryByText('the month')).not.toBeInTheDocument()
    // And the modal is actually THERE. Without this line the whole file passes
    // while nothing opens.
    expect(screen.getByText('transaction t1')).toBeInTheDocument()
  })

  test('the same for settings, which had the same fault', async () => {
    setFixtures({})
    renderScreen(<App />, { route: '/funds/p1' })
    await userEvent.click(screen.getByRole('button', { name: 'open settings' }))
    expect(screen.getByText('the fund page')).toBeInTheDocument()
    expect(screen.getByText('settings: funds')).toBeInTheDocument()
  })

  test('opened from the overview, the overview stays', async () => {
    setFixtures({})
    renderScreen(<App />, { route: '/' })
    await userEvent.click(screen.getByRole('button', { name: 'open a transaction' }))
    expect(screen.getByText('the month')).toBeInTheDocument()
    expect(screen.getByText('transaction t1')).toBeInTheDocument()
  })

  test('opens on a cold load straight onto its URL, over the overview', () => {
    setFixtures({})
    renderScreen(<App />, { route: '/transactions/t9' })
    expect(screen.getByText('transaction t9')).toBeInTheDocument()
    expect(screen.getByText('the month')).toBeInTheDocument()
  })

  test('duplicating carries its argument, and the page it was opened from', async () => {
    setFixtures({})
    renderScreen(<App />, { route: '/funds/p1?period=2026-03' })

    await userEvent.click(screen.getByRole('button', { name: 'duplicate' }))

    // `?copy=` is on the address bar; the page behind has no such param, and
    // reading the page's query string is how every duplicate opened blank.
    expect(screen.getByText('add, copying t1')).toBeInTheDocument()
    expect(screen.getByText('the fund page')).toBeInTheDocument()
  })

  test('a second overlay does not stack a background it cannot return to', async () => {
    setFixtures({})
    renderScreen(<App />, { route: '/funds/p1' })
    await userEvent.click(screen.getByRole('button', { name: 'open a transaction' }))
    await userEvent.click(screen.getByRole('button', { name: 'open settings' }))
    // Still the fund — not the month, and not a transaction route pretending
    // to be a page — and the second overlay is the one on screen.
    expect(screen.getByText('the fund page')).toBeInTheDocument()
    expect(screen.getByText('settings: funds')).toBeInTheDocument()
  })
})
