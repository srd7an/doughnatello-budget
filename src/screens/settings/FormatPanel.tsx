import { useState } from 'react'
import { useMutation } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { useHousehold } from '../../household/HouseholdContext'
import { formatMoney, formatPercent } from '../../lib/format'
import { useRemember } from '../../lib/privacy'
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
        <DeviceCard />
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

      <DeviceCard />

      <Note>
        Changing the currency relabels every figure in the app at once. Past
        transactions keep the amounts you entered.
      </Note>
    </Panel>
  )
}

/**
 * The one setting that belongs to the device rather than the household, so
 * everyone sees it — an admin's laptop and a member's phone are different
 * rooms. See lib/privacy for why hidden-on-open is the default and why this is
 * a switch somebody has to go and turn.
 */
function DeviceCard() {
  const { remember, set } = useRemember()
  return (
    <Card className="p-4">
      <p className="text-xs font-medium tracking-wide text-stone-400 uppercase">
        This device
      </p>
      <label className="mt-2 flex min-h-11 cursor-pointer items-start gap-3 sm:min-h-9">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => set(e.target.checked)}
          className="mt-1 size-4 shrink-0 accent-brand"
        />
        <span className="text-sm text-stone-800">
          Open with the numbers as I left them
          <span className="mt-0.5 block text-xs text-stone-500">
            Off, the amounts are hidden every time the app opens, and one press
            on the eye shows them. Turn this on only where nobody reads over
            your shoulder — it applies to this device alone.
          </span>
        </span>
      </label>
    </Card>
  )
}
