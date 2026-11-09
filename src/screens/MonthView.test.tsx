import { describe, expect, test } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderScreen, setFixtures } from '../test/render'
import { MonthView } from './MonthView'

/**
 * The headline is the figure you decide by, so it has to be the one that is
 * true. It read 60.000 above a list of bills that had not been paid; these hold
 * that what is promised comes off it, that the screen shows the working, and
 * that a month which is over is left exactly as it was.
 */
const MONTH = {
  income: 100_000_00,
  expense: 30_000_00,
  savings: 10_000_00,
  leftToSpend: 60_000_00,
  setAside: 10_000_00,
  sinking: 0,
  drawnFromFunds: 0,
  drawnPlanned: 0,
  drawnFromSavings: 0,
}

const outlook = (incoming = 0) => ({
  today: '2026-11-09',
  through: '2026-11-30',
  due: {
    count: 1,
    outgoing: 20_000_00,
    fromIncome: 20_000_00,
    incoming: 0,
    oldestDueOn: '2026-11-01',
  },
  upcoming: {
    count: 2,
    outgoing: 5_000_00,
    fromIncome: 5_000_00,
    incoming,
    items: [],
  },
})

const fixtures = (extra: Record<string, unknown> = {}) => ({
  'overview:month': MONTH,
  'overview:monthStocks': { funds: [], loans: [], assets: [] },
  'overview:monthCategories': [],
  'overview:balances': { inBank: 500_000_00, setAside: 200_000_00, free: 300_000_00 },
  'transactions:listMonth': [],
  'recurring:outlook': outlook(),
  'recurring:listDue': [],
  ...extra,
})

describe('the month, at a glance', () => {
  test('what is due and still to come is taken off what is left', () => {
    setFixtures(fixtures())
    renderScreen(<MonthView />)

    // 60.000 left, less 20.000 due and 5.000 to come.
    expect(screen.getByText('35.000')).toBeInTheDocument()
    expect(screen.queryByText('60.000')).not.toBeInTheDocument()
    // The working is on the screen, not left to be guessed.
    expect(screen.getByText(/^after\s+due now and\s+still to come by/)).toBeInTheDocument()
  })

  test('income the rules still expect is counted, and said', () => {
    setFixtures(fixtures({ 'recurring:outlook': outlook(40_000_00) }))
    renderScreen(<MonthView />)

    expect(screen.getByText('75.000')).toBeInTheDocument()
    expect(screen.getByText(/of income still expected/)).toBeInTheDocument()
  })

  test('the bank balance and what is still to pay are on the first screen', () => {
    setFixtures(fixtures())
    renderScreen(<MonthView />)

    expect(screen.getByText('In the bank')).toBeInTheDocument()
    expect(screen.getByText('500.000')).toBeInTheDocument()
    expect(screen.getByText('300.000 outside funds')).toBeInTheDocument()
    // Named late in words, not only by its colour.
    expect(screen.getByText(/1 due now · 2 to come/)).toBeInTheDocument()
  })

  test('the list of what is due is shut until asked for', async () => {
    setFixtures(
      fixtures({
        'recurring:listDue': [
          {
            _id: 'o1',
            dueOn: '2026-11-01',
            direction: 'expense',
            amount: 20_000_00,
            amountMode: 'exact',
            payee: 'Rent',
            category: null,
            pot: null,
          },
        ],
      }),
    )
    renderScreen(<MonthView />)
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /still to pay/i, expanded: false }))
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
  })

  test('a month that is over is not charged with this month’s bills', () => {
    setFixtures(fixtures())
    renderScreen(<MonthView />, { route: '/?p=2020-01' })

    expect(screen.getByText('Left from income')).toBeInTheDocument()
    expect(screen.getByText('60.000')).toBeInTheDocument()
    expect(screen.queryByText('In the bank')).not.toBeInTheDocument()
    expect(screen.queryByText(/due now/)).not.toBeInTheDocument()
  })
})
