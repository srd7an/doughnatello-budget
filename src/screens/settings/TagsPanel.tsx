import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useHousehold } from '../../household/HouseholdContext'
import { useKeepPeriod } from '../../period/PeriodContext'
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

/**
 * Tags — the things your money went to that no category or fund could name: a
 * holiday, a wedding, a renovation, a month of being ill.
 *
 * This panel is where they are RENAMED and put away, not where they are made.
 * A tag is invented in the middle of entering the transaction that needs it, so
 * the transaction form makes them; coming here first would mean deciding you
 * went to Greece before you could write down the first coffee there.
 *
 * Archived rather than deleted by default, for a softer reason than a category:
 * nothing about your money changes either way, but a picker offering every trip
 * you have ever taken is a picker nobody can use.
 */
export function TagsPanel({ editId }: { editId?: string }) {
  const { household } = useHousehold()
  const householdId = household._id
  const navigate = useNavigate()
  const keepPeriod = useKeepPeriod()

  const tags = useQuery(api.tags.list, { householdId, includeArchived: true })
  const update = useMutation(api.tags.update)
  const archive = useMutation(api.tags.archive)
  const unarchive = useMutation(api.tags.unarchive)
  const remove = useMutation(api.tags.remove)

  const [editing, setEditing] = useState<Id<'tags'> | null>(
    (editId as Id<'tags'>) ?? null,
  )
  const [error, setError] = useState<string | null>(null)

  if (tags === undefined) return <Loading />

  const active = tags.filter((t) => !t.isArchived)
  const archived = tags.filter((t) => t.isArchived)

  return (
    <Panel description="Labels across months and categories. A tag groups things the rest of the app cannot — and it changes no total anywhere.">
      {active.length === 0 ? (
        <p className="px-3 py-2 text-sm text-stone-400">
          No tags yet. Make one while adding a transaction — the Tags row at the
          bottom of the form.
        </p>
      ) : (
        <Rows>
          {active.map((t) =>
            editing === t._id ? (
              <EditRow key={t._id}>
                <TagForm
                  initial={{ name: t.name, icon: t.icon, color: t.color }}
                  error={error}
                  onCancel={() => {
                    setEditing(null)
                    setError(null)
                  }}
                  onSave={async (values) => {
                    setError(null)
                    try {
                      await update({ tagId: t._id, ...values })
                      setEditing(null)
                    } catch (e) {
                      setError(
                        e instanceof Error ? e.message : 'Could not save',
                      )
                    }
                  }}
                  onArchive={async () => {
                    await archive({ tagId: t._id })
                    setEditing(null)
                  }}
                  onOpen={() => navigate(keepPeriod(`/tags/${t._id}`))}
                />
              </EditRow>
            ) : (
              <ItemRow
                key={t._id}
                icon={t.icon}
                color={t.color}
                name={t.name}
                meta={`${t.count} ${t.count === 1 ? 'transaction' : 'transactions'}`}
                onClick={() => setEditing(t._id)}
              />
            ),
          )}
        </Rows>
      )}

      {archived.length > 0 && (
        <section>
          <div className="px-3 pb-1">
            <h2 className="text-xs font-medium tracking-wide text-stone-400 uppercase">
              Archived
            </h2>
            <p className="text-xs text-stone-400">
              Hidden from the pickers; the rows keep them. Deleting one removes
              the label from those rows — nothing else about them changes.
            </p>
            {error && <p className="mt-1 text-xs text-debt">{error}</p>}
          </div>
          <Rows>
            {archived.map((t) => (
              <ItemRow
                key={t._id}
                icon={t.icon}
                name={t.name}
                muted
                meta={`${t.count} ${t.count === 1 ? 'transaction' : 'transactions'}`}
                trailing={
                  <span className="flex shrink-0 items-center gap-1">
                    <GhostButton onClick={() => unarchive({ tagId: t._id })}>
                      Restore
                    </GhostButton>
                    <ConfirmButton
                      label="Delete"
                      confirmLabel="Yes, delete for good"
                      onConfirm={async () => {
                        setError(null)
                        try {
                          await remove({ tagId: t._id })
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
        A tag is a second axis across your spending, never a replacement for a
        category. The dinners in Greece are still Eating out — the tag is what
        lets you read the whole trip as one figure.
      </Note>
    </Panel>
  )
}

type TagValues = { name: string; icon: string; color: string }

function TagForm({
  initial,
  onSave,
  onCancel,
  onArchive,
  onOpen,
  error,
}: {
  initial: TagValues
  onSave: (values: TagValues) => Promise<unknown>
  onCancel: () => void
  onArchive: () => Promise<unknown>
  /** Off to the tag's own page — where the total and the rows are. */
  onOpen: () => void
  error: string | null
}) {
  const [name, setName] = useState(initial.name)
  const [icon, setIcon] = useState(initial.icon)
  const [color, setColor] = useState(initial.color)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      await onSave({ name: name.trim(), icon, color })
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
          placeholder="Greece 2026"
        />
      </Field>
      <div className="flex gap-2">
        <IconPicker value={icon} onChange={setIcon} />
        <ColorPicker value={color} onChange={setColor} />
      </div>
      {error && <p className="text-xs text-debt">{error}</p>}
      <FormActions
        onSave={save}
        onCancel={onCancel}
        busy={busy}
        disabled={!name.trim()}
        destructive={
          <span className="flex items-center gap-1">
            <GhostButton onClick={onOpen}>Open</GhostButton>
            <ConfirmButton
              label="Archive"
              confirmLabel="Yes, archive it"
              onConfirm={onArchive}
            />
          </span>
        }
      />
    </div>
  )
}
