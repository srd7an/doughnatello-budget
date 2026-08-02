import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useHousehold } from '../../household/HouseholdContext'
import { CategoryIcon } from '../../ui/icons'
import {
  Card,
  ColorPicker,
  ConfirmButton,
  Field,
  GhostButton,
  IconPicker,
  Loading,
  Note,
  Panel,
  PrimaryButton,
  TextInput,
} from './kit'

type Kind = 'income' | 'committed' | 'discretionary'

// Kind is about OBLIGATION, not amount: committed is unavoidable, discretionary
// is chosen. The labels users see are Needs and Wants.
const GROUPS: { kind: Kind; label: string; blurb: string }[] = [
  { kind: 'income', label: 'Income', blurb: 'Money coming in.' },
  {
    kind: 'committed',
    label: 'Needs',
    blurb: 'Unavoidable — rent, groceries, bills.',
  },
  {
    kind: 'discretionary',
    label: 'Wants',
    blurb: 'Chosen — takeout, travel, gifts.',
  },
]

/**
 * Categories are the vocabulary the whole app speaks. They are archived rather
 * than deleted: a category's name is stamped on every past transaction, and
 * deleting one would silently rewrite months of history.
 */
export function CategoriesPanel() {
  const { household } = useHousehold()
  const householdId = household._id

  const categories = useQuery(api.categories.list, {
    householdId,
    includeArchived: true,
  })
  const create = useMutation(api.categories.create)
  const update = useMutation(api.categories.update)
  const archive = useMutation(api.categories.archive)
  const unarchive = useMutation(api.categories.unarchive)
  const remove = useMutation(api.categories.remove)
  const [error, setError] = useState<string | null>(null)

  const [adding, setAdding] = useState<Kind | null>(null)
  const [editing, setEditing] = useState<Id<'categories'> | null>(null)

  if (categories === undefined) return <Loading />

  const active = categories.filter((c) => !c.isArchived)
  const archived = categories.filter((c) => c.isArchived)

  return (
    <Panel
      description="What your money is for. Needs and Wants group the spending views; income is kept separate."
    >
      {GROUPS.map((g) => {
        const rows = active.filter((c) => c.kind === g.kind)
        return (
          <Card key={g.kind}>
            <div className="border-b border-stone-100 px-4 py-3">
              <h2 className="text-sm font-semibold">{g.label}</h2>
              <p className="text-xs text-stone-400">{g.blurb}</p>
            </div>
            <ul>
              {rows.map((c) => (
                <li
                  key={c._id}
                  className="border-b border-stone-100 last:border-b-0"
                >
                  {editing === c._id ? (
                    <CategoryForm
                      initial={{
                        name: c.name,
                        kind: c.kind,
                        icon: c.icon,
                        color: c.color,
                      }}
                      onCancel={() => setEditing(null)}
                      onSave={async (values) => {
                        await update({ categoryId: c._id, ...values })
                        setEditing(null)
                      }}
                    />
                  ) : (
                    <div className="flex items-center gap-3 p-4">
                      <CategoryIcon icon={c.icon} color={c.color} />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {c.name}
                      </span>
                      <GhostButton onClick={() => setEditing(c._id)}>
                        Edit
                      </GhostButton>
                      <ConfirmButton
                        label="Archive"
                        confirmLabel="Archive it"
                        onConfirm={() => archive({ categoryId: c._id })}
                      />
                    </div>
                  )}
                </li>
              ))}
              {rows.length === 0 && (
                <li className="px-4 py-3 text-sm text-stone-400">
                  Nothing here yet.
                </li>
              )}
            </ul>

            {adding === g.kind ? (
              <div className="border-t border-stone-100">
                <CategoryForm
                  initial={{ kind: g.kind }}
                  onCancel={() => setAdding(null)}
                  onSave={async (values) => {
                    await create({ householdId, ...values })
                    setAdding(null)
                  }}
                />
              </div>
            ) : (
              <div className="border-t border-stone-100 p-3">
                <GhostButton onClick={() => setAdding(g.kind)}>
                  Add to {g.label}
                </GhostButton>
              </div>
            )}
          </Card>
        )
      })}

      {archived.length > 0 && (
        <Card>
          <div className="border-b border-stone-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-stone-500">Archived</h2>
            <p className="text-xs text-stone-400">
              Hidden from the pickers. Past transactions keep them. One with no
              transactions can be deleted for good.
            </p>
            {error && <p className="mt-1 text-xs text-debt">{error}</p>}
          </div>
          <ul>
            {archived.map((c) => (
              <li
                key={c._id}
                className="flex items-center gap-3 border-b border-stone-100 p-4 last:border-b-0"
              >
                <span className="opacity-50">
                  <CategoryIcon icon={c.icon} />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-stone-500">
                  {c.name}
                </span>
                <GhostButton onClick={() => unarchive({ categoryId: c._id })}>
                  Restore
                </GhostButton>
                <ConfirmButton
                  label="Delete"
                  confirmLabel="Delete for good"
                  onConfirm={async () => {
                    setError(null)
                    try {
                      await remove({ categoryId: c._id })
                    } catch (e) {
                      setError(e instanceof Error ? e.message : 'Could not delete')
                    }
                  }}
                />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Note>
        Moving a category between Needs and Wants re-groups every past
        transaction in it — the split is a lens on your spending, not a record of
        what you decided at the time.
      </Note>
    </Panel>
  )
}

type CategoryValues = {
  name: string
  kind: Kind
  icon: string
  color: string
}

function CategoryForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Partial<CategoryValues>
  onSave: (values: CategoryValues) => Promise<unknown>
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [kind, setKind] = useState<Kind>(initial?.kind ?? 'committed')
  const [icon, setIcon] = useState(initial?.icon ?? 'star')
  const [color, setColor] = useState(initial?.color ?? '#E8632A')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      await onSave({ name: name.trim(), kind, icon, color })
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
          placeholder="Groceries"
        />
      </Field>
      {/* Income is a different kind of thing; only Needs↔Wants is a real move. */}
      {kind !== 'income' && (
        <Field label="Group">
          <div className="flex rounded-xl bg-stone-100 p-1">
            {(['committed', 'discretionary'] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
                className={`h-10 flex-1 rounded-lg text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                  kind === k
                    ? 'bg-white text-stone-900'
                    : 'text-stone-500 hover:text-stone-700'
                }`}
              >
                {k === 'committed' ? 'Needs' : 'Wants'}
              </button>
            ))}
          </div>
        </Field>
      )}
      <Field label="Icon">
        <IconPicker value={icon} onChange={setIcon} />
      </Field>
      <Field label="Colour">
        <ColorPicker value={color} onChange={setColor} />
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
