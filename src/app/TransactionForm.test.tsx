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

/**
 * A picker you can type into, once there is enough in it to be worth typing.
 * Two dozen categories is a scroll, and scrolling to find "Štednja" when the
 * keyboard in front of you has no Š is the case this exists for.
 */
describe('searching a long picker', () => {
  const MANY = [
    ...CATEGORIES,
    ...['Štednja', 'Kućni računi', 'Fitness', 'Travel', 'Pets', 'Health', 'Fuel'].map(
      (name, i) => ({
        _id: `m${i}`,
        name,
        kind: 'discretionary',
        icon: 'star',
        color: '#78716C',
      }),
    ),
  ]

  test('a short list has no search field to get in the way', async () => {
    setFixtures(READY) // three categories
    renderScreen(<TransactionForm onDone={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Category' }))

    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  })

  test('a long one does, and it narrows the list as you type', async () => {
    setFixtures({ ...READY, 'categories:list': MANY })
    renderScreen(<TransactionForm onDone={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Category' }))

    const field = screen.getByRole('searchbox')
    await userEvent.type(field, 'ste')

    // Typed without the accent, found with it.
    expect(screen.getByRole('button', { name: 'Štednja' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Grocery' })).not.toBeInTheDocument()
  })

  test('two fragments mean both, and no match says so', async () => {
    setFixtures({ ...READY, 'categories:list': MANY })
    renderScreen(<TransactionForm onDone={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Category' }))

    await userEvent.type(screen.getByRole('searchbox'), 'kuc rac')
    expect(screen.getByRole('button', { name: 'Kućni računi' })).toBeInTheDocument()

    await userEvent.clear(screen.getByRole('searchbox'))
    await userEvent.type(screen.getByRole('searchbox'), 'zzz')
    expect(screen.getByText('Nothing matches')).toBeInTheDocument()
  })
})

/**
 * Duplicating. Everything carries over except the date, because the one date
 * you certainly do not mean is the old one — you are saying it happened again.
 */
describe('duplicating a transaction', () => {
  const DETAIL = {
    _id: 't1',
    direction: 'expense',
    amount: 2_500_00,
    categoryId: 'c1',
    potId: undefined,
    fromPotId: undefined,
    occurredOn: '2026-01-15',
    payee: 'Idea',
    note: 'weekly shop',
    accountId: 'a1',
    funding: [{ potId: undefined, amount: 2_500_00 }],
  }

  test('it prefills the copy but dates it today, and offers no Delete', async () => {
    setFixtures({ ...READY, 'transactions:detail': DETAIL })
    renderScreen(<TransactionForm copyOf={'t1' as never} onDone={() => {}} />)

    // Grouped, as the field now shows every amount.
    expect(await screen.findByLabelText('Amount')).toHaveValue('2.500')
    expect(screen.getByRole('button', { name: 'Category' })).toHaveTextContent(
      'Grocery',
    )
    expect(screen.getByDisplayValue('Idea')).toBeInTheDocument()

    // A copy is a new transaction: there is nothing yet to delete or duplicate.
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /duplicate/i }),
    ).not.toBeInTheDocument()

    // And it is not wearing January.
    expect(screen.queryByText(/2026-01-15/)).not.toBeInTheDocument()
  })

  test('editing the same transaction keeps its own date and can duplicate', async () => {
    setFixtures({ ...READY, 'transactions:detail': DETAIL })
    renderScreen(<TransactionForm transactionId={'t1' as never} onDone={() => {}} />)

    expect(
      await screen.findByRole('button', { name: /duplicate/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument()
  })
})

describe('scanning', () => {
  test('adding offers the scanner', () => {
    setFixtures(READY)
    renderScreen(<TransactionForm onDone={() => {}} />)
    expect(screen.getByRole('button', { name: 'Scan a QR code' })).toBeInTheDocument()
  })

  test('editing does not — a code describes a purchase, not a correction', async () => {
    setFixtures({
      ...READY,
      'transactions:detail': {
        _id: 't1',
        direction: 'expense',
        amount: 1_000_00,
        categoryId: 'c1',
        occurredOn: '2026-01-15',
        payee: 'Idea',
        accountId: 'a1',
        funding: [{ potId: undefined, amount: 1_000_00 }],
      },
    })
    renderScreen(<TransactionForm transactionId={'t1' as never} onDone={() => {}} />)
    await screen.findByRole('button', { name: /delete/i })
    expect(
      screen.queryByRole('button', { name: 'Scan a QR code' }),
    ).not.toBeInTheDocument()
  })
})

describe('the amount field', () => {
  test('groups thousands as you type, and still parses back', async () => {
    setFixtures(READY)
    renderScreen(<TransactionForm onDone={() => {}} />)
    const amount = screen.getByLabelText('Amount')

    await userEvent.type(amount, '44413')
    expect(amount).toHaveValue('44.413')

    // The decimals stay exactly as typed — no field rewrites "5" into "50"
    // while your finger is still on the way to the next key.
    await userEvent.type(amount, ',5')
    expect(amount).toHaveValue('44.413,5')
  })
})
