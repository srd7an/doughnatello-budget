import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { useHousehold } from '../household/HouseholdContext'
import {
  formatMoney,
  inputToPara,
  paraToInput,
  sanitizeMoneyInput,
} from '../lib/format'
import { Button } from '../ui/Button'
import { CategoryIcon, RepeatIcon } from '../ui/icons'
import { localISO } from '../lib/dates'
import { dueLabel } from '../lib/recurrence'

/**
 * Money that has come due but is not real yet.
 *
 * It sits above the month's figures rather than inside them, because a pending
 * occurrence is deliberately NOT counted anywhere — not in expense, not in left
 * to spend. Confirming is what makes it money; until then it is a question.
 *
 * Rendered only on the current month: a due item is about now, not about
 * whichever month you happen to be reading.
 */
export function DueSoon() {
  const { household } = useHousehold()
  const today = localISO(new Date())

  const due = useQuery(api.recurring.listDue, { householdId: household._id })
  const confirm = useMutation(api.recurring.confirm)
  const skip = useMutation(api.recurring.skip)

  if (!due || due.length === 0) return null

  const total = due.reduce((sum, d) => sum + d.amount, 0)

  return (
    <section className="rounded-2xl border border-stone-200 bg-white">
      <div className="flex items-baseline justify-between px-4 pt-3.5 pb-2">
        <h2 className="text-sm font-semibold">
          Due{' '}
          <span className="font-normal text-stone-400">
            {due.length} {due.length === 1 ? 'item' : 'items'}
          </span>
        </h2>
        <span data-money className="text-sm text-stone-500">
          {formatMoney(total)}
        </span>
      </div>

      <ul>
        {due.map((d) => (
          <DueRow
            key={d._id}
            item={d}
            today={today}
            onConfirm={(amount) => confirm({ occurrenceId: d._id, amount })}
            onSkip={() => skip({ occurrenceId: d._id })}
          />
        ))}
      </ul>
    </section>
  )
}

type DueItem = {
  _id: Id<'recurringOccurrences'>
  dueOn: string
  direction: 'income' | 'expense' | 'transfer'
  amount: number
  amountMode: 'exact' | 'estimate'
  payee: string | null
  category: { name: string; icon: string; color: string } | null
  pot: { name: string; icon: string; color: string } | null
}

function DueRow({
  item,
  today,
  onConfirm,
  onSkip,
}: {
  item: DueItem
  today: string
  onConfirm: (amount?: number) => Promise<unknown>
  onSkip: () => Promise<unknown>
}) {
  // An estimate opens with the amount editable — the whole reason it is an
  // estimate is that the real figure arrives with the bill.
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(paraToInput(item.amount))
  const [busy, setBusy] = useState(false)

  const label = item.payee ?? item.category?.name ?? item.pot?.name ?? 'Repeating'
  const icon = item.category?.icon ?? item.pot?.icon
  const late = item.dueOn < today

  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  const confirmAmount = editing ? inputToPara(draft) : undefined
  const canConfirm = !editing || inputToPara(draft) > 0

  return (
    <li className="border-t border-stone-100 px-4 py-3">
      <div className="flex items-center gap-3">
        {icon ? <CategoryIcon icon={icon} /> : <RepeatIcon size={20} aria-hidden />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{label}</p>
          <p className={`text-xs ${late ? 'text-debt' : 'text-stone-400'}`}>
            {dueLabel(item.dueOn, today)}
            {item.amountMode === 'estimate' && ' · estimate'}
          </p>
        </div>

        {editing ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              inputMode="decimal"
              value={draft}
              onChange={(e) => setDraft(sanitizeMoneyInput(e.target.value))}
              aria-label={`Amount for ${label}`}
              className="tnum w-24 rounded-lg border border-stone-200 px-2 py-1.5 text-right text-sm outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-violet-200"
            />
            <span className="text-xs text-stone-400">RSD</span>
          </div>
        ) : (
          <button
            onClick={() => setEditing(true)}
            aria-label={`Change amount for ${label}`}
            className="tnum rounded-lg px-1.5 py-1 text-sm font-semibold hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            {formatMoney(item.amount)}
          </button>
        )}
      </div>

      <div className="mt-2 flex gap-2 pl-8">
        <Button
          variant="primary"
          onClick={() => run(() => onConfirm(confirmAmount))}
          disabled={busy || !canConfirm}
        >
          Confirm
        </Button>
        <Button variant="secondary" onClick={() => run(onSkip)} disabled={busy}>
          Skip
        </Button>
        {editing && (
          <Button
            variant="ghost"
            onClick={() => {
              setEditing(false)
              setDraft(paraToInput(item.amount))
            }}
          >
            Cancel
          </Button>
        )}
      </div>
    </li>
  )
}

export type UpcomingItem = {
  ruleId: Id<'recurringRules'>
  dueOn: string
  direction: 'income' | 'expense' | 'transfer'
  amount: number
  amountMode: 'exact' | 'estimate'
  autoPost: boolean
  payee: string | null
  category: { name: string; icon: string; color: string } | null
  pot: { name: string; icon: string; color: string } | null
}

/**
 * What the repeating rules will still ask for before the month is out.
 *
 * A list to read, not to act on: none of it is due, so there is nothing to
 * confirm. It is here because it is the other half of "what is this month
 * still promised to" — the Due block above answers for today and before, and
 * until this existed the rest of the answer was in Settings, one rule at a
 * time, with the arithmetic left to the reader.
 */
export function ComingUp({
  items,
  through,
}: {
  items: UpcomingItem[]
  /** YYYY-MM-DD — the last day the list runs to. */
  through: string
}) {
  const today = localISO(new Date())
  if (items.length === 0) return null
  const [, m, d] = through.split('-').map(Number)
  const until = new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'long',
  }).format(new Date(2000, m - 1, d))

  return (
    <section className="rounded-2xl border border-stone-200 bg-white">
      <h2 className="px-4 pt-3.5 pb-2 text-sm font-semibold">
        Coming up{' '}
        <span className="font-normal text-stone-400">by {until}</span>
      </h2>
      <ul>
        {items.map((it) => {
          const label =
            it.payee ?? it.category?.name ?? it.pot?.name ?? 'Repeating'
          const icon = it.category?.icon ?? it.pot?.icon
          return (
            <li
              key={`${it.ruleId}-${it.dueOn}`}
              className="flex items-center gap-3 border-t border-stone-100 px-4 py-2.5"
            >
              {icon ? (
                <CategoryIcon icon={icon} />
              ) : (
                <RepeatIcon size={20} aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{label}</p>
                <p className="text-xs text-stone-400">
                  {dueLabel(it.dueOn, today)}
                  {it.amountMode === 'estimate' && ' · estimate'}
                  {it.autoPost && ' · posts itself'}
                </p>
              </div>
              <span
                data-money
                className={`text-sm ${it.direction === 'income' ? 'text-gain' : 'text-stone-800'}`}
              >
                {formatMoney(it.amount, { signed: it.direction === 'income' })}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
