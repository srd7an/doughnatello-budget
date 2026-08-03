import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useHousehold } from '../../household/HouseholdContext'
import { formatMoney, formatPercent } from '../../lib/format'
import {
  ArchivedList,
  ConfirmButton,
  EditRow,
  Empty,
  Field,
  FormActions,
  IconPicker,
  ItemRow,
  ListHeader,
  Loading,
  MoneyInput,
  Note,
  Panel,
  PrimaryButton,
  Rows,
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
export function LoansPanel({ editId }: { editId?: string }) {
  const { household } = useHousehold()
  const householdId = household._id

  const pots = useQuery(api.pots.balances, { householdId })
  const allPots = useQuery(api.pots.list, { householdId, includeArchived: true })
  const create = useMutation(api.pots.create)
  const update = useMutation(api.pots.update)
  const archive = useMutation(api.pots.archive)
  const remove = useMutation(api.pots.remove)
  const unarchive = useMutation(api.pots.unarchive)

  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Id<'pots'> | null>(
    (editId as Id<'pots'>) ?? null,
  )

  if (pots === undefined || allPots === undefined) return <Loading />
  const archived = allPots.filter((p) => p.isArchived && p.kind === 'debt')
  const loans = pots.filter((p) => p.kind === 'debt')
  const owedTotal = loans.reduce((s, l) => s + (l.owed ?? 0), 0)

  return (
    <Panel
      description="What you owe. Paying a loan is an ordinary expense tagged with the loan — record it from Add transaction."
    >
      {loans.length === 0 ? (
        <Empty>No loans. Long may it last.</Empty>
      ) : (
        <div>
          <ListHeader
            label="Still owed"
            figure={formatMoney(owedTotal)}
            figureClass="text-debt"
          />
          <Rows>
            {loans.map((l) =>
              editing === l._id ? (
                <EditRow key={l._id}>
                  <LoanForm
                    initial={{
                      name: l.name,
                      icon: l.icon,
                      originalAmount: l.originalAmount ?? 0,
                      interestRate: l.interestRate ?? 0,
                      minimumPayment: l.minimumPayment ?? 0,
                    }}
                    onCancel={() => setEditing(null)}
                    onSave={async (values) => {
                      await update({ potId: l._id, ...values })
                      setEditing(null)
                    }}
                    onArchive={async () => {
                      await archive({ potId: l._id })
                      setEditing(null)
                    }}
                  />
                </EditRow>
              ) : (
                <LoanRow key={l._id} loan={l} onEdit={() => setEditing(l._id)} />
              ),
            )}
          </Rows>
        </div>
      )}

      {adding ? (
        <LoanForm
          onCancel={() => setAdding(false)}
          onSave={async (values) => {
            await create({
              householdId,
              kind: 'debt',
              color: '#D85A30',
              ...values,
            })
            setAdding(false)
          }}
        />
      ) : (
        <PrimaryButton onClick={() => setAdding(true)}>Add a loan</PrimaryButton>
      )}

      <ArchivedList
        items={archived.map((p) => ({ id: p._id, name: p.name }))}
        onRestore={(id) => unarchive({ potId: id as Id<'pots'> })}
        onDelete={(id) => remove({ potId: id as Id<'pots'> })}
      />

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

function LoanRow({ loan, onEdit }: { loan: Loan; onEdit: () => void }) {
  const original = loan.originalAmount ?? 0
  const owed = loan.owed ?? 0
  const paidShare = original > 0 ? Math.min((original - owed) / original, 1) : null

  // How far through it you are, as a sentence on the row rather than a bar
  // under it. The bar cost a fund or a loan three lines of height each, which
  // on a phone meant two of them filled the screen.
  const meta = paidShare !== null
    ? [
        `${formatPercent(paidShare)} paid off of ${formatMoney(original)}`,
        loan.interestRate ? `${loan.interestRate}%` : null,
        loan.minimumPayment ? `${formatMoney(loan.minimumPayment)} minimum` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : undefined

  return (
    <ItemRow
      icon={loan.icon}
      name={loan.name}
      meta={meta}
      figure={formatMoney(owed)}
      figureClass="text-debt"
      onClick={onEdit}
    />
  )
}

type LoanValues = {
  name: string
  icon: string
  originalAmount: number
  interestRate?: number
  minimumPayment?: number
}

/** A loan is money from an institution until you say otherwise. */
const DEFAULT_LOAN_ICON = 'bank'

function LoanForm({
  initial,
  onSave,
  onCancel,
  onArchive,
}: {
  initial?: LoanValues
  onSave: (values: LoanValues) => Promise<unknown>
  onCancel: () => void
  /** Only when editing. */
  onArchive?: () => Promise<unknown>
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [icon, setIcon] = useState(initial?.icon ?? DEFAULT_LOAN_ICON)
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
        icon,
        originalAmount: original,
        interestRate: rate ? Number(rate) : undefined,
        minimumPayment: minimum > 0 ? minimum : undefined,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 px-3 py-2">
      <div className="flex gap-3">
        <Field label="Name" className="flex-1">
          <TextInput
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Car loan"
          />
        </Field>
        <Field label="Icon">
          <IconPicker value={icon} onChange={setIcon} />
        </Field>
      </div>
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
      <FormActions
        onSave={save}
        onCancel={onCancel}
        busy={busy}
        disabled={!name.trim() || original <= 0}
        destructive={
          onArchive && (
            <ConfirmButton
              label="Archive"
              confirmLabel="Yes, archive it"
              onConfirm={onArchive}
            />
          )
        }
      />
    </div>
  )
}
