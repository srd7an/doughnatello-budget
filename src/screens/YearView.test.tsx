import { describe, expect, test } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderScreen, setFixtures } from '../test/render'
import { YearView } from './YearView'

/**
 * The year's change is the one figure on the screen that cannot be checked
 * against the ones beside it: Income minus Expense does not make it. So it has
 * to be able to show its working, and this holds that it does — and that the
 * working says the arithmetic the server actually did, loan payments left out
 * and named as left out.
 */
const MONTHS = Array.from({ length: 12 }, () => ({
  income: 0,
  expense: 0,
  savings: 0,
  leftToSpend: 0,
  setAside: 0,
  sinking: 0,
  drawnFromFunds: 0,
  drawnPlanned: 0,
  drawnFromSavings: 0,
}))

const YEAR = {
  netWorth: 1_000_000_00,
  netWorthChange: 280_000_00,
  netWorthParts: {
    income: 300_000_00,
    spending: 20_000_00,
    revaluation: 0,
    loanPayments: 50_000_00,
  },
  bank: 1_000_000_00,
  months: MONTHS,
  totals: {
    income: 300_000_00,
    expense: 70_000_00,
    savings: 0,
    leftToSpend: 230_000_00,
    setAside: 0,
    sinking: 0,
    drawnFromFunds: 0,
    drawnPlanned: 0,
    drawnFromSavings: 0,
  },
  funds: { balance: 0, change: 0, items: [] },
  assets: { balance: 0, change: 0, items: [] },
  loans: { balance: -450_000_00, change: 50_000_00, items: [] },
}

describe('the year change explains itself', () => {
  test('opens the working, and it adds up to the figure on screen', async () => {
    setFixtures({ 'overview:year': YEAR, 'transactions:listYear': [] })
    renderScreen(<YearView />)

    const trigger = screen.getByRole('button', { name: /how this year/i })
    expect(trigger).toHaveTextContent('+280.000 this year')

    await userEvent.click(trigger)
    const panel = screen.getByRole('dialog')

    // The three terms, and the figure they make.
    expect(panel).toHaveTextContent('Income')
    expect(panel).toHaveTextContent('+300.000')
    expect(panel).toHaveTextContent('Spending')
    expect(panel).toHaveTextContent('−20.000')
    expect(panel).toHaveTextContent('+280.000')

    // The gap from the Expense figure beside it is 50.000 of loan payments,
    // and the panel is the only place that says so.
    expect(panel).toHaveTextContent('50.000')
    expect(panel).toHaveTextContent(/Loan payments/i)
  })

  test('a household with no assets is not told about revaluation', async () => {
    setFixtures({ 'overview:year': YEAR, 'transactions:listYear': [] })
    renderScreen(<YearView />)

    await userEvent.click(screen.getByRole('button', { name: /how this year/i }))
    expect(screen.getByRole('dialog')).not.toHaveTextContent('revalued')
  })
})
