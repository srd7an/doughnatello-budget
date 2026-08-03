import { useState, type ReactNode } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { useHousehold } from '../../household/HouseholdContext'
import { initials } from '../../lib/format'
import {
  ConfirmButton,
  EditRow,
  Field,
  GhostButton,
  ItemRow,
  Loading,
  Note,
  Panel,
  PrimaryButton,
  Rows,
  TextInput,
} from './kit'

/**
 * Who shares this household's money.
 *
 * Everyone sees everything — there are no per-member permissions on the data
 * itself, because a shared budget that hides transactions from a partner is not
 * a shared budget. Admin governs administration only: naming, invites, removal.
 */
export function PeoplePanel() {
  const { household } = useHousehold()
  const householdId = household._id

  const members = useQuery(api.households.members, { householdId })
  const viewer = useQuery(api.users.viewer, {})
  const updateMember = useMutation(api.households.updateMember)
  const removeMember = useMutation(api.households.removeMember)

  const [open, setOpen] = useState<string | null>(null)

  if (members === undefined || viewer === undefined) return <Loading />

  const isAdmin = household.role === 'admin'
  const adminCount = members.filter((m) => m.role === 'admin').length

  return (
    <Panel
      description="Everyone here sees every transaction. Admins can also invite, rename and remove."
    >
      <Rows>
        {members.map((m) => {
          const isSelf = m.userId === viewer?._id
          const lastAdmin = m.role === 'admin' && adminCount === 1
          // Nothing to open if there is nothing you may do — a member looking at
          // someone else gets a row that reads rather than a row that lies about
          // being pressable.
          const mayEdit = isSelf || isAdmin

          if (open === m.userId) {
            return (
              <EditRow key={m.userId}>
                <div className="space-y-4 px-3 py-2">
                  <RenameForm
                    initial={m.displayName}
                    onCancel={() => setOpen(null)}
                    onSave={async (displayName) => {
                      await updateMember({ householdId, userId: m.userId, displayName })
                      setOpen(null)
                    }}
                    extra={
                      <>
                        {isAdmin && !lastAdmin && (
                          <GhostButton
                            onClick={() =>
                              updateMember({
                                householdId,
                                userId: m.userId,
                                role: m.role === 'admin' ? 'member' : 'admin',
                              })
                            }
                          >
                            {m.role === 'admin' ? 'Make a member' : 'Make an admin'}
                          </GhostButton>
                        )}
                        {isAdmin && !lastAdmin && !isSelf && (
                          <span className="ml-auto">
                            <ConfirmButton
                              label="Remove"
                              confirmLabel="Yes, remove them"
                              onConfirm={async () => {
                                await removeMember({ householdId, userId: m.userId })
                                setOpen(null)
                              }}
                            />
                          </span>
                        )}
                      </>
                    }
                  />
                </div>
              </EditRow>
            )
          }

          return (
            <ItemRow
              key={m.userId}
              leading={
                <span
                  aria-hidden
                  className="grid size-8 shrink-0 place-items-center rounded-full bg-stone-200 text-xs font-medium text-stone-700"
                >
                  {initials(m.displayName)}
                </span>
              }
              name={m.displayName}
              tags={
                isSelf ? (
                  <span className="text-xs font-normal text-stone-400">you</span>
                ) : undefined
              }
              meta={`${m.role === 'admin' ? 'Admin' : 'Member'}${
                lastAdmin ? ' · the only one' : ''
              }`}
              onClick={mayEdit ? () => setOpen(m.userId) : undefined}
            />
          )
        })}
      </Rows>

      <Note>
        Removing someone takes away their access but keeps the transactions they
        entered — that money still happened. The last admin cannot be removed or
        demoted, or nobody could ever administer this household again.
      </Note>
    </Panel>
  )
}

function RenameForm({
  initial,
  onSave,
  onCancel,
  /** The rest of what you can do to this person, on the same action row. */
  extra,
}: {
  initial: string
  onSave: (name: string) => Promise<unknown>
  onCancel: () => void
  extra?: ReactNode
}) {
  const [name, setName] = useState(initial)
  const [busy, setBusy] = useState(false)

  return (
    <div className="space-y-3">
      <Field label="Name">
        <TextInput
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <PrimaryButton
          disabled={!name.trim() || busy}
          onClick={async () => {
            setBusy(true)
            try {
              await onSave(name.trim())
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? 'Saving…' : 'Save'}
        </PrimaryButton>
        <GhostButton onClick={onCancel}>Cancel</GhostButton>
        {extra}
      </div>
    </div>
  )
}
