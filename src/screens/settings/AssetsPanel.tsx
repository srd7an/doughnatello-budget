import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useHousehold } from '../../household/HouseholdContext'
import { formatMoney } from '../../lib/format'
import { localISO } from '../../lib/dates'
import {
  ArchivedList,
  ConfirmButton,
  EditRow,
  Empty,
  Field,
  GhostButton,
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
export function AssetsPanel({ editId }: { editId?: string }) {
  const { household } = useHousehold()
  const householdId = household._id

  const assets = useQuery(api.assets.list, { householdId, includeArchived: true })
  const pots = useQuery(api.pots.balances, { householdId })
  const create = useMutation(api.assets.create)
  const update = useMutation(api.assets.update)
  const revalue = useMutation(api.assets.revalue)
  const archive = useMutation(api.assets.archive)
  const remove = useMutation(api.assets.remove)
  const unarchive = useMutation(api.assets.unarchive)

  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Id<'assets'> | null>(
    (editId as Id<'assets'>) ?? null,
  )
  const [revaluing, setRevaluing] = useState<Id<'assets'> | null>(null)

  if (assets === undefined || pots === undefined) return <Loading />

  const debts = pots.filter((p) => p.kind === 'debt')
  const archived = assets.filter((a) => a.isArchived)
  const live = assets.filter((a) => !a.isArchived)
  const total = live.reduce((s, a) => s + a.value, 0)
  const today = localISO(new Date())

  return (
    <Panel
      description="Things you own that are worth something. They count toward net worth and nothing else."
    >
      {live.length === 0 ? (
        <Empty>No assets yet — a flat, a car, anything worth recording.</Empty>
      ) : (
        <div>
          <ListHeader label="Total value" figure={formatMoney(total)} />
          <Rows>
            {live.map((a) =>
              editing === a._id ? (
                <EditRow key={a._id}>
                  <AssetForm
                    debts={debts}
                    initial={{
                      name: a.name,
                      value: a.value,
                      icon: a.icon ?? DEFAULT_ASSET_ICON,
                      valuedOn: a.valuedOn,
                      linkedDebtPotId: a.linkedDebtPotId,
                    }}
                    onCancel={() => setEditing(null)}
                    onSave={async ({ name, icon, linkedDebtPotId }) => {
                      await update({ assetId: a._id, name, icon, linkedDebtPotId })
                      setEditing(null)
                    }}
                    onRevalue={() => {
                      setEditing(null)
                      setRevaluing(a._id)
                    }}
                    onArchive={async () => {
                      await archive({ assetId: a._id })
                      setEditing(null)
                    }}
                  />
                </EditRow>
              ) : revaluing === a._id ? (
                <EditRow key={a._id}>
                  <RevalueForm
                    current={a.value}
                    today={today}
                    onCancel={() => setRevaluing(null)}
                    onSave={async (values) => {
                      await revalue({ assetId: a._id, ...values })
                      setRevaluing(null)
                    }}
                  />
                </EditRow>
              ) : (
                <AssetRow
                  key={a._id}
                  asset={a}
                  today={today}
                  debtName={debts.find((d) => d._id === a.linkedDebtPotId)?.name}
                  onEdit={() => setEditing(a._id)}
                />
              ),
            )}
          </Rows>
        </div>
      )}

      {adding ? (
        <AssetForm
          debts={debts}
          onCancel={() => setAdding(false)}
          onSave={async (values) => {
            await create({ householdId, ...values })
            setAdding(false)
          }}
        />
      ) : (
        <PrimaryButton onClick={() => setAdding(true)}>
          Add an asset
        </PrimaryButton>
      )}

      {archived.length > 0 && (
        <ArchivedList
          items={archived.map((a) => ({ id: a._id, name: a.name }))}
          onRestore={(id) => unarchive({ assetId: id as Id<'assets'> })}
          onDelete={(id) => remove({ assetId: id as Id<'assets'> })}
        />
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
  icon?: string
  valuedOn: string
  linkedDebtPotId?: Id<'pots'>
}

/**
 * What an asset looks like before you say otherwise. Deliberately a plain
 * money glyph rather than a house or a car: the panel holds both, and guessing
 * wrong is worse than not guessing.
 */
const DEFAULT_ASSET_ICON = 'money'

function AssetRow({
  asset,
  today,
  debtName,
  onEdit,
}: {
  asset: Asset
  today: string
  debtName?: string
  onEdit: () => void
}) {
  const age = Math.round(
    (Date.parse(today) - Date.parse(asset.valuedOn)) / 86_400_000,
  )
  const stale = age > STALE_DAYS

  return (
    <ItemRow
      icon={asset.icon ?? DEFAULT_ASSET_ICON}
      name={asset.name}
      meta={
        // A stale valuation is the one thing here worth colouring, so it keeps
        // its own span rather than folding into the quiet meta line.
        <>
          <span className={stale ? 'text-status-near' : undefined}>
            Valued {asset.valuedOn}
            {stale && ' · over a year ago, worth checking'}
          </span>
          {debtName && ` · bought with ${debtName}`}
        </>
      }
      figure={formatMoney(asset.value)}
      onClick={onEdit}
    />
  )
}

type AssetValues = {
  name: string
  value: number
  icon: string
  valuedOn: string
  linkedDebtPotId?: Id<'pots'>
}

/**
 * A dated observation of what something is worth now. Deliberately its own
 * small form rather than a field on the asset: "the flat is worth 10% more"
 * is a thing that happened on a date, and the year's net-worth change reads
 * exactly these entries.
 */
function RevalueForm({
  current,
  today,
  onSave,
  onCancel,
}: {
  current: number
  today: string
  onSave: (values: { value: number; valuedOn: string; note?: string }) => Promise<unknown>
  onCancel: () => void
}) {
  const [value, setValue] = useState(current)
  const [valuedOn, setValuedOn] = useState(today)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (value < 0 || busy) return
    setBusy(true)
    try {
      await onSave({ value, valuedOn, note: note.trim() || undefined })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 px-3 py-2">
      <div className="flex gap-3">
        <Field label="Worth now" className="flex-1">
          <MoneyInput para={value} onChange={setValue} />
        </Field>
        <Field label="As of">
          <TextInput
            type="date"
            value={valuedOn}
            onChange={(e) => setValuedOn(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Note" hint="Optional — a valuation, an offer, a guess.">
        <TextInput value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="flex items-center gap-2">
        <PrimaryButton onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save valuation'}
        </PrimaryButton>
        <GhostButton onClick={onCancel}>Cancel</GhostButton>
      </div>
    </div>
  )
}

function AssetForm({
  initial,
  debts,
  onSave,
  onCancel,
  onRevalue,
  onArchive,
}: {
  /** Present means editing, and editing cannot change what a thing is worth —
   *  that is a dated valuation, so those fields are not offered here. */
  initial?: AssetValues
  debts: { _id: Id<'pots'>; name: string }[]
  onSave: (values: AssetValues) => Promise<unknown>
  onCancel: () => void
  /** What a thing is worth is a dated event, not a field — so re-valuing is a
   *  door out of this form rather than an input in it. Editing only. */
  onRevalue?: () => void
  onArchive?: () => Promise<unknown>
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [icon, setIcon] = useState(initial?.icon ?? DEFAULT_ASSET_ICON)
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
        icon,
        valuedOn,
        linkedDebtPotId: debt || undefined,
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
            placeholder="Flat"
          />
        </Field>
        <Field label="Icon">
          <IconPicker value={icon} onChange={setIcon} />
        </Field>
      </div>
      {/* Only when it is new. On an existing asset the value is changed by
          Re-value, which records WHEN — offering it here would be a field that
          silently did nothing. */}
      {!initial && (
        <div className="flex gap-3">
          <Field label="Value" className="flex-1">
            <MoneyInput para={value} onChange={setValue} />
          </Field>
          <Field label="Valued on" hint="What it is worth as of this date.">
            <TextInput
              type="date"
              value={valuedOn}
              onChange={(e) => setValuedOn(e.target.value)}
            />
          </Field>
        </div>
      )}
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
      <div className="flex flex-wrap items-center gap-2">
        <PrimaryButton onClick={save} disabled={!name.trim() || value <= 0 || busy}>
          {busy ? 'Saving…' : 'Save'}
        </PrimaryButton>
        <GhostButton onClick={onCancel}>Cancel</GhostButton>
        {onRevalue && <GhostButton onClick={onRevalue}>Re-value</GhostButton>}
        {onArchive && (
          <span className="ml-auto">
            <ConfirmButton
              label="Archive"
              confirmLabel="Yes, archive it"
              onConfirm={onArchive}
            />
          </span>
        )}
      </div>
    </div>
  )
}
