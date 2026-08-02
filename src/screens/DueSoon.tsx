import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { useHousehold } from '../household/HouseholdContext'
import { formatMoney, toPara } from '../lib/format'
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
  const [draft, setDraft] = useState(String(Math.round(item.amount / 100)))
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

  const confirmAmount = editing ? toPara(Number(draft || '0')) : undefined
  const canConfirm = !editing || Number(draft || '0') > 0

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
              inputMode="numeric"
              value={draft}
              onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ''))}
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
        <button
          onClick={() => run(() => onConfirm(confirmAmount))}
          disabled={busy || !canConfirm}
          className="min-h-9 rounded-full bg-brand px-4 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-40"
        >
          Confirm
        </button>
        <button
          onClick={() => run(onSkip)}
          disabled={busy}
          className="min-h-9 rounded-full border border-stone-200 px-4 text-sm text-stone-600 hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-40"
        >
          Skip
        </button>
        {editing && (
          <button
            onClick={() => {
              setEditing(false)
              setDraft(String(Math.round(item.amount / 100)))
            }}
            className="min-h-9 px-2 text-sm text-stone-500 hover:text-stone-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            Cancel
          </button>
        )}
      </div>
    </li>
  )
}
