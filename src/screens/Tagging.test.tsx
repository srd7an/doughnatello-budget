import { describe, expect, test, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderScreen, setFixtures, setMutations } from '../test/render'
import { TransactionForm } from '../app/TransactionForm'
import { TransactionsList } from './TransactionsList'

/**
 * Tagging, from both ends: one transaction at a time in the form, and forty at
 * a time in the list — which is the way a holiday that already happened gets
 * labelled, and the reason the bulk path exists at all.
 */

const TAGS = [
  {
    _id: 't-greece',
    name: 'Grčka 2026',
    color: '#14B8A6',
    icon: 'palm',
    count: 6,
  },
  {
    _id: 't-wedding',
    name: 'Svadba',
    color: '#E11D48',
    icon: 'heart',
    count: 2,
  },
]

const FORM_READY = {
  'categories:list': [
    {
      _id: 'c1',
      name: 'Grocery',
      kind: 'committed',
      icon: 'basket',
      color: '#E8632A',
    },
  ],
  'pots:balances': [],
  'accounts:list': [{ _id: 'a1', name: 'Main', isPrimary: true }],
  'tags:list': TAGS,
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'x1',
    direction: 'expense',
    amount: 2_000_00,
    occurredOn: '2026-07-10',
    payee: 'Taverna',
    note: null,
    categoryId: 'c1',
    potId: null,
    fromPotId: null,
    fundedFromPotId: null,
    category: {
      name: 'Grocery',
      icon: 'basket',
      color: '#E8632A',
      kind: 'committed',
    },
    pot: null,
    fundedFromPot: null,
    fromPot: null,
    paidByName: 'Me',
    tags: [],
    ...overrides,
  }
}

describe('tagging one transaction', () => {
  test('the row is an invitation until something is chosen', async () => {
    setFixtures(FORM_READY)
    renderScreen(<TransactionForm onDone={() => {}} />)

    // The row IS the trigger, so its accessible name is the field's; what it
    // SAYS is the invitation.
    const row = screen.getByRole('button', { name: 'Tags' })
    expect(row).toHaveTextContent('Add a tag')

    await userEvent.click(row)
    await userEvent.click(screen.getByRole('button', { name: /Grčka 2026/ }))

    // The invitation has become an ordinary row wearing what it holds.
    const after = screen.getByRole('button', { name: 'Tags' })
    expect(after).not.toHaveTextContent('Add a tag')
    expect(after).toHaveTextContent('Grčka 2026')
  })

  test('the picker stays open, because tagging is plural', async () => {
    setFixtures(FORM_READY)
    renderScreen(<TransactionForm onDone={() => {}} />)

    await userEvent.click(screen.getByRole('button', { name: 'Tags' }))
    await userEvent.click(screen.getByRole('button', { name: /Grčka 2026/ }))
    // Still listed, so the second tag costs no second opening.
    await userEvent.click(screen.getByRole('button', { name: /Svadba/ }))

    expect(screen.getByRole('button', { name: 'Tags' })).toHaveTextContent(
      'Svadba',
    )
  })

  test('typing a name that is not there offers to make it', async () => {
    setFixtures(FORM_READY)
    const create = vi.fn(async () => 't-new')
    setMutations({ 'tags:create': create })
    renderScreen(<TransactionForm onDone={() => {}} />)

    await userEvent.click(screen.getByRole('button', { name: 'Tags' }))
    await userEvent.type(
      screen.getByRole('searchbox', { name: /Search or name a tag/i }),
      'Krf 2027',
    )
    await userEvent.click(screen.getByRole('button', { name: /Make/ }))

    expect(create).toHaveBeenCalledWith({ householdId: 'h1', name: 'Krf 2027' })
  })

  test('an existing name is a search, not a second tag', async () => {
    setFixtures(FORM_READY)
    renderScreen(<TransactionForm onDone={() => {}} />)

    await userEvent.click(screen.getByRole('button', { name: 'Tags' }))
    // Folded, so the English keyboard finds the Serbian name.
    await userEvent.type(
      screen.getByRole('searchbox', { name: /Search or name a tag/i }),
      'grcka 2026',
    )

    expect(
      screen.getByRole('button', { name: /Grčka 2026/ }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Make/ }),
    ).not.toBeInTheDocument()
  })

  test('saving sends the tags with the transaction', async () => {
    setFixtures(FORM_READY)
    const create = vi.fn(async () => 'new-tx')
    setMutations({ 'transactions:create': create })
    renderScreen(<TransactionForm onDone={() => {}} />)

    await userEvent.type(screen.getByLabelText('Amount'), '2000')
    await userEvent.click(screen.getByRole('button', { name: 'Tags' }))
    await userEvent.click(screen.getByRole('button', { name: /Grčka 2026/ }))
    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }))

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ tagIds: ['t-greece'] }),
    )
  })
})

describe('tagging a month at a time', () => {
  test('a tagged row wears its tag, and the extras are counted', () => {
    setFixtures({
      'transactions:listMonth': [
        row({ _id: 'x1', tags: [TAGS[0], TAGS[1]] }),
        row({ _id: 'x2', tags: [] }),
      ],
      'tags:list': TAGS,
    })
    renderScreen(<TransactionsList />)

    expect(screen.getByText('Grčka 2026')).toBeInTheDocument()
    // The second is a count, not a second chip — a row is one line.
    expect(screen.getByText('+1')).toBeInTheDocument()
  })

  test('selecting rows and tagging them sends one batch', async () => {
    setFixtures({
      'transactions:listMonth': [row({ _id: 'x1' }), row({ _id: 'x2' })],
      'tags:list': TAGS,
    })
    const apply = vi.fn(async () => ({ changed: 2 }))
    setMutations({ 'tags:applyToMany': apply })
    renderScreen(<TransactionsList />)

    await userEvent.click(screen.getByRole('button', { name: /Tag several/ }))
    await userEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(screen.getByText('2 selected')).toBeInTheDocument()

    await userEvent.click(
      screen.getByRole('button', { name: 'Tag the selected transactions' }),
    )
    // Scoped to the panel: the rows behind it wear the same name on a chip.
    const panel = screen.getByRole('dialog')
    await userEvent.click(
      within(panel).getByRole('button', { name: /Grčka 2026/ }),
    )

    expect(apply).toHaveBeenCalledWith({
      tagId: 't-greece',
      transactionIds: ['x1', 'x2'],
      on: true,
    })
  })

  test('a tag every picked row already has comes OFF instead', async () => {
    setFixtures({
      'transactions:listMonth': [
        row({ _id: 'x1', tags: [TAGS[0]] }),
        row({ _id: 'x2', tags: [TAGS[0]] }),
      ],
      'tags:list': TAGS,
    })
    const apply = vi.fn(async () => ({ changed: 2 }))
    setMutations({ 'tags:applyToMany': apply })
    renderScreen(<TransactionsList />)

    await userEvent.click(screen.getByRole('button', { name: /Tag several/ }))
    await userEvent.click(screen.getByRole('button', { name: 'All' }))
    await userEvent.click(
      screen.getByRole('button', { name: 'Tag the selected transactions' }),
    )
    const panel = screen.getByRole('dialog')
    await userEvent.click(
      within(panel).getByRole('button', { name: /Grčka 2026/ }),
    )

    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ on: false, tagId: 't-greece' }),
    )
  })

  test('while picking, a row is a checkbox rather than a door', async () => {
    setFixtures({
      'transactions:listMonth': [row({ _id: 'x1' })],
      'tags:list': TAGS,
    })
    renderScreen(<TransactionsList />)

    const list = screen.getByRole('list')
    const rowButton = within(list).getAllByRole('button')[0]
    // Not a checkbox yet — a tap here opens the transaction.
    expect(rowButton).not.toHaveAttribute('aria-pressed')

    await userEvent.click(screen.getByRole('button', { name: /Tag several/ }))
    await userEvent.click(
      within(screen.getByRole('list')).getAllByRole('button')[0],
    )

    expect(screen.getByText('1 selected')).toBeInTheDocument()
  })
})
