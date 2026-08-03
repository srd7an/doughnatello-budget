import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useHousehold } from '../../household/HouseholdContext'
import {
  ColorPicker,
  ConfirmButton,
  EditRow,
  Field,
  FormActions,
  GhostButton,
  IconPicker,
  ItemRow,
  Loading,
  Note,
  Panel,
  Rows,
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
          <section key={g.kind}>
            <div className="px-3 pb-1">
              <h2 className="text-xs font-medium tracking-wide text-stone-400 uppercase">
                {g.label}
              </h2>
              <p className="text-xs text-stone-400">{g.blurb}</p>
            </div>
            <Rows>
              {rows.map((c) =>
                editing === c._id ? (
                  <EditRow key={c._id}>
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
                      onArchive={async () => {
                        await archive({ categoryId: c._id })
                        setEditing(null)
                      }}
                    />
                  </EditRow>
                ) : (
                  <ItemRow
                    key={c._id}
                    icon={c.icon}
                    color={c.color}
                    name={c.name}
                    onClick={() => setEditing(c._id)}
                  />
                ),
              )}
              {rows.length === 0 && (
                <li className="px-3 py-2 text-sm text-stone-400">
                  Nothing here yet.
                </li>
              )}
            </Rows>

            {adding === g.kind ? (
              <CategoryForm
                initial={{ kind: g.kind }}
                onCancel={() => setAdding(null)}
                onSave={async (values) => {
                  await create({ householdId, ...values })
                  setAdding(null)
                }}
              />
            ) : (
              <div className="pt-1">
                <GhostButton onClick={() => setAdding(g.kind)}>
                  Add to {g.label}
                </GhostButton>
              </div>
            )}
          </section>
        )
      })}

      {archived.length > 0 && (
        <section>
          <div className="px-3 pb-1">
            <h2 className="text-xs font-medium tracking-wide text-stone-400 uppercase">
              Archived
            </h2>
            <p className="text-xs text-stone-400">
              Hidden from the pickers. Past transactions keep them. One with no
              transactions can be deleted for good.
            </p>
            {error && <p className="mt-1 text-xs text-debt">{error}</p>}
          </div>
          <Rows>
            {archived.map((c) => (
              // Not pressable: there is nothing to edit about something you have
              // put away, only the two things you might do to it next.
              <ItemRow
                key={c._id}
                icon={c.icon}
                name={c.name}
                muted
                trailing={
                  <span className="flex shrink-0 items-center gap-1">
                    <GhostButton onClick={() => unarchive({ categoryId: c._id })}>
                      Restore
                    </GhostButton>
                    <ConfirmButton
                      label="Delete"
                      confirmLabel="Yes, delete for good"
                      onConfirm={async () => {
                        setError(null)
                        try {
                          await remove({ categoryId: c._id })
                        } catch (e) {
                          setError(
                            e instanceof Error ? e.message : 'Could not delete',
                          )
                        }
                      }}
                    />
                  </span>
                }
              />
            ))}
          </Rows>
        </section>
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
  onArchive,
}: {
  initial?: Partial<CategoryValues>
  onSave: (values: CategoryValues) => Promise<unknown>
  onCancel: () => void
  /** Only when editing — a category that does not exist cannot be put away. */
  onArchive?: () => Promise<unknown>
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
    <div className="space-y-4 px-3 py-2">
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
                className={`h-11 sm:h-10 flex-1 rounded-lg text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
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
      <div className="flex gap-3">
        <Field label="Icon">
          <IconPicker value={icon} onChange={setIcon} />
        </Field>
        <Field label="Colour">
          <ColorPicker value={color} onChange={setColor} />
        </Field>
      </div>
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
