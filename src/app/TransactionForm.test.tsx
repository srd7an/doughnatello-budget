import { describe, expect, test } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
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
  {
    _id: 'c1',
    name: 'Grocery',
    kind: 'committed',
    icon: 'basket',
    color: '#E8632A',
  },
  {
    _id: 'c2',
    name: 'Salary',
    kind: 'income',
    icon: 'wallet',
    color: '#1D9E75',
  },
  {
    _id: 'c3',
    name: 'Takeout',
    kind: 'discretionary',
    icon: 'utensils',
    color: '#DB2777',
  },
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
const TAGS = [
  { _id: 't1', name: 'Grčka 2026', color: '#14B8A6', icon: 'palm', count: 6 },
]
const READY = {
  'categories:list': CATEGORIES,
  'pots:balances': POTS,
  'accounts:list': [{ _id: 'a1', name: 'Main', isPrimary: true }],
  'tags:list': TAGS,
  'categories:usage': {},
}

describe('while the data is still coming', () => {
  test('the card is already its full height, and cannot be saved', () => {
    setFixtures({}) // nothing has landed
    renderScreen(<TransactionForm onDone={() => {}} />)

    // The parts that depend on nothing are there immediately — the amount
    // above all, because it is the first thing anyone types.
    expect(screen.getByLabelText('Amount')).toBeInTheDocument()

    // And the rows still coming hold their places rather than appearing one
    // at a time underneath. They carry no text now — the design dropped the
    // labels — so what is counted is the number of placeholder rows.
    expect(
      document.querySelectorAll('.animate-none, [aria-hidden]').length,
    ).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
  })
})

describe('once it has', () => {
  test('an expense offers a fund and a loan as invitations, not empty fields', () => {
    setFixtures(READY)
    renderScreen(<TransactionForm onDone={() => {}} />)

    expect(screen.getByRole('radio', { name: /Grocery/ })).toBeChecked()

    // Unset, both are actions. A row reading "Month's income" on every single
    // expense is a row that says nothing on every single expense.
    expect(
      screen.getByRole('button', { name: 'Pay from a fund' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Pay a loan' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Pay from' }),
    ).not.toBeInTheDocument()
  })

  test('choosing a fund turns the invitation into an ordinary row', async () => {
    setFixtures(READY)
    renderScreen(<TransactionForm onDone={() => {}} />)

    await userEvent.click(
      screen.getByRole('button', { name: 'Pay from a fund' }),
    )
    expect(screen.getByRole('button', { name: 'Pay from' })).toHaveTextContent(
      'Rainy day',
    )
  })

  test('income has neither — nothing funds income, and it pays nothing off', async () => {
    setFixtures(READY)
    renderScreen(<TransactionForm onDone={() => {}} />)

    await userEvent.click(screen.getByRole('tab', { name: 'Income' }))

    expect(
      screen.queryByRole('button', { name: 'Pay from a fund' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Pay a loan' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Salary/ })).toBeChecked()
  })

  test('a transfer swaps its category for two ends', async () => {
    setFixtures(READY)
    renderScreen(<TransactionForm onDone={() => {}} />)

    await userEvent.click(screen.getByRole('tab', { name: 'Transfer' }))

    expect(
      screen.queryByRole('radiogroup', { name: 'Category' }),
    ).not.toBeInTheDocument()
    // Two filled blocks and a swap between them: on a transfer these ARE the
    // transaction, so they lead rather than sitting among the fields.
    expect(screen.getByRole('button', { name: 'From' })).toHaveTextContent(
      "Month's income",
    )
    expect(screen.getByRole('button', { name: 'Into' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Swap from and into' }),
    ).toBeInTheDocument()
  })

  test('the options escape the card that would have clipped them', async () => {
    setFixtures(READY)
    const { container } = renderScreen(<TransactionForm onDone={() => {}} />)

    await userEvent.click(screen.getByRole('button', { name: 'Tags' }))
    const panel = screen.getByRole('dialog', { name: 'Tags' })

    // Rendered to the body, not inside the form. Every card this sits in
    // clips — rounded corners, a scrolling modal — and an absolutely
    // positioned child of one is cut off at its edge.
    expect(container.contains(panel)).toBe(false)
    expect(document.body.contains(panel)).toBe(true)
  })

  test('a category is one tap, right on the card', async () => {
    setFixtures(READY)
    renderScreen(<TransactionForm onDone={() => {}} />)

    // An expense is offered expense categories only — Salary is not among them.
    expect(
      screen.queryByRole('radio', { name: /Salary/ }),
    ).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('radio', { name: /Takeout/ }))

    expect(screen.getByRole('radio', { name: /Takeout/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Grocery/ })).not.toBeChecked()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('the ones you use most come first, and that is the default', () => {
    setFixtures({ ...READY, 'categories:usage': { c3: 12, c1: 2 } })
    renderScreen(<TransactionForm onDone={() => {}} />)

    const names = screen
      .getAllByRole('radio')
      .map((r) => r.textContent?.replace(/·.*/, '').trim())
    expect(names).toEqual(['Takeout', 'Grocery'])
    expect(screen.getByRole('radio', { name: /Takeout/ })).toBeChecked()
  })
})

/** Render the add form and wait for the amount to take its focus — which it
 *  does a frame after mounting, and would otherwise do halfway through
 *  whatever the test was typing or clicking. */
async function openAdd() {
  renderScreen(<TransactionForm onDone={() => {}} />)
  await waitFor(() => expect(screen.getByLabelText('Amount')).toHaveFocus())
}

const nameIt = (text: string) =>
  userEvent.type(screen.getByLabelText('Name'), text)

/**
 * What a payee was filed under last time is what it is filed under now —
 * until you say otherwise.
 */
describe('guessing the category', () => {
  test('a payee seen before brings its category with it', async () => {
    setFixtures({ ...READY, 'transactions:categoryFor': 'c3' })
    await openAdd()

    expect(screen.getByRole('radio', { name: /Grocery/ })).toBeChecked()
    await nameIt('Wolt')
    expect(screen.getByRole('radio', { name: /Takeout/ })).toBeChecked()
  })

  test('a category you picked is never guessed over', async () => {
    setFixtures({ ...READY, 'transactions:categoryFor': 'c3' })
    await openAdd()

    await userEvent.click(screen.getByRole('radio', { name: /Grocery/ }))
    await nameIt('Wolt')
    expect(screen.getByRole('radio', { name: /Grocery/ })).toBeChecked()
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
        tags: [],
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
 * A long list of categories. Every one is reachable without a popover or a
 * search: the eight you use most up front, the rest one tap further.
 */
describe('a long list of categories', () => {
  const MANY = [
    ...CATEGORIES,
    ...[
      'Štednja',
      'Kućni računi',
      'Fitness',
      'Travel',
      'Pets',
      'Health',
      'Fuel',
    ].map((name, i) => ({
      _id: `m${i}`,
      name,
      kind: 'discretionary',
      icon: 'star',
      color: '#78716C',
    })),
  ]

  test('eight are offered, and the rest are one tap further', async () => {
    setFixtures({ ...READY, 'categories:list': MANY })
    renderScreen(<TransactionForm onDone={() => {}} />)

    expect(screen.getAllByRole('radio')).toHaveLength(8)
    await userEvent.click(screen.getByRole('button', { name: '1 more' }))
    expect(screen.getAllByRole('radio')).toHaveLength(9)
    expect(screen.getByRole('radio', { name: /Fuel/ })).toBeInTheDocument()
  })

  test('the chosen one is shown even when it is not among the eight', async () => {
    setFixtures({
      ...READY,
      'categories:list': MANY,
      'transactions:categoryFor': 'm6', // Fuel, the ninth
    })
    await openAdd()
    await nameIt('NIS')

    // A guess you cannot see is a guess you cannot check.
    expect(screen.getAllByRole('radio')).toHaveLength(9)
    expect(screen.getByRole('radio', { name: /Fuel/ })).toBeChecked()
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
    tags: [],
  }

  test('it prefills the copy but dates it today, and offers no Delete', async () => {
    setFixtures({ ...READY, 'transactions:detail': DETAIL })
    renderScreen(<TransactionForm copyOf={'t1' as never} onDone={() => {}} />)

    // Grouped, as the field now shows every amount.
    expect(await screen.findByLabelText('Amount')).toHaveValue('2.500')
    expect(screen.getByRole('radio', { name: /Grocery/ })).toBeChecked()
    expect(screen.getByDisplayValue('Idea')).toBeInTheDocument()

    // A copy is a new transaction: there is nothing yet to delete or duplicate.
    expect(
      screen.queryByRole('button', { name: /delete/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /duplicate/i }),
    ).not.toBeInTheDocument()

    // And it is not wearing January.
    expect(screen.queryByText(/2026-01-15/)).not.toBeInTheDocument()
  })

  test('editing the same transaction keeps its own date and can duplicate', async () => {
    setFixtures({ ...READY, 'transactions:detail': DETAIL })
    renderScreen(
      <TransactionForm transactionId={'t1' as never} onDone={() => {}} />,
    )

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
    expect(
      screen.getByRole('button', { name: 'Scan a QR code' }),
    ).toBeInTheDocument()
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
        tags: [],
      },
    })
    renderScreen(
      <TransactionForm transactionId={'t1' as never} onDone={() => {}} />,
    )
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

/**
 * Save is dead until something really changed — which means the change check
 * has to know about every editable field. Merchant was added to the form and
 * not to the check, and editing it alone left Save disabled: the form insisted
 * nothing had happened while you were looking at what you had just typed.
 */
describe('what counts as a change', () => {
  const DETAIL = {
    _id: 't1',
    direction: 'expense',
    amount: 1_000_00,
    categoryId: 'c1',
    occurredOn: '2026-01-15',
    payee: 'Idea',
    note: '',
    accountId: 'a1',
    funding: [{ potId: undefined, amount: 1_000_00 }],
    tags: [],
  }

  const open = async () => {
    setFixtures({ ...READY, 'transactions:detail': DETAIL })
    renderScreen(
      <TransactionForm transactionId={'t1' as never} onDone={() => {}} />,
    )
    await screen.findByRole('button', { name: /delete/i })
    return screen.getByRole('button', { name: /^save$/i })
  }

  test('an untouched form cannot be saved', async () => {
    expect(await open()).toBeDisabled()
  })

  test('typing a payee is a change', async () => {
    const save = await open()
    await userEvent.type(screen.getByLabelText('Name'), ' more')
    expect(save).toBeEnabled()
  })
})

describe('swapping a transfer around', () => {
  test('the arrows exchange the two ends', async () => {
    setFixtures(READY)
    renderScreen(<TransactionForm onDone={() => {}} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Transfer' }))

    // Setting money aside: out of the month, into a fund.
    await userEvent.click(screen.getByRole('button', { name: 'Into' }))
    await userEvent.click(screen.getByRole('button', { name: 'Rainy day' }))
    expect(screen.getByRole('button', { name: 'From' })).toHaveTextContent(
      "Month's income",
    )
    expect(screen.getByRole('button', { name: 'Into' })).toHaveTextContent(
      'Rainy day',
    )

    // Swapped, it is the same move read backwards: taking it back out.
    await userEvent.click(
      screen.getByRole('button', { name: 'Swap from and into' }),
    )
    expect(screen.getByRole('button', { name: 'From' })).toHaveTextContent(
      'Rainy day',
    )
    expect(screen.getByRole('button', { name: 'Into' })).toHaveTextContent(
      "Month's income",
    )
  })
})
