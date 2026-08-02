import { useEffect, useState } from 'react'
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
import { dayLabel } from '../lib/dates'
import { Modal } from '../ui/Modal'
import { CategoryIcon } from '../ui/icons'
import { ConfirmButton, GhostButton, PrimaryButton, inputClass } from './settings/kit'

/**
 * One transaction, opened from the list.
 *
 * Reading and editing are the same view rather than two: there is little here
 * to read, and the thing you want after looking at a transaction is almost
 * always to correct it. The one part that is read-only is how it was funded —
 * that is derived from the amount and the fund, not typed.
 */
export function TransactionDetail({
  transactionId,
  onClose,
}: {
  transactionId: Id<'transactions'> | null
  onClose: () => void
}) {
  const { household } = useHousehold()
  const householdId = household._id

  const detail = useQuery(
    api.transactions.detail,
    transactionId ? { transactionId } : 'skip',
  )
  const categories = useQuery(api.categories.list, { householdId }) ?? []
  const pots = useQuery(api.pots.balances, { householdId }) ?? []
  const update = useMutation(api.transactions.update)
  const remove = useMutation(api.transactions.remove)

  const [amount, setAmount] = useState('')
  const [occurredOn, setOccurredOn] = useState('')
  const [payee, setPayee] = useState('')
  const [note, setNote] = useState('')
  const [categoryId, setCategoryId] = useState<Id<'categories'> | ''>('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reload the form whenever a different transaction is opened.
  useEffect(() => {
    if (!detail) return
    setAmount(paraToInput(detail.amount))
    setOccurredOn(detail.occurredOn)
    setPayee(detail.payee ?? '')
    setNote(detail.note ?? '')
    setCategoryId(detail.categoryId ?? '')
    setError(null)
  }, [detail?._id])

  if (!transactionId) return null

  const relevantCategories = detail
    ? categories.filter((c) =>
        detail.direction === 'income' ? c.kind === 'income' : c.kind !== 'income',
      )
    : []

  const dirty =
    !!detail &&
    (inputToPara(amount) !== detail.amount ||
      occurredOn !== detail.occurredOn ||
      payee !== (detail.payee ?? '') ||
      note !== (detail.note ?? '') ||
      categoryId !== (detail.categoryId ?? ''))

  const save = async () => {
    if (!detail || !dirty || saving) return
    setSaving(true)
    setError(null)
    try {
      await update({
        transactionId: detail._id,
        amount: inputToPara(amount),
        occurredOn,
        payee: payee.trim() || undefined,
        note: note.trim() || undefined,
        categoryId:
          detail.direction === 'transfer'
            ? undefined
            : (categoryId as Id<'categories'>) || undefined,
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Transaction">
      {detail === undefined ? (
        <p className="py-8 text-center text-sm text-stone-400">Loading…</p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <CategoryIcon
              icon={detail.pot?.icon ?? detail.category?.icon}
              color={detail.pot?.color ?? detail.category?.color}
              size={24}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-stone-800">
                {detail.payee || detail.category?.name || detail.pot?.name || '—'}
              </p>
              <p className="text-xs text-stone-500">
                {dayLabel(detail.occurredOn)} · {detail.accountName} ·{' '}
                {detail.paidByName}
              </p>
            </div>
            <span
              data-money
              className={`text-lg ${detail.direction === 'income' ? 'text-gain' : 'text-stone-800'}`}
            >
              {detail.direction === 'expense' ? '−' : ''}
              {formatMoney(detail.amount)}
            </span>
          </div>

          {/* How it was funded — derived, so shown rather than edited. */}
          {detail.funding.length > 0 && (
            <div className="rounded-xl bg-stone-50 p-3">
              <p className="text-xs font-medium tracking-wide text-stone-400 uppercase">
                Paid from
              </p>
              <ul className="mt-1 space-y-0.5">
                {detail.funding.map((f, i) => (
                  <li
                    key={i}
                    className="tnum flex justify-between text-xs text-stone-600"
                  >
                    <span>{f.potName ?? 'This month'}</span>
                    <span>{formatMoney(f.amount)}</span>
                  </li>
                ))}
              </ul>
              {detail.funding.some((f) => f.potId) && (
                <p className="mt-1.5 text-xs text-stone-400">
                  Money taken from a fund does not reduce what is left to spend
                  — it was already set aside.
                </p>
              )}
            </div>
          )}

          <div className="flex gap-3">
            <label className="flex-1">
              <span className="mb-1 block text-xs font-medium tracking-wide text-stone-400 uppercase">
                Amount
              </span>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(sanitizeMoneyInput(e.target.value))}
                className={`${inputClass} tnum text-right`}
              />
            </label>
            <label className="flex-1">
              <span className="mb-1 block text-xs font-medium tracking-wide text-stone-400 uppercase">
                Date
              </span>
              <input
                type="date"
                value={occurredOn}
                onChange={(e) => setOccurredOn(e.target.value)}
                className={inputClass}
              />
            </label>
          </div>

          {detail.direction !== 'transfer' && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium tracking-wide text-stone-400 uppercase">
                Category
              </span>
              <select
                value={categoryId}
                onChange={(e) =>
                  setCategoryId(e.target.value as Id<'categories'> | '')
                }
                className={inputClass}
              >
                {relevantCategories.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {detail.direction === 'transfer' && detail.pot && (
            <p className="text-xs text-stone-500">
              Into <strong>{detail.pot.name}</strong>. Change the fund by
              deleting this and adding it again — moving it would rewrite two
              balances at once.
            </p>
          )}

          <div className="flex gap-3">
            <label className="flex-1">
              <span className="mb-1 block text-xs font-medium tracking-wide text-stone-400 uppercase">
                Payee
              </span>
              <input
                value={payee}
                onChange={(e) => setPayee(e.target.value)}
                placeholder="Optional"
                className={inputClass}
              />
            </label>
            <label className="flex-1">
              <span className="mb-1 block text-xs font-medium tracking-wide text-stone-400 uppercase">
                Note
              </span>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional"
                className={inputClass}
              />
            </label>
          </div>

          {error && <p className="text-sm text-debt">{error}</p>}

          <div className="flex items-center gap-2 border-t border-stone-100 pt-4">
            <PrimaryButton onClick={save} disabled={!dirty || saving}>
              {saving ? 'Saving…' : 'Save'}
            </PrimaryButton>
            <GhostButton onClick={onClose}>Cancel</GhostButton>
            <span className="ml-auto">
              <ConfirmButton
                label="Delete"
                confirmLabel="Delete it"
                onConfirm={async () => {
                  await remove({ transactionId: detail._id })
                  onClose()
                }}
              />
            </span>
          </div>

          {pots.length > 0 && detail.direction === 'expense' && (
            <p className="text-xs text-stone-400">
              To change which fund paid for this, delete it and add it again —
              the split is worked out when it is recorded.
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}
