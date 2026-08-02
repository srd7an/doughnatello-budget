import { useState } from 'react'
import { useMutation } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { useHousehold } from '../../household/HouseholdContext'
import { formatMoney, formatPercent } from '../../lib/format'
import {
  Card,
  Empty,
  Field,
  Note,
  Panel,
  PrimaryButton,
  TextInput,
} from './kit'

/**
 * The household's name and the currency its figures are labelled with.
 *
 * Number formatting is Serbian and fixed (44.413 · 13,7%) — it is not a
 * preference, it is what the numbers in this app look like. Currency is a
 * label only: changing it NEVER converts a stored amount, because the app holds
 * no exchange rate and inventing one would rewrite your history.
 */
export function FormatPanel() {
  const { household } = useHousehold()
  const update = useMutation(api.households.update)

  const [name, setName] = useState(household.name)
  const [currency, setCurrency] = useState(household.baseCurrency)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (household.role !== 'admin') {
    return (
      <Panel>
        <Empty>Only an admin can change the household's name or currency.</Empty>
      </Panel>
    )
  }

  const dirty =
    name.trim() !== household.name ||
    currency.trim().toUpperCase() !== household.baseCurrency
  const valid = name.trim().length > 0 && /^[A-Za-z]{3}$/.test(currency.trim())

  const save = async () => {
    if (!dirty || !valid || saving) return
    setSaving(true)
    setError(null)
    try {
      await update({
        householdId: household._id,
        name: name.trim(),
        baseCurrency: currency.trim().toUpperCase(),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Panel>
      <Card className="space-y-4 p-4">
        <Field label="Household name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <Field
          label="Currency"
          hint="A three-letter code. This is a label — amounts are never converted."
        >
          <TextInput
            value={currency}
            maxLength={3}
            onChange={(e) => setCurrency(e.target.value.replace(/[^A-Za-z]/g, ''))}
            className="uppercase"
          />
        </Field>

        {error && <p className="text-sm text-debt">{error}</p>}

        <PrimaryButton onClick={save} disabled={!dirty || !valid || saving}>
          {saving ? 'Saving…' : 'Save'}
        </PrimaryButton>
      </Card>

      <Card className="p-4">
        <p className="text-xs font-medium tracking-wide text-stone-400 uppercase">
          How numbers look
        </p>
        <div className="mt-2 space-y-1 text-sm">
          <p className="tnum">
            {formatMoney(4_441_300)}{' '}
            <span className="text-stone-400">
              {currency.trim().toUpperCase() || household.baseCurrency}
            </span>
          </p>
          <p className="tnum">{formatPercent(0.137)}</p>
        </div>
        <p className="mt-2 text-xs text-stone-400">
          Serbian grouping, and no decimals — amounts are stored exactly and
          rounded only for display.
        </p>
      </Card>

      <Note>
        Changing the currency relabels every figure in the app at once. Past
        transactions keep the amounts you entered.
      </Note>
    </Panel>
  )
}
