import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useHousehold } from '../../household/HouseholdContext'
import { formatMoney, formatPercent } from '../../lib/format'
import { CategoryIcon } from '../../ui/icons'
import {
  Card,
  ConfirmButton,
  Empty,
  Field,
  GhostButton,
  Loading,
  MoneyInput,
  Note,
  Panel,
  PrimaryButton,
  TextInput,
} from './kit'

/**
 * Loans are debt pots. They share a table with funds but never a screen and
 * never a total: a fund is money you have, a loan is money you owe, and the
 * only thing worse than not knowing either is adding them together.
 *
 * Owed is derived, not stored: originalAmount − every expense tagged with this
 * loan. So you record a payment as an ordinary expense (which is what it is —
 * it leaves your account and reduces what is left to spend) and the balance
 * here follows.
 */
export function LoansPanel() {
  const { household } = useHousehold()
  const householdId = household._id

  const pots = useQuery(api.pots.balances, { householdId })
  const create = useMutation(api.pots.create)
  const update = useMutation(api.pots.update)
  const archive = useMutation(api.pots.archive)

  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Id<'pots'> | null>(null)

  if (pots === undefined) return <Loading />
  const loans = pots.filter((p) => p.kind === 'debt')
  const owedTotal = loans.reduce((s, l) => s + (l.owed ?? 0), 0)

  return (
    <Panel
      title="Loans"
      description="What you owe. Paying a loan is an ordinary expense tagged with the loan — record it from Add transaction."
    >
      {loans.length === 0 ? (
        <Empty>No loans. Long may it last.</Empty>
      ) : (
        <Card>
          <div className="flex items-baseline justify-between border-b border-stone-100 px-4 py-3">
            <span className="text-sm text-stone-500">Still owed</span>
            <span data-money className="font-semibold text-debt">
              {formatMoney(owedTotal)}
            </span>
          </div>
          <ul>
            {loans.map((l) => (
              <li key={l._id} className="border-b border-stone-100 last:border-b-0">
                {editing === l._id ? (
                  <LoanForm
                    initial={{
                      name: l.name,
                      originalAmount: l.originalAmount ?? 0,
                      interestRate: l.interestRate ?? 0,
                      minimumPayment: l.minimumPayment ?? 0,
                    }}
                    onCancel={() => setEditing(null)}
                    onSave={async (values) => {
                      await update({ potId: l._id, ...values })
                      setEditing(null)
                    }}
                  />
                ) : (
                  <LoanRow
                    loan={l}
                    onEdit={() => setEditing(l._id)}
                    onArchive={() => archive({ potId: l._id })}
                  />
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {adding ? (
        <Card>
          <LoanForm
            onCancel={() => setAdding(false)}
            onSave={async (values) => {
              await create({
                householdId,
                kind: 'debt',
                icon: 'bank',
                color: '#D85A30',
                ...values,
              })
              setAdding(false)
            }}
          />
        </Card>
      ) : (
        <PrimaryButton onClick={() => setAdding(true)}>Add a loan</PrimaryButton>
      )}

      <Note>
        A loan payment does not change your net worth — cash goes down and debt
        goes down by the same amount. That is why it is left out of the year's
        net-worth change.
      </Note>
    </Panel>
  )
}

type Loan = {
  _id: Id<'pots'>
  name: string
  icon: string
  owed: number | null
  originalAmount: number | null
  interestRate: number | null
  minimumPayment: number | null
}

function LoanRow({
  loan,
  onEdit,
  onArchive,
}: {
  loan: Loan
  onEdit: () => void
  onArchive: () => void
}) {
  const original = loan.originalAmount ?? 0
  const owed = loan.owed ?? 0
  const paidShare = original > 0 ? Math.min((original - owed) / original, 1) : null

  return (
    <div className="p-4">
      <div className="flex items-center gap-3">
        <CategoryIcon icon={loan.icon} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {loan.name}
        </span>
        <span data-money className="text-sm font-semibold text-debt">
          {formatMoney(owed)}
        </span>
      </div>

      {paidShare !== null && (
        <div className="mt-2 pl-8">
          <div className="h-1.5 overflow-hidden rounded-full bg-stone-100">
            <div
              className="h-full bg-saved"
              style={{ width: `${paidShare * 100}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-stone-400">
            {formatPercent(paidShare)} paid off of {formatMoney(original)}
            {loan.interestRate ? ` · ${loan.interestRate}%` : ''}
            {loan.minimumPayment
              ? ` · ${formatMoney(loan.minimumPayment)} minimum`
              : ''}
          </p>
        </div>
      )}

      <div className="mt-2 flex items-center gap-2 pl-8">
        <GhostButton onClick={onEdit}>Edit</GhostButton>
        <ConfirmButton
          label="Archive"
          confirmLabel="Archive it"
          onConfirm={onArchive}
        />
      </div>
    </div>
  )
}

type LoanValues = {
  name: string
  originalAmount: number
  interestRate?: number
  minimumPayment?: number
}

function LoanForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: LoanValues
  onSave: (values: LoanValues) => Promise<unknown>
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [original, setOriginal] = useState(initial?.originalAmount ?? 0)
  const [rate, setRate] = useState(String(initial?.interestRate ?? ''))
  const [minimum, setMinimum] = useState(initial?.minimumPayment ?? 0)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!name.trim() || original <= 0 || busy) return
    setBusy(true)
    try {
      await onSave({
        name: name.trim(),
        originalAmount: original,
        interestRate: rate ? Number(rate) : undefined,
        minimumPayment: minimum > 0 ? minimum : undefined,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 p-4">
      <Field label="Name">
        <TextInput
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Car loan"
        />
      </Field>
      <Field
        label="Amount borrowed"
        hint="The original sum. What is still owed is worked out from your payments."
      >
        <MoneyInput para={original} onChange={setOriginal} />
      </Field>
      <div className="flex gap-3">
        <Field label="Interest %" className="flex-1">
          <TextInput
            inputMode="decimal"
            value={rate}
            onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ''))}
            placeholder="Optional"
          />
        </Field>
        <Field label="Minimum payment" className="flex-1">
          <MoneyInput para={minimum} onChange={setMinimum} />
        </Field>
      </div>
      <div className="flex gap-2">
        <PrimaryButton
          onClick={save}
          disabled={!name.trim() || original <= 0 || busy}
        >
          {busy ? 'Saving…' : 'Save'}
        </PrimaryButton>
        <GhostButton onClick={onCancel}>Cancel</GhostButton>
      </div>
    </div>
  )
}
