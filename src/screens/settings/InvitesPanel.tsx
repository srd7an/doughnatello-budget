import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { useHousehold } from '../../household/HouseholdContext'
import {
  Card,
  ConfirmButton,
  Empty,
  GhostButton,
  ItemRow,
  ListHeader,
  Loading,
  Note,
  Panel,
  PrimaryButton,
  Rows,
} from './kit'

function inviteUrl(token: string): string {
  return `${window.location.origin}/?invite=${token}`
}

function expiryLabel(expiresAt: number): string {
  const days = Math.ceil((expiresAt - Date.now()) / 86_400_000)
  if (days <= 0) return 'Expired'
  return days === 1 ? 'Expires tomorrow' : `Expires in ${days} days`
}

/**
 * Invites are single-use links with an expiry. Anyone holding the link can join,
 * so the panel treats a live link as the secret it is: copy it, send it through
 * something you trust, and withdraw it if it goes astray.
 */
export function InvitesPanel() {
  const { household } = useHousehold()
  const householdId = household._id
  const isAdmin = household.role === 'admin'

  const pending = useQuery(
    api.invites.listPending,
    isAdmin ? { householdId } : 'skip',
  )
  const create = useMutation(api.invites.create)
  const revoke = useMutation(api.invites.revoke)

  const [fresh, setFresh] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!isAdmin) {
    return (
      <Panel>
        <Empty>Only an admin can invite people to this household.</Empty>
      </Panel>
    )
  }
  if (pending === undefined) return <Loading />

  const copy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(inviteUrl(token))
      setCopied(token)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      // Clipboard can be blocked; the link is visible on screen either way.
    }
  }

  return (
    <Panel
      description="A link that lets one person join this household. It works once, then it is spent."
    >
      <PrimaryButton
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try {
            const token = await create({ householdId })
            setFresh(token)
            await copy(token)
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? 'Creating…' : 'Create an invite link'}
      </PrimaryButton>

      {fresh && (
        <Card className="p-4">
          <p className="text-xs font-medium tracking-wide text-stone-400 uppercase">
            New link
          </p>
          <p className="mt-1.5 break-all rounded-lg bg-stone-50 p-3 font-mono text-xs text-stone-700">
            {inviteUrl(fresh)}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <GhostButton onClick={() => copy(fresh)}>
              {copied === fresh ? 'Copied' : 'Copy'}
            </GhostButton>
            <span className="text-xs text-stone-400">
              Send it through something you trust — anyone with this link can
              join.
            </span>
          </div>
        </Card>
      )}

      {pending.length === 0 ? (
        <Empty>No invites waiting to be used.</Empty>
      ) : (
        <div>
          <ListHeader label="Waiting to be used" />
          <Rows>
            {pending.map((i) => (
              // An invite is a token and a deadline; there is nothing about it
              // to edit, so its two actions stay on the row.
              <ItemRow
                key={i._id}
                name={`…${i.token.slice(-12)}`}
                meta={expiryLabel(i.expiresAt)}
                trailing={
                  <span className="flex shrink-0 items-center gap-1">
                    <GhostButton onClick={() => copy(i.token)}>
                      {copied === i.token ? 'Copied' : 'Copy link'}
                    </GhostButton>
                    <ConfirmButton
                      label="Withdraw"
                      confirmLabel="Yes, withdraw it"
                      onConfirm={() => revoke({ inviteId: i._id })}
                    />
                  </span>
                }
              />
            ))}
          </Rows>
        </div>
      )}

      <Note>
        Withdrawing an invite makes the link stop working immediately. An invite
        that has already been accepted cannot be withdrawn — remove the person
        from People instead.
      </Note>
    </Panel>
  )
}
