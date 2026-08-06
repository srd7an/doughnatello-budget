import { useEffect, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useHousehold } from '../../household/HouseholdContext'
import { formatMoney, inputToPara, paraToInput } from '../../lib/format'
import { localISO } from '../../lib/dates'
import { Modal } from '../../ui/Modal'
import { PlusIcon } from '../../ui/icons'
import {
  ConfirmButton,
  GhostButton,
  IconPicker,
  Loading,
  Note,
  Panel,
  PrimaryButton,
  inputClass,
} from './kit'
import { useSettingsFooter } from './SettingsModal'

type Draft = { name: string; balance: number }

/**
 * Accounts and what the bank says they hold.
 *
 * The balance is typed in, not derived — the app cannot see your bank and has no
 * opening figure to compute from. That makes it a second, independent record of
 * the same money as the transaction list, which is why changing it on an account
 * that HAS transactions asks first: overwriting says "trust this number and
 * ignore the ledger", while an adjustment says "the ledger was incomplete, here
 * is the missing piece". The second is almost always what you mean.
 */
export function AccountsPanel() {
  const { household } = useHousehold()
  const householdId = household._id

  const accounts = useQuery(api.accounts.list, { householdId })
  const create = useMutation(api.accounts.create)
  const rename = useMutation(api.accounts.rename)
  const setIcon = useMutation(api.accounts.setIcon)
  const setBalance = useMutation(api.accounts.setBalance)
  const adjustBalance = useMutation(api.accounts.adjustBalance)
  const setPrimary = useMutation(api.accounts.setPrimary)
  const archive = useMutation(api.accounts.archive)

  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [saving, setSaving] = useState(false)
  const [adding, setAdding] = useState(false)
  const [confirming, setConfirming] = useState<{
    id: Id<'accounts'>
    name: string
    from: number
    to: number
    count: number
  } | null>(null)

  // Drop drafts once the server agrees with them.
  useEffect(() => {
    if (!accounts) return
    setDrafts((prev) => {
      const next: Record<string, Draft> = {}
      for (const [id, d] of Object.entries(prev)) {
        const a = accounts.find((x) => x._id === id)
        if (a && (a.name !== d.name || a.bankBalance !== d.balance)) next[id] = d
      }
      return next
    })
  }, [accounts])

  const dirtyIds = Object.keys(drafts)

  const commit = async () => {
    if (!accounts) return
    setSaving(true)
    try {
      for (const id of dirtyIds) {
        const draft = drafts[id]
        const account = accounts.find((a) => a._id === id)
        if (!account) continue

        if (draft.name.trim() && draft.name.trim() !== account.name) {
          await rename({ accountId: account._id, name: draft.name.trim() })
        }
        if (draft.balance !== account.bankBalance) {
          // History present? Stop and ask rather than silently overwriting.
          if (account.transactionCount > 0) {
            setConfirming({
              id: account._id,
              name: account.name,
              from: account.bankBalance,
              to: draft.balance,
              count: account.transactionCount,
            })
            return
          }
          await setBalance({
            accountId: account._id,
            bankBalance: draft.balance,
          })
        }
      }
      setDrafts({})
    } finally {
      setSaving(false)
    }
  }

  useSettingsFooter(
    dirtyIds.length > 0
      ? { dirty: true, saving, onSave: commit, onDiscard: () => setDrafts({}) }
      : null,
  )

  if (accounts === undefined) return <Loading />

  const draftFor = (a: (typeof accounts)[number]): Draft =>
    drafts[a._id] ?? { name: a.name, balance: a.bankBalance }

  const edit = (id: string, patch: Partial<Draft>, base: Draft) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...base, ...patch } }))

  return (
    <Panel description="What the bank says you hold. The app never connects to your bank — these figures are yours to keep true.">
      <div className="space-y-5">
        {accounts.map((a, i) => {
          const draft = draftFor(a)
          return (
            <div key={a._id} className="space-y-4">
              {i > 0 && <hr className="border-stone-200" />}

              <Row label="Account name">
                {/* The icon saves on pick rather than waiting for the footer:
                    it is one choice from a closed list, not something you are
                    part-way through typing, so there is nothing to confirm. */}
                <div className="flex items-center gap-2">
                  <IconPicker
                    value={a.icon}
                    onChange={(icon) => setIcon({ accountId: a._id, icon })}
                  />
                  <input
                    value={draft.name}
                    onChange={(e) => edit(a._id, { name: e.target.value }, draft)}
                    className={inputClass}
                  />
                </div>
              </Row>

              <Row label="Total balance">
                <div className="flex items-center gap-2">
                  <input
                    inputMode="decimal"
                    value={paraToInput(draft.balance)}
                    onChange={(e) =>
                      edit(
                        a._id,
                        { balance: inputToPara(e.target.value) },
                        draft,
                      )
                    }
                    className={`${inputClass} tnum text-right`}
                  />
                  <span className="shrink-0 text-xs text-stone-400">
                    {household.baseCurrency}
                  </span>
                </div>
              </Row>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-stone-400">
                  {a.isPrimary ? 'Default for new transactions' : null}
                  {a.transactionCount > 0 &&
                    `${a.isPrimary ? ' · ' : ''}${a.transactionCount} transaction${a.transactionCount === 1 ? '' : 's'}`}
                </span>
                <span className="ml-auto flex items-center gap-2">
                  {!a.isPrimary && (
                    <>
                      <GhostButton
                        onClick={() => setPrimary({ accountId: a._id })}
                      >
                        Make default
                      </GhostButton>
                      <ConfirmButton
                        label="Archive"
                        confirmLabel="Yes, archive it"
                        onConfirm={() => archive({ accountId: a._id })}
                      />
                    </>
                  )}
                </span>
              </div>
            </div>
          )
        })}

        <hr className="border-stone-200" />

        {adding ? (
          <AddAccount
            onCancel={() => setAdding(false)}
            onSave={async (name, balance) => {
              await create({ householdId, name, bankBalance: balance })
              setAdding(false)
            }}
          />
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="flex min-h-11 sm:min-h-9 items-center gap-1 rounded-full px-2 py-1.5 text-sm font-medium text-brand hover:bg-violet-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <PlusIcon className="size-5" />
            Add account
          </button>
        )}
      </div>

      <Note>
        Archiving an account keeps every transaction booked against it. The
        default account cannot be archived — make another one default first.
      </Note>

      <BalanceChangeDialog
        pending={confirming}
        onClose={() => setConfirming(null)}
        onOverwrite={async () => {
          if (!confirming) return
          await setBalance({
            accountId: confirming.id,
            bankBalance: confirming.to,
          })
          setConfirming(null)
          setDrafts({})
        }}
        onAdjust={async () => {
          if (!confirming) return
          await adjustBalance({
            accountId: confirming.id,
            bankBalance: confirming.to,
            occurredOn: localISO(new Date()),
          })
          setConfirming(null)
          setDrafts({})
        }}
      />
    </Panel>
  )
}

/** Label beside its field, as the design lays it out. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="flex-1 text-sm font-medium text-stone-800">{label}</span>
      <span className="flex-1">{children}</span>
    </label>
  )
}

/**
 * The guard. Two genuinely different answers, so it does not pretend there is
 * one obvious button: adjusting keeps the ledger explaining the balance,
 * overwriting declares the ledger incomplete and moves on.
 */
function BalanceChangeDialog({
  pending,
  onClose,
  onOverwrite,
  onAdjust,
}: {
  pending: {
    name: string
    from: number
    to: number
    count: number
  } | null
  onClose: () => void
  onOverwrite: () => Promise<void>
  onAdjust: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  if (!pending) return null

  const difference = pending.to - pending.from
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Change the balance?">
      <p className="text-sm text-stone-600">
        <strong>{pending.name}</strong> already has {pending.count} transaction
        {pending.count === 1 ? '' : 's'}. Changing the balance from{' '}
        <span data-money>{formatMoney(pending.from)}</span> to{' '}
        <span data-money>{formatMoney(pending.to)}</span> is a difference of{' '}
        <span data-money className={difference < 0 ? 'text-debt' : 'text-gain'}>
          {formatMoney(difference, { signed: true })}
        </span>
        .
      </p>

      <div className="mt-4 space-y-3">
        <button
          onClick={() => run(onAdjust)}
          disabled={busy}
          className="w-full rounded-xl border border-brand bg-violet-50 p-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-40"
        >
          <span className="text-sm font-semibold text-stone-800">
            Record an adjustment
          </span>
          <span className="mt-0.5 block text-xs text-stone-600">
            Books the difference as a dated transaction, so your history explains
            the new figure. Recommended.
          </span>
        </button>

        <button
          onClick={() => run(onOverwrite)}
          disabled={busy}
          className="w-full rounded-xl border border-stone-200 p-3 text-left hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-40"
        >
          <span className="text-sm font-semibold text-stone-800">
            Just change the number
          </span>
          <span className="mt-0.5 block text-xs text-stone-600">
            Nothing is recorded. Your transactions will no longer add up to this
            balance, and nothing will say why.
          </span>
        </button>
      </div>

      <div className="mt-4">
        <GhostButton onClick={onClose} disabled={busy}>
          Cancel
        </GhostButton>
      </div>
    </Modal>
  )
}

function AddAccount({
  onSave,
  onCancel,
}: {
  onSave: (name: string, balance: number) => Promise<unknown>
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [balance, setBalance] = useState(0)
  const [busy, setBusy] = useState(false)

  return (
    <div className="space-y-4">
      <Row label="Account name">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Savings account"
          className={inputClass}
        />
      </Row>
      <Row label="Total balance">
        <input
          inputMode="decimal"
          value={paraToInput(balance)}
          onChange={(e) => setBalance(inputToPara(e.target.value))}
          className={`${inputClass} tnum text-right`}
        />
      </Row>
      <div className="flex gap-2">
        <PrimaryButton
          disabled={!name.trim() || busy}
          onClick={async () => {
            setBusy(true)
            try {
              await onSave(name.trim(), balance)
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? 'Adding…' : 'Add account'}
        </PrimaryButton>
        <GhostButton onClick={onCancel}>Cancel</GhostButton>
      </div>
    </div>
  )
}
