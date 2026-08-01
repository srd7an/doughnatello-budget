import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { useHousehold } from '../../household/HouseholdContext'
import { formatMoney } from '../../lib/format'
import {
  Card,
  Field,
  Loading,
  MoneyInput,
  Note,
  Panel,
  PrimaryButton,
  Stat,
  TextInput,
} from './kit'

/**
 * The one real bank account. There is deliberately no account picker anywhere
 * in the app — this panel is where its two facts live: what it is called, and
 * what the bank actually says.
 *
 * The balance is typed in, not derived. The app cannot see your bank, and a
 * computed running balance would need an opening figure nobody has; so the
 * honest model is "tell me what the bank says" and split THAT into set aside
 * and free.
 */
export function AccountPanel() {
  const { household } = useHousehold()
  const householdId = household._id

  const account = useQuery(api.accounts.getPrimary, { householdId })
  const balances = useQuery(api.overview.balances, { householdId })
  const rename = useMutation(api.accounts.rename)
  const setBalance = useMutation(api.accounts.setBalance)

  const [name, setName] = useState<string | null>(null)
  const [para, setPara] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  if (account === undefined || balances === undefined) return <Loading />
  if (account === null) {
    return (
      <Panel title="Account & bank">
        <Note>This household has no primary account.</Note>
      </Panel>
    )
  }

  const nameValue = name ?? account.name
  const dirty =
    nameValue.trim() !== account.name ||
    (para !== null && para !== account.bankBalance)

  const save = async () => {
    if (!dirty || saving) return
    setSaving(true)
    try {
      if (nameValue.trim() && nameValue.trim() !== account.name) {
        await rename({ accountId: account._id, name: nameValue.trim() })
      }
      if (para !== null && para !== account.bankBalance) {
        await setBalance({ accountId: account._id, bankBalance: para })
      }
      setName(null)
      setPara(null)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Panel
      title="Account & bank"
      description="One account, entered by hand. The app never connects to your bank."
    >
      <Card className="p-4">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="In bank" amount={balances.inBank} />
          <Stat label="Set aside" amount={balances.setAside} tone="saved" />
          <Stat label="Free" amount={balances.free} />
        </div>
        <p className="mt-3 border-t border-stone-100 pt-3 text-xs text-stone-400">
          Set aside is the total of your funds. It is already inside the bank
          balance — it is not extra money, it is money with a job.
        </p>
      </Card>

      <Card className="space-y-4 p-4">
        <Field label="Account name">
          <TextInput
            value={nameValue}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        <Field
          label="What the bank says"
          hint={`Currently recorded: ${formatMoney(account.bankBalance)}. Update it whenever you check.`}
        >
          <MoneyInput
            key={account.bankBalance}
            para={account.bankBalance}
            onChange={setPara}
          />
        </Field>

        <PrimaryButton onClick={save} disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save'}
        </PrimaryButton>
      </Card>

      <Note>
        Correcting this figure does not create or destroy a transaction — it only
        changes what the app believes is in the account.
      </Note>
    </Panel>
  )
}
