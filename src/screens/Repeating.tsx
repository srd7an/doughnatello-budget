import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useHousehold } from '../household/HouseholdContext'
import { formatMoney } from '../lib/format'
import { localISO } from '../lib/dates'
import { cadenceLabel, dueLabel } from '../lib/recurrence'
import type { Id } from '../../convex/_generated/dataModel'
import type { FunctionReturnType } from 'convex/server'
import {
  ConfirmButton,
  EditRow,
  Empty,
  Field,
  FormActions,
  GhostButton,
  ItemRow,
  Loading,
  MoneyInput,
  Note,
  Panel,
  Rows,
  TextInput,
} from './settings/kit'

/**
 * The list of repeating rules — the "what is set up" view, as opposed to the
 * Due block's "what needs settling now".
 *
 * Rules are created from the Add-transaction modal (Repeat). Here they are
 * changed, paused and deleted. Paused rules sink to the bottom rather than
 * disappearing: pausing is meant to be reversible and visible.
 *
 * A rule could not be changed at all, only deleted and made again — and making
 * it again meant entering a transaction, so correcting the gym's new price was
 * a fake purchase and a lost history. Opening a rule now opens its editor.
 */
export function Repeating() {
  const { household } = useHousehold()
  const rules = useQuery(api.recurring.listRules, {
    householdId: household._id,
  })
  const setActive = useMutation(api.recurring.setActive)
  const [open, setOpen] = useState<string | null>(null)
  const remove = useMutation(api.recurring.remove)
  const today = localISO(new Date())

  return (
    <Panel
      description="Money that comes back every month. Set one up from Add transaction → Repeat."
    >
      {rules === undefined ? (
        <Loading />
      ) : rules.length === 0 ? (
        <Empty>Nothing repeats yet.</Empty>
      ) : (
        <Rows>
          {rules.map((r) => {
            const label = r.payee ?? r.category?.name ?? r.pot?.name ?? 'Repeating'
            const icon = r.category?.icon ?? r.pot?.icon
            const meta = [
              cadenceLabel(r.cadence, r.intervalCount, r.anchorDay, r.nextDueOn),
              r.isActive && dueLabel(r.nextDueOn, today),
              r.fundedFromPot && `from ${r.fundedFromPot.name}`,
            ]
              .filter(Boolean)
              .join(' · ')

            // Open, like every other list in Settings, rather than carrying its
            // controls at rest. Revealing them on hover was the tempting middle
            // way and it is the wrong one: a phone has no hover, so Pause and
            // Delete would simply not exist on the device most likely to be
            // holding this screen.
            if (open === r._id) {
              return (
                <EditRow key={r._id}>
                  <RuleForm
                    rule={r}
                    today={today}
                    onDone={() => setOpen(null)}
                    actions={
                      <>
                        <GhostButton
                          onClick={() =>
                            setActive({ ruleId: r._id, isActive: !r.isActive })
                          }
                        >
                          {r.isActive ? 'Pause' : 'Resume'}
                        </GhostButton>
                        <ConfirmButton
                          label="Delete"
                          confirmLabel="Yes, delete it"
                          onConfirm={async () => {
                            await remove({ ruleId: r._id })
                            setOpen(null)
                          }}
                        />
                      </>
                    }
                  />
                </EditRow>
              )
            }

            return (
              <ItemRow
                key={r._id}
                icon={icon ?? 'schedule'}
                color={r.category?.color ?? r.pot?.color}
                name={label}
                muted={!r.isActive}
                tags={
                  <>
                    {!r.isActive && <Tag>Paused</Tag>}
                    {r.autoPost && <Tag>Automatic</Tag>}
                    {r.amountMode === 'estimate' && <Tag>Estimate</Tag>}
                  </>
                }
                meta={meta}
                figure={`${r.direction === 'income' ? '+' : ''}${formatMoney(r.amount)}`}
                figureClass={`${
                  r.direction === 'income' ? 'text-gain' : 'text-stone-800'
                } ${r.isActive ? '' : 'opacity-50'}`}
                onClick={() => setOpen(r._id)}
              />
            )
          })}
        </Rows>
      )}

      <Note>
        Changing a rule changes what it does from now on. Transactions it
        already created stay as they are — that money happened. Deleting a rule
        stops it repeating.
      </Note>
    </Panel>
  )
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-normal text-stone-500">
      {children}
    </span>
  )
}

type Rule = FunctionReturnType<typeof api.recurring.listRules>[number]

const CADENCES = [
  { id: 'weekly', one: 'week', many: 'weeks' },
  { id: 'monthly', one: 'month', many: 'months' },
  { id: 'yearly', one: 'year', many: 'years' },
] as const

const selectClass =
  'w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-violet-200'

/**
 * Everything about a rule except which way the money goes.
 *
 * The schedule is "every N weeks/months/years, next on <date>": the date is the
 * thing people know ("the rent moved to the 5th"), and the day of the month is
 * read off it. Only fields that changed are sent, so opening a rule and saving
 * it untouched writes nothing — in particular it does not re-anchor a rule that
 * falls on the 31st to whatever shorter month it next lands in.
 */
function RuleForm({
  rule,
  today,
  onDone,
  actions,
}: {
  rule: Rule
  today: string
  onDone: () => void
  actions: React.ReactNode
}) {
  const { household } = useHousehold()
  const update = useMutation(api.recurring.update)
  const categories = useQuery(api.categories.list, {
    householdId: household._id,
  })

  const [amount, setAmount] = useState(rule.amount)
  const [estimate, setEstimate] = useState(rule.amountMode === 'estimate')
  const [payee, setPayee] = useState(rule.payee ?? '')
  const [categoryId, setCategoryId] = useState<string>(rule.categoryId ?? '')
  const [cadence, setCadence] = useState(rule.cadence)
  const [every, setEvery] = useState(String(rule.intervalCount))
  // A paused rule's stored date may be long gone; it is resumed from today.
  const [next, setNext] = useState(
    rule.nextDueOn < today ? today : rule.nextDueOn,
  )
  const [until, setUntil] = useState(rule.untilDate ?? '')
  const [autoPost, setAutoPost] = useState(rule.autoPost)
  const [note, setNote] = useState(rule.note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Income rules file under income categories, the rest under spending ones.
  // A transfer has no category — it is filed by the fund it goes into.
  const options =
    rule.direction === 'transfer'
      ? []
      : (categories ?? []).filter((c) =>
          rule.direction === 'income'
            ? c.kind === 'income'
            : c.kind !== 'income',
        )

  const interval = Number(every)
  const valid =
    amount > 0 &&
    Number.isInteger(interval) &&
    interval >= 1 &&
    next >= today &&
    (until === '' || until >= next)

  const save = async () => {
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    const mode = estimate ? 'estimate' : 'exact'
    try {
      await update({
        ruleId: rule._id,
        ...(amount !== rule.amount && { amount }),
        ...(mode !== rule.amountMode && { amountMode: mode }),
        ...(payee.trim() !== (rule.payee ?? '') && { payee }),
        ...(categoryId &&
          categoryId !== (rule.categoryId ?? '') && {
            categoryId: categoryId as Id<'categories'>,
          }),
        ...(cadence !== rule.cadence && { cadence }),
        ...(interval !== rule.intervalCount && { intervalCount: interval }),
        ...(next !== rule.nextDueOn && { nextDueOn: next }),
        ...(until !== (rule.untilDate ?? '') && { untilDate: until }),
        // An estimate can never post itself — it waits for the real bill.
        ...((estimate ? false : autoPost) !== rule.autoPost && {
          autoPost: estimate ? false : autoPost,
        }),
        ...(note.trim() !== (rule.note ?? '') && { note }),
      })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  const unit = CADENCES.find((c) => c.id === cadence)!

  return (
    <div className="space-y-4 px-3 py-3">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount">
          <MoneyInput para={amount} onChange={setAmount} aria-label="Amount" />
        </Field>
        <Field label="Name">
          <TextInput
            value={payee}
            onChange={(e) => setPayee(e.target.value)}
            placeholder={rule.category?.name ?? rule.pot?.name ?? ''}
          />
        </Field>

        {options.length > 0 && (
          <Field label="Category">
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className={selectClass}
            >
              {!categoryId && <option value="">Choose…</option>}
              {options.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Repeats every">
          <div className="flex gap-2">
            <input
              inputMode="numeric"
              aria-label="Repeat every"
              value={every}
              onChange={(e) => setEvery(e.target.value.replace(/\D/g, '').slice(0, 3))}
              className={`${selectClass} tnum w-16 text-right`}
            />
            <select
              aria-label="Unit"
              value={cadence}
              onChange={(e) => setCadence(e.target.value as Rule['cadence'])}
              className={selectClass}
            >
              {CADENCES.map((c) => (
                <option key={c.id} value={c.id}>
                  {interval === 1 ? c.one : c.many}
                </option>
              ))}
            </select>
          </div>
        </Field>

        <Field
          label="Next on"
          hint={
            cadence === 'weekly'
              ? 'And every ' + (interval > 1 ? `${interval} weeks` : 'week') + ' on that weekday.'
              : `The ${unit.one === 'year' ? 'date' : 'day of the month'} it repeats on is read from this.`
          }
        >
          <TextInput
            type="date"
            min={today}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </Field>

        <Field label="Ends" hint="Empty: it keeps going.">
          <TextInput
            type="date"
            min={next}
            value={until}
            onChange={(e) => setUntil(e.target.value)}
          />
        </Field>

        <Field label="Note">
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>

      <div className="space-y-2">
        <label className="flex min-h-11 cursor-pointer items-start gap-3 sm:min-h-9">
          <input
            type="checkbox"
            checked={estimate}
            onChange={(e) => setEstimate(e.target.checked)}
            className="mt-1 size-4 shrink-0 accent-brand"
          />
          <span className="text-sm text-stone-800">
            The amount changes each time
            <span className="block text-xs text-stone-500">
              An estimate: it waits in Due for the real figure.
            </span>
          </span>
        </label>
        <label
          className={`flex min-h-11 items-start gap-3 sm:min-h-9 ${estimate ? 'opacity-50' : 'cursor-pointer'}`}
        >
          <input
            type="checkbox"
            checked={!estimate && autoPost}
            disabled={estimate}
            onChange={(e) => setAutoPost(e.target.checked)}
            className="mt-1 size-4 shrink-0 accent-brand"
          />
          <span className="text-sm text-stone-800">
            Record it automatically
            <span className="block text-xs text-stone-500">
              {estimate
                ? 'Not for an estimate — it needs the real amount first.'
                : 'Off, it waits in Due for you to confirm.'}
            </span>
          </span>
        </label>
      </div>

      {error && <p className="text-sm text-debt">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <FormActions
          onSave={save}
          onCancel={onDone}
          busy={busy}
          disabled={!valid}
          destructive={<span className="flex gap-2">{actions}</span>}
        />
      </div>
    </div>
  )
}
