import { describe, expect, test } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderScreen, setFixtures } from '../test/render'
import { TransactionForm } from './TransactionForm'

/**
 * What the form draws, and when.
 *
 * The interesting cases are the two it got wrong: rendering against data that
 * has not arrived, which grew the card a row at a time as the queries landed;
 * and rendering rows that do not belong to the direction you are in.
 */
const CATEGORIES = [
  { _id: 'c1', name: 'Grocery', kind: 'committed', icon: 'basket', color: '#E8632A' },
  { _id: 'c2', name: 'Salary', kind: 'income', icon: 'wallet', color: '#1D9E75' },
  { _id: 'c3', name: 'Takeout', kind: 'discretionary', icon: 'utensils', color: '#DB2777' },
]
const POTS = [
  {
    _id: 'p1',
    name: 'Rainy day',
    kind: 'savings',
    icon: 'piggy',
    color: '#1D9E75',
    balance: 40_000_00,
    owed: null,
  },
  {
    _id: 'p2',
    name: 'Car loan',
    kind: 'debt',
    icon: 'car',
    color: '#B45309',
    balance: 0,
    owed: 900_000_00,
  },
]
const READY = {
  'categories:list': CATEGORIES,
  'pots:balances': POTS,
  'accounts:list': [{ _id: 'a1', name: 'Main', isPrimary: true }],
}

describe('while the data is still coming', () => {
  test('the card is already its full height, and cannot be saved', () => {
    setFixtures({}) // nothing has landed
    renderScreen(<TransactionForm onDone={() => {}} />)

    // The parts that depend on nothing are there immediately — the amount
    // above all, because it is the first thing anyone types.
    expect(screen.getByLabelText('Amount')).toBeInTheDocument()

    // And the rows that are still coming hold their places rather than
    // appearing one at a time underneath.
    for (const label of ['Category', 'Payee', 'Pay from', 'Paying off', 'Repeat', 'Note']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
  })
})

describe('once it has', () => {
  test('an expense offers a fund to pay from and a loan to pay off', () => {
    setFixtures(READY)
    renderScreen(<TransactionForm onDone={() => {}} />)

    expect(screen.getByRole('button', { name: 'Category' })).toHaveTextContent('Grocery')
    expect(screen.getByRole('button', { name: 'Pay from' })).toHaveTextContent(
      "Month's income",
    )
    expect(screen.getByRole('button', { name: 'Paying off' })).toHaveTextContent('Loan')
  })

  test('income has neither — nothing funds income, and it pays nothing off', async () => {
    setFixtures(READY)
    renderScreen(<TransactionForm onDone={() => {}} />)

    await userEvent.click(screen.getByRole('tab', { name: 'Income' }))

    expect(screen.queryByText('Pay from')).not.toBeInTheDocument()
    expect(screen.queryByText('Paying off')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Category' })).toHaveTextContent('Salary')
  })

  test('a transfer swaps its category for two ends', async () => {
    setFixtures(READY)
    renderScreen(<TransactionForm onDone={() => {}} />)

    await userEvent.click(screen.getByRole('tab', { name: 'Transfer' }))

    expect(screen.queryByText('Category')).not.toBeInTheDocument()
    expect(screen.getByText('Pay from')).toBeInTheDocument()
    expect(screen.getByText('Into')).toBeInTheDocument()
  })

  test('the options escape the card that would have clipped them', async () => {
    setFixtures(READY)
    const { container } = renderScreen(<TransactionForm onDone={() => {}} />)

    await userEvent.click(screen.getByRole('button', { name: 'Category' }))
    const panel = screen.getByRole('dialog', { name: 'Category' })

    // Rendered to the body, not inside the form. Every card this sits in
    // clips — rounded corners, a scrolling modal — and an absolutely
    // positioned child of one is cut off at its edge.
    expect(container.contains(panel)).toBe(false)
    expect(document.body.contains(panel)).toBe(true)
  })

  test('picking a category closes the popover and shows the choice', async () => {
    setFixtures(READY)
    renderScreen(<TransactionForm onDone={() => {}} />)

    await userEvent.click(screen.getByRole('button', { name: 'Category' }))
    // An expense is offered expense categories only — Salary is not among them.
    expect(screen.queryByRole('button', { name: 'Salary' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Takeout' }))

    expect(screen.getByRole('button', { name: 'Category' })).toHaveTextContent('Takeout')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('deleting', () => {
  test('asks first, in the same button', async () => {
    setFixtures({
      ...READY,
      'transactions:detail': {
        _id: 't1',
        direction: 'expense',
        amount: 2_000_00,
        occurredOn: '2026-07-05',
        payee: 'Maxi',
        note: null,
        categoryId: 'c1',
        potId: null,
        fromPotId: null,
        accountId: 'a1',
        accountName: 'Main',
        paidBy: 'u1',
        paidByName: 'Me',
        createdAt: 0,
        category: { name: 'Grocery', icon: 'basket', color: '#E8632A' },
        pot: null,
        fromPot: null,
        funding: [{ amount: 2_000_00, potId: null, potName: null }],
      },
    })
    renderScreen(
      <TransactionForm transactionId={'t1' as never} onDone={() => {}} />,
    )

    const del = screen.getByRole('button', { name: 'Delete' })
    await userEvent.click(del)
    expect(
      screen.getByRole('button', { name: /yes, delete it/i }),
    ).toBeInTheDocument()
  })
})
