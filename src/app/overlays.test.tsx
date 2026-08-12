import { describe, expect, test } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useNavigate } from 'react-router-dom'
import { renderScreen, setFixtures } from '../test/render'
import { useBackgroundLocation, useOverlay } from '../period/PeriodContext'

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
 */
function Pages() {
  const background = useBackgroundLocation()
  return (
    <Routes location={background}>
      <Route path="/" element={<p>the month</p>} />
      <Route path="/funds/:id" element={<p>the fund page</p>} />
      {/* Overlay routes, mapped to the overview exactly as the app maps them. */}
      <Route path="/transactions/:id" element={<p>the month</p>} />
      <Route path="/settings/*" element={<p>the month</p>} />
    </Routes>
  )
}

function App() {
  const overlay = useOverlay()
  const navigate = useNavigate()
  const go = (to: string) => {
    const { to: dest, options } = overlay(to)
    navigate(dest, options)
  }
  return (
    <>
      <Pages />
      <button onClick={() => go('/transactions/t1')}>open a transaction</button>
      <button onClick={() => go('/settings/funds')}>open settings</button>
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
  })

  test('the same for settings, which had the same fault', async () => {
    setFixtures({})
    renderScreen(<App />, { route: '/funds/p1' })
    await userEvent.click(screen.getByRole('button', { name: 'open settings' }))
    expect(screen.getByText('the fund page')).toBeInTheDocument()
  })

  test('opened from the overview, the overview stays', async () => {
    setFixtures({})
    renderScreen(<App />, { route: '/' })
    await userEvent.click(screen.getByRole('button', { name: 'open a transaction' }))
    expect(screen.getByText('the month')).toBeInTheDocument()
  })

  test('a second overlay does not stack a background it cannot return to', async () => {
    setFixtures({})
    renderScreen(<App />, { route: '/funds/p1' })
    await userEvent.click(screen.getByRole('button', { name: 'open a transaction' }))
    await userEvent.click(screen.getByRole('button', { name: 'open settings' }))
    // Still the fund — not the month, and not a transaction route pretending
    // to be a page.
    expect(screen.getByText('the fund page')).toBeInTheDocument()
  })
})
