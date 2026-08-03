import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { useHousehold } from '../../household/HouseholdContext'
import { initials } from '../../lib/format'
import {
  Card,
  ConfirmButton,
  Field,
  GhostButton,
  Loading,
  Note,
  Panel,
  PrimaryButton,
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

  const [renaming, setRenaming] = useState<string | null>(null)

  if (members === undefined || viewer === undefined) return <Loading />

  const isAdmin = household.role === 'admin'
  const adminCount = members.filter((m) => m.role === 'admin').length

  return (
    <Panel
      description="Everyone here sees every transaction. Admins can also invite, rename and remove."
    >
      <Card>
        <ul>
          {members.map((m) => {
            const isSelf = m.userId === viewer?._id
            const lastAdmin = m.role === 'admin' && adminCount === 1
            return (
              <li key={m.userId} className="border-b border-stone-100 p-4 last:border-b-0">
                {renaming === m.userId ? (
                  <RenameForm
                    initial={m.displayName}
                    onCancel={() => setRenaming(null)}
                    onSave={async (displayName) => {
                      await updateMember({ householdId, userId: m.userId, displayName })
                      setRenaming(null)
                    }}
                  />
                ) : (
                  <>
                    <div className="flex items-center gap-3">
                      <span
                        aria-hidden
                        className="grid size-9 shrink-0 place-items-center rounded-full bg-stone-200 text-sm font-semibold text-stone-700"
                      >
                        {initials(m.displayName)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {m.displayName}
                          {isSelf && (
                            <span className="ml-1.5 text-xs font-normal text-stone-400">
                              you
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-stone-400">
                          {m.role === 'admin' ? 'Admin' : 'Member'}
                          {lastAdmin && ' · the only one'}
                        </p>
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2 pl-12">
                      {(isSelf || isAdmin) && (
                        <GhostButton onClick={() => setRenaming(m.userId)}>
                          Rename
                        </GhostButton>
                      )}
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
                        <ConfirmButton
                          label="Remove"
                          confirmLabel="Yes, remove them"
                          onConfirm={() =>
                            removeMember({ householdId, userId: m.userId })
                          }
                        />
                      )}
                    </div>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      </Card>

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
}: {
  initial: string
  onSave: (name: string) => Promise<unknown>
  onCancel: () => void
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
      <div className="flex gap-2">
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
      </div>
    </div>
  )
}
