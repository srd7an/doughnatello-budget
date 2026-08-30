import { describe, expect, test } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderScreen, setFixtures } from '../test/render'
import { YearView } from './YearView'

/**
 * Neither half of the hero can be checked against the numbers beside it:
 * nothing on the screen adds up to net worth, and Income minus Expense does not
 * make the change. So the panel shows both sums, and this holds that it shows
 * the arithmetic the server actually did — funds kept OUT of the stock (they
 * are inside Bank; adding them counts the same money twice) and loan payments
 * kept out of the flow, both named as left out.
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
  netWorth: 1_000_000_00, // bank 900.000 + assets 550.000 − loans 450.000
  netWorthChange: 280_000_00,
  netWorthParts: {
    openedOn: '2025-12-31',
    opening: 720_000_00,
    closing: 1_000_000_00,
    bank: 230_000_00,
    assets: 0,
    loans: 50_000_00,
  },
  bank: 900_000_00,
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
  funds: { balance: 120_000_00, change: 0, items: [] },
  assets: { balance: 550_000_00, change: 0, items: [] },
  loans: { balance: -450_000_00, change: 50_000_00, items: [] },
}

describe('the year change explains itself', () => {
  test('shows what net worth is: bank + assets − loans', async () => {
    setFixtures({ 'overview:year': YEAR, 'transactions:listYear': [] })
    renderScreen(<YearView />)

    await userEvent.click(screen.getByRole('button', { name: /net worth/i }))
    const panel = screen.getByRole('dialog')

    expect(panel).toHaveTextContent('Bank')
    expect(panel).toHaveTextContent('900.000')
    expect(panel).toHaveTextContent('Assets')
    expect(panel).toHaveTextContent('550.000')
    expect(panel).toHaveTextContent('Loans')
    expect(panel).toHaveTextContent('−450.000')
    expect(panel).toHaveTextContent('1.000.000')
  })

  test('a fund is never a line of the stock — it is already inside Bank', async () => {
    setFixtures({ 'overview:year': YEAR, 'transactions:listYear': [] })
    renderScreen(<YearView />)

    await userEvent.click(screen.getByRole('button', { name: /net worth/i }))
    const panel = screen.getByRole('dialog')

    // 120.000 sits in a fund and must not appear as a term: bank + assets −
    // loans is the whole sum, and the panel says why rather than showing it.
    expect(panel).not.toHaveTextContent('120.000')
    expect(panel).toHaveTextContent(/already inside Bank/i)
  })

  test('the change is the sheet moving, line by line', async () => {
    setFixtures({ 'overview:year': YEAR, 'transactions:listYear': [] })
    renderScreen(<YearView />)

    const trigger = screen.getByRole('button', { name: /net worth/i })
    expect(trigger).toHaveTextContent('+280.000 this year')

    await userEvent.click(trigger)
    const panel = screen.getByRole('dialog')

    // The same three lines as the sheet above it, each as far as it moved —
    // and they are the change, with nothing left to take on faith.
    expect(panel).toHaveTextContent('Since 31.12.2025.')
    expect(panel).toHaveTextContent('Bank')
    expect(panel).toHaveTextContent('+230.000')
    expect(panel).toHaveTextContent('Loans')
    expect(panel).toHaveTextContent('+50.000')
    expect(panel).toHaveTextContent('+280.000')

    // The figure it is all measured from, and what the Loans line really is.
    expect(panel).toHaveTextContent('720.000')
    expect(panel).toHaveTextContent(/gone from the account/i)
  })

  test('a line that did not move is not drawn', async () => {
    setFixtures({
      'overview:year': {
        ...YEAR,
        netWorthChange: 230_000_00,
        netWorthParts: { ...YEAR.netWorthParts, loans: 0 },
        loans: { balance: 0, change: 0, items: [] },
      },
      'transactions:listYear': [],
    })
    renderScreen(<YearView />)

    await userEvent.click(screen.getByRole('button', { name: /net worth/i }))
    const panel = screen.getByRole('dialog')
    expect(panel).not.toHaveTextContent('Loans')
    expect(panel).not.toHaveTextContent(/gone from the account/i)
  })

  test('a year the assets slept through says nothing about assets', async () => {
    setFixtures({ 'overview:year': YEAR, 'transactions:listYear': [] })
    renderScreen(<YearView />)

    await userEvent.click(screen.getByRole('button', { name: /net worth/i }))
    // Assets are a line of the sheet above (550.000 of them) and not of the
    // change, because they did not move.
    const rows = screen.getByRole('dialog').textContent ?? ''
    expect(rows.match(/Assets/g)).toHaveLength(1)
  })
})
