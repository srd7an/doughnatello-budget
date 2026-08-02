import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useHousehold } from '../../household/HouseholdContext'
import { formatMoney } from '../../lib/format'
import { localISO } from '../../lib/dates'
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

/** A value older than this is probably fiction, so the panel says so. */
const STALE_DAYS = 365

/**
 * Assets are not funds. A car cannot be spent from — it only ever moves net
 * worth, never left-to-spend or set-aside.
 *
 * Every asset carries the date it was valued, because a number typed once and
 * never revisited quietly inflates net worth forever. Stale values are called
 * out rather than silently trusted.
 */
export function AssetsPanel() {
  const { household } = useHousehold()
  const householdId = household._id

  const assets = useQuery(api.assets.list, { householdId })
  const pots = useQuery(api.pots.balances, { householdId })
  const create = useMutation(api.assets.create)
  const update = useMutation(api.assets.update)
  const archive = useMutation(api.assets.archive)

  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Id<'assets'> | null>(null)

  if (assets === undefined || pots === undefined) return <Loading />

  const debts = pots.filter((p) => p.kind === 'debt')
  const total = assets.reduce((s, a) => s + a.value, 0)
  const today = localISO(new Date())

  return (
    <Panel
      description="Things you own that are worth something. They count toward net worth and nothing else."
    >
      {assets.length === 0 ? (
        <Empty>No assets yet — a flat, a car, anything worth recording.</Empty>
      ) : (
        <Card>
          <div className="flex items-baseline justify-between border-b border-stone-100 px-4 py-3">
            <span className="text-sm text-stone-500">Total value</span>
            <span data-money className="font-semibold">
              {formatMoney(total)}
            </span>
          </div>
          <ul>
            {assets.map((a) => (
              <li key={a._id} className="border-b border-stone-100 last:border-b-0">
                {editing === a._id ? (
                  <AssetForm
                    debts={debts}
                    initial={{
                      name: a.name,
                      value: a.value,
                      valuedOn: a.valuedOn,
                      linkedDebtPotId: a.linkedDebtPotId,
                    }}
                    onCancel={() => setEditing(null)}
                    onSave={async (values) => {
                      await update({ assetId: a._id, ...values })
                      setEditing(null)
                    }}
                  />
                ) : (
                  <AssetRow
                    asset={a}
                    today={today}
                    debtName={
                      debts.find((d) => d._id === a.linkedDebtPotId)?.name
                    }
                    onEdit={() => setEditing(a._id)}
                    onArchive={() => archive({ assetId: a._id })}
                  />
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {adding ? (
        <Card>
          <AssetForm
            debts={debts}
            onCancel={() => setAdding(false)}
            onSave={async (values) => {
              await create({ householdId, ...values })
              setAdding(false)
            }}
          />
        </Card>
      ) : (
        <PrimaryButton onClick={() => setAdding(true)}>
          Add an asset
        </PrimaryButton>
      )}

      <Note>
        Linking an asset to a loan records that the loan bought it. Both still
        count separately — the flat is worth what it is worth whether or not the
        mortgage is paid.
      </Note>
    </Panel>
  )
}

type Asset = {
  _id: Id<'assets'>
  name: string
  value: number
  valuedOn: string
  linkedDebtPotId?: Id<'pots'>
}

function AssetRow({
  asset,
  today,
  debtName,
  onEdit,
  onArchive,
}: {
  asset: Asset
  today: string
  debtName?: string
  onEdit: () => void
  onArchive: () => void
}) {
  const age = Math.round(
    (Date.parse(today) - Date.parse(asset.valuedOn)) / 86_400_000,
  )
  const stale = age > STALE_DAYS

  return (
    <div className="p-4">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {asset.name}
        </span>
        <span data-money className="text-sm font-semibold">
          {formatMoney(asset.value)}
        </span>
      </div>
      <p className={`mt-0.5 text-xs ${stale ? 'text-status-near' : 'text-stone-400'}`}>
        Valued {asset.valuedOn}
        {stale && ' · over a year ago, worth checking'}
        {debtName && ` · bought with ${debtName}`}
      </p>
      <div className="mt-2 flex items-center gap-2">
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

type AssetValues = {
  name: string
  value: number
  valuedOn: string
  linkedDebtPotId?: Id<'pots'>
}

function AssetForm({
  initial,
  debts,
  onSave,
  onCancel,
}: {
  initial?: AssetValues
  debts: { _id: Id<'pots'>; name: string }[]
  onSave: (values: AssetValues) => Promise<unknown>
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [value, setValue] = useState(initial?.value ?? 0)
  const [valuedOn, setValuedOn] = useState(
    initial?.valuedOn ?? localISO(new Date()),
  )
  const [debt, setDebt] = useState<Id<'pots'> | ''>(
    initial?.linkedDebtPotId ?? '',
  )
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!name.trim() || value <= 0 || busy) return
    setBusy(true)
    try {
      await onSave({
        name: name.trim(),
        value,
        valuedOn,
        linkedDebtPotId: debt || undefined,
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
          placeholder="Flat"
        />
      </Field>
      <div className="flex gap-3">
        <Field label="Value" className="flex-1">
          <MoneyInput para={value} onChange={setValue} />
        </Field>
        <Field label="Valued on" hint="Update this when you re-check.">
          <TextInput
            type="date"
            value={valuedOn}
            onChange={(e) => setValuedOn(e.target.value)}
          />
        </Field>
      </div>
      {debts.length > 0 && (
        <Field label="Bought with a loan">
          <select
            value={debt}
            onChange={(e) => setDebt(e.target.value as Id<'pots'> | '')}
            className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-violet-200"
          >
            <option value="">Not linked</option>
            {debts.map((d) => (
              <option key={d._id} value={d._id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="flex gap-2">
        <PrimaryButton onClick={save} disabled={!name.trim() || value <= 0 || busy}>
          {busy ? 'Saving…' : 'Save'}
        </PrimaryButton>
        <GhostButton onClick={onCancel}>Cancel</GhostButton>
      </div>
    </div>
  )
}
