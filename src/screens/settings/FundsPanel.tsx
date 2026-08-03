import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useHousehold } from '../../household/HouseholdContext'
import { formatMoney, formatPercent } from '../../lib/format'
import { CategoryIcon } from '../../ui/icons'
import {
  ArchivedList,
  Card,
  ColorPicker,
  ConfirmButton,
  Empty,
  Field,
  GhostButton,
  IconPicker,
  Loading,
  MoneyInput,
  Note,
  Panel,
  PrimaryButton,
  TextInput,
} from './kit'

/**
 * Funds are the savings and sinking pots — virtual partitions of the one bank
 * balance, never separate money. Loans live in their own panel: a debt pot is
 * the same table but the opposite sign of the same idea, and mixing them here
 * would invite adding them together.
 *
 * A fund is archived, never deleted, because its transfers are real history.
 */
export function FundsPanel({ editId }: { editId?: string }) {
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
  const archived = allPots.filter((p) => p.isArchived && p.kind !== 'debt')
  const funds = pots.filter((p) => p.kind !== 'debt')
  const total = funds.reduce((s, f) => s + f.balance, 0)

  return (
    <Panel
      description="Money with a job. Setting money aside reduces what is left to spend, the same as spending it."
    >
      {funds.length === 0 ? (
        <Empty>No funds yet. A fund is where you park money for later.</Empty>
      ) : (
        <Card>
          <div className="flex items-baseline justify-between border-b border-stone-100 px-4 py-3">
            <span className="text-sm text-stone-500">Set aside in total</span>
            <span data-money className="font-semibold text-gain">
              {formatMoney(total)}
            </span>
          </div>
          <ul>
            {funds.map((f) => (
              <li key={f._id} className="border-b border-stone-100 last:border-b-0">
                {editing === f._id ? (
                  <PotForm
                    initial={{
                      ...f,
                      targetAmount: f.targetAmount ?? undefined,
                    }}
                    onCancel={() => setEditing(null)}
                    onSave={async (values) => {
                      await update({ potId: f._id, ...values })
                      setEditing(null)
                    }}
                  />
                ) : (
                  <FundRow
                    fund={f}
                    onEdit={() => setEditing(f._id)}
                    onArchive={() => archive({ potId: f._id })}
                  />
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {adding ? (
        <Card>
          <PotForm
            onCancel={() => setAdding(false)}
            onSave={async (values) => {
              await create({ householdId, kind: 'sinking', ...values })
              setAdding(false)
            }}
          />
        </Card>
      ) : (
        <PrimaryButton onClick={() => setAdding(true)}>Add a fund</PrimaryButton>
      )}

      <ArchivedList
        items={archived.map((p) => ({ id: p._id, name: p.name }))}
        onRestore={(id) => unarchive({ potId: id as Id<'pots'> })}
        onDelete={(id) => remove({ potId: id as Id<'pots'> })}
      />

      <Note>
        Archiving a fund hides it from the app but keeps every transfer into it,
        so past months still add up.
      </Note>
    </Panel>
  )
}

type Fund = {
  _id: Id<'pots'>
  name: string
  icon: string
  color: string
  balance: number
  targetAmount: number | null
}

function FundRow({
  fund,
  onEdit,
  onArchive,
}: {
  fund: Fund
  onEdit: () => void
  onArchive: () => void
}) {
  const target = fund.targetAmount ?? 0
  const share = target > 0 ? Math.min(fund.balance / target, 1) : null

  return (
    <div className="p-4">
      <div className="flex items-center gap-3">
        <CategoryIcon icon={fund.icon} color={fund.color} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {fund.name}
        </span>
        <span data-money className="text-sm font-semibold">
          {formatMoney(fund.balance)}
        </span>
      </div>

      {share !== null && (
        <div className="mt-2 pl-8">
          <div className="h-1.5 overflow-hidden rounded-full bg-stone-100">
            <div
              className="h-full bg-saved"
              style={{ width: `${share * 100}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-stone-400">
            {formatPercent(share)} of {formatMoney(target)}
          </p>
        </div>
      )}
      <div className="mt-2 flex items-center gap-2 pl-8">
        <GhostButton onClick={onEdit}>Edit</GhostButton>
        <ConfirmButton
          label="Archive"
          confirmLabel="Yes, archive it"
          onConfirm={onArchive}
        />
      </div>
    </div>
  )
}

type PotValues = {
  name: string
  icon: string
  color: string
  targetAmount?: number
}

function PotForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Partial<PotValues>
  onSave: (values: PotValues) => Promise<unknown>
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [icon, setIcon] = useState(initial?.icon ?? 'piggy')
  const [color, setColor] = useState(initial?.color ?? '#1D9E75')
  const [target, setTarget] = useState(initial?.targetAmount ?? 0)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      await onSave({
        name: name.trim(),
        icon,
        color,
        targetAmount: target > 0 ? target : undefined,
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
          placeholder="Car fund"
        />
      </Field>
      <div className="flex gap-3">
        <Field label="Icon">
          <IconPicker value={icon} onChange={setIcon} />
        </Field>
        <Field label="Colour">
          <ColorPicker value={color} onChange={setColor} />
        </Field>
      </div>
      <Field
        label="Target"
        hint="Optional. A target is something to aim at, not a budget — nothing is enforced."
      >
        <MoneyInput para={target} onChange={setTarget} />
      </Field>
      <div className="flex gap-2">
        <PrimaryButton onClick={save} disabled={!name.trim() || busy}>
          {busy ? 'Saving…' : 'Save'}
        </PrimaryButton>
        <GhostButton onClick={onCancel}>Cancel</GhostButton>
      </div>
    </div>
  )
}
