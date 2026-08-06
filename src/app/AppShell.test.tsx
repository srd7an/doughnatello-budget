import { describe, expect, test, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { renderScreen, setFixtures } from '../test/render'
import { setViewport } from '../test/setup'
import { AppShell } from './AppShell'
import { ErrorBoundary } from '../ui/ErrorBoundary'

/**
 * The shell draws. That is the whole claim, and it is the one nothing else
 * checked: two bugs shipped this session — a screen that rendered nothing and
 * a screen that rendered a control twice — and neither the type checker, the
 * Convex suite nor a static mock-up of the markup could have caught either,
 * because none of them mount a component.
 */
const EMPTY = {
  'overview:month': {
    income: 0,
    expense: 0,
    savings: 0,
    leftToSpend: 0,
    paidFromFunds: 0,
  },
  'transactions:listMonth': [],
  'recurring:listDue': [],
  'categories:list': [],
  'pots:balances': [],
  'accounts:list': [],
}

const shell = (route: string) =>
  renderScreen(
    <Routes>
      <Route element={<AppShell />}>
        <Route path="*" element={<div>overview</div>} />
      </Route>
    </Routes>,
    { route },
  )

describe('the shell', () => {
  test('offers exactly one way to add on a phone, and one on a desktop', () => {
    setFixtures(EMPTY)

    // The bug: the header button carried `hidden sm:inline-flex` and Button's
    // base already set `inline-flex`, so `hidden` lost and both showed.
    setViewport('phone')
    const phone = shell('/')
    expect(screen.getAllByRole('button', { name: /add transaction/i })).toHaveLength(1)
    phone.unmount()

    setViewport('desktop')
    shell('/')
    expect(screen.getAllByRole('button', { name: /add transaction/i })).toHaveLength(1)
  })

  test('/add opens the form, on both widths', () => {
    setFixtures(EMPTY)

    setViewport('phone')
    const phone = shell('/add')
    expect(screen.getByLabelText('Amount')).toBeInTheDocument()
    phone.unmount()

    setViewport('desktop')
    shell('/add')
    expect(screen.getByLabelText('Amount')).toBeInTheDocument()
  })

  test('the period comes from the URL, and offers the way home when it is not today', () => {
    setFixtures(EMPTY)
    setViewport('desktop')

    const past = shell('/?p=2026-01')
    expect(screen.getByText('January 2026')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /today/i })).toBeInTheDocument()
    past.unmount()

    // On the month today falls in there is nowhere to go, so nothing offers.
    const now = new Date()
    const p = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    shell(`/?p=${p}`)
    expect(screen.queryByRole('button', { name: /today/i })).not.toBeInTheDocument()
  })

  test('settings keeps the month the page behind it is showing', async () => {
    setFixtures(EMPTY)
    setViewport('desktop')
    shell('/settings/accounts?p=2026-01')

    // The month is behind the modal, and changing panel must not disturb it —
    // navigating without the query string snapped it back to today.
    expect(screen.getByText('January 2026')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Funds' }))
    expect(screen.getByText('January 2026')).toBeInTheDocument()
  })

  test('the period control gives up its slot to a way back on a page', () => {
    setFixtures(EMPTY)
    setViewport('desktop')

    const overview = shell('/')
    expect(screen.getByRole('button', { name: /next period/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^back$/i })).not.toBeInTheDocument()
    overview.unmount()

    shell('/funds/p1')
    expect(screen.getByRole('button', { name: /^back$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /next period/i })).not.toBeInTheDocument()
  })
})

describe('when something throws', () => {
  test('the app says so instead of going blank', () => {
    const Boom = () => {
      throw new Error('the query is unhappy')
    }
    // React logs the caught error; the test is about what the user sees.
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderScreen(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    quiet.mockRestore()

    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
    expect(screen.getByText(/the query is unhappy/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /back to the overview/i }),
    ).toBeInTheDocument()
  })
})

/**
 * The curtain over the figures. What is pinned is that the control is in the
 * HEADER and reachable from anywhere — not that CSS blurs, which is CSS's job.
 */
describe('hiding the amounts', () => {
  test('the toggle is in the header, and says which way it will go', async () => {
    setFixtures(EMPTY)
    shell('/')

    const hide = screen.getByRole('button', { name: 'Hide amounts' })
    expect(hide).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(hide)

    const show = screen.getByRole('button', { name: 'Show amounts' })
    expect(show).toHaveAttribute('aria-pressed', 'true')
    // And the page is actually marked, which is what the stylesheet keys off.
    expect(document.documentElement).toHaveAttribute('data-private')

    await userEvent.click(show)
    expect(document.documentElement).not.toHaveAttribute('data-private')
  })
})
