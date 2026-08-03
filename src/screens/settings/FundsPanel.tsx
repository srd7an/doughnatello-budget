import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useHousehold } from '../../household/HouseholdContext'
import { formatMoney, formatPercent } from '../../lib/format'
import {
  ArchivedList,
  ColorPicker,
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
        <div>
          <ListHeader
            label="Set aside in total"
            figure={formatMoney(total)}
            figureClass="text-gain"
          />
          <Rows>
            {funds.map((f) =>
              editing === f._id ? (
                <EditRow key={f._id}>
                  <PotForm
                    initial={{
                      ...f,
                      kind: f.kind === 'savings' ? 'savings' : 'sinking',
                      targetAmount: f.targetAmount ?? undefined,
                    }}
                    onCancel={() => setEditing(null)}
                    onSave={async (values) => {
                      await update({ potId: f._id, ...values })
                      setEditing(null)
                    }}
                    onArchive={async () => {
                      await archive({ potId: f._id })
                      setEditing(null)
                    }}
                  />
                </EditRow>
              ) : (
                <FundRow key={f._id} fund={f} onEdit={() => setEditing(f._id)} />
              ),
            )}
          </Rows>
        </div>
      )}

      {adding ? (
        <PotForm
          onCancel={() => setAdding(false)}
          onSave={async (values) => {
            await create({ householdId, ...values })
            setAdding(false)
          }}
        />
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
  kind: string
  icon: string
  color: string
  balance: number
  targetAmount: number | null
}

function FundRow({ fund, onEdit }: { fund: Fund; onEdit: () => void }) {
  const target = fund.targetAmount ?? 0
  const share = target > 0 ? Math.min(fund.balance / target, 1) : null

  // A target reads as a sentence rather than a bar. The bar was drawn under
  // the row, which pushed every fund apart and made a list of six funds a
  // scroll; the same fact fits on the line that was already there.
  return (
    <ItemRow
      icon={fund.icon}
      color={fund.color}
      name={fund.name}
      meta={
        share !== null
          ? `${formatPercent(share)} of ${formatMoney(target)}`
          : undefined
      }
      figure={formatMoney(fund.balance)}
      figureClass={fund.balance < 0 ? 'text-debt' : 'text-stone-800'}
      onClick={onEdit}
    />
  )
}

type FundKind = 'savings' | 'sinking'

type PotValues = {
  name: string
  kind: FundKind
  icon: string
  color: string
  targetAmount?: number
}

function PotForm({
  initial,
  onSave,
  onCancel,
  onArchive,
}: {
  initial?: Partial<PotValues>
  onSave: (values: PotValues) => Promise<unknown>
  onCancel: () => void
  /** Only when editing — there is nothing to archive before it exists. */
  onArchive?: () => Promise<unknown>
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [kind, setKind] = useState<FundKind>(initial?.kind ?? 'savings')
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
        kind,
        icon,
        color,
        targetAmount: target > 0 ? target : undefined,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 px-3 py-2">
      <Field label="Name">
        <TextInput
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Car fund"
        />
      </Field>
      {/* The question the app could not previously ask, and could therefore
          never answer: is this a pile you are building, or a bill you are
          getting ahead of? Both reduce what is left to spend in the month you
          fill them — the difference is what emptying one MEANS. */}
      <Field label="What it is for">
        <div className="flex rounded-xl bg-stone-100 p-1">
          {(
            [
              ['savings', 'Saving up'],
              ['sinking', 'A bill coming'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
              className={`h-11 flex-1 rounded-lg text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:h-10 ${
                kind === k
                  ? 'bg-white text-stone-900'
                  : 'text-stone-500 hover:text-stone-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </Field>
      <p className="-mt-2 px-1 text-xs text-stone-400">
        {kind === 'savings'
          ? 'A pile with no bill attached. Emptying it means something went wrong.'
          : 'Money already promised to something — registration, a service. Emptying it means it did its job.'}
      </p>
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
      <FormActions
        onSave={save}
        onCancel={onCancel}
        busy={busy}
        disabled={!name.trim()}
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
