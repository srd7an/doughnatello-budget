import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { useHousehold } from '../household/HouseholdContext'
import { Modal } from '../ui/Modal'
import { formatMoney, inputToPara, sanitizeMoneyInput } from '../lib/format'
import { CategoryIcon } from '../ui/icons'
// The one implementation of the recurrence calendar, shared with the backend so
// the date the modal promises is the date the rule generates.
import { nextDue, parseISO } from '../../convex/lib/recurrence'
import { cadenceLabel, untilDateForCount } from '../lib/recurrence'

type Direction = 'expense' | 'income' | 'transfer'

const SEGMENTS: { id: Direction; label: string }[] = [
  { id: 'expense', label: 'Expense' },
  { id: 'income', label: 'Income' },
  { id: 'transfer', label: 'Transfer' },
]

function todayISO(): string {
  const d = new Date()
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10)
}

type Repeat = 'once' | 'weekly' | 'monthly' | 'yearly'

const REPEATS: { id: Repeat; label: string }[] = [
  { id: 'once', label: 'Once' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'yearly', label: 'Yearly' },
]

/**
 * The most important screen in the app: log an expense in a few seconds.
 * Amount-focused keypad, everything else defaulted (expense · primary account ·
 * today · you). Take from lets a pot fund the spend; Paying off marks an
 * expense as an instalment against a loan, which is what makes the loan go
 * down. The two are independent — an early repayment out of savings is both.
 *
 * Repeat turns the same form into a recurring rule. Saving with a repeat set
 * records BOTH: the transaction you just entered (it happened) and a rule
 * starting at the next occurrence (it will happen again). Setting up a rule
 * must never silently skip today's money.
 */
export function AddTransactionModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { household } = useHousehold()
  const householdId = household._id

  const categories = useQuery(api.categories.list, { householdId }) ?? []
  const potBalances = useQuery(api.pots.balances, { householdId }) ?? []
  const accounts = useQuery(api.accounts.list, { householdId }) ?? []
  const create = useMutation(api.transactions.create)
  const createRule = useMutation(api.recurring.create)

  const incomeCats = categories.filter((c) => c.kind === 'income')
  const expenseCats = categories.filter((c) => c.kind !== 'income')
  const transferTargets = potBalances.filter((p) => p.kind !== 'debt')
  const fundablePots = potBalances.filter(
    (p) => p.kind !== 'debt' && p.balance > 0,
  )
  // A loan you have finished paying is not something you can pay again.
  const loans = potBalances.filter((p) => p.kind === 'debt' && (p.owed ?? 0) > 0)

  const [direction, setDirection] = useState<Direction>('expense')
  const [amountStr, setAmountStr] = useState('')
  const [categoryId, setCategoryId] = useState<Id<'categories'> | null>(null)
  const [potId, setPotId] = useState<Id<'pots'> | null>(null)
  const [takeFrom, setTakeFrom] = useState<'income' | Id<'pots'>>('income')
  // The loan this expense pays down, if it is one. Independent of takeFrom:
  // paying a loan out of a fund is both a payment and a withdrawal.
  const [paysOff, setPaysOff] = useState<Id<'pots'> | null>(null)
  const [occurredOn, setOccurredOn] = useState(todayISO())
  const [payee, setPayee] = useState('')
  const [accountId, setAccountId] = useState<Id<'accounts'> | null>(null)
  const [repeat, setRepeat] = useState<Repeat>('once')
  const [estimate, setEstimate] = useState(false)
  // How the repeat ends. Stored as an untilDate either way — "12 times" is
  // just a friendlier way of picking the date the twelfth one falls on.
  const [endMode, setEndMode] = useState<'forever' | 'on' | 'after'>('forever')
  const [endOn, setEndOn] = useState('')
  const [times, setTimes] = useState('12')
  const [saving, setSaving] = useState(false)
  const amountRef = useRef<HTMLInputElement>(null)

  // Reset to sensible defaults whenever the modal opens.
  useEffect(() => {
    if (!open) return
    setDirection('expense')
    setAmountStr('')
    setPotId(null)
    setTakeFrom('income')
    setPaysOff(null)
    setOccurredOn(todayISO())
    setPayee('')
    setAccountId(null)
    setRepeat('once')
    setEstimate(false)
    setEndMode('forever')
    setEndOn('')
    setTimes('12')
    // A frame later, so the modal has mounted and focus is not stolen back.
    requestAnimationFrame(() => amountRef.current?.focus())
  }, [open])

  // Default the category to the first relevant one so one-tap save works.
  useEffect(() => {
    if (direction === 'transfer') return
    const list = direction === 'income' ? incomeCats : expenseCats
    setCategoryId((prev) => {
      if (prev && list.some((c) => c._id === prev)) return prev
      return list[0]?._id ?? null
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direction, categories.length])

  const amountPara = inputToPara(amountStr)
  const amountDinars = amountPara / 100

  const canSave = useMemo(() => {
    if (amountDinars <= 0) return false
    if (direction === 'transfer') return !!potId
    return !!categoryId
  }, [amountDinars, direction, potId, categoryId])

  // The rule starts at the NEXT occurrence: the transaction being saved right
  // now covers this one, so generating an occurrence for it too would double it.
  const anchorDay = parseISO(occurredOn).d
  const recurrence =
    repeat === 'once'
      ? null
      : { cadence: repeat, intervalCount: 1, anchorDay }
  const ruleStartsOn = recurrence ? nextDue(occurredOn, recurrence) : null

  /**
   * The date the rule should stop.
   *
   * "Repeats 12 times" counts the transaction being entered right now as the
   * first — so the rule generates 11 more, and we walk forward to find the date
   * the last of them lands on. Storing a date rather than a count keeps one
   * source of truth: the rule already stops at untilDate.
   */
  const untilDate = (() => {
    if (!recurrence || !ruleStartsOn) return undefined
    if (endMode === 'on') return endOn || undefined
    if (endMode === 'after') {
      return untilDateForCount(
        ruleStartsOn,
        recurrence,
        Number(times),
        nextDue,
      )
    }
    return undefined
  })()

  const save = async () => {
    if (!canSave || saving) return
    setSaving(true)
    try {
      const shared = {
        householdId,
        direction,
        amount: amountPara,
        categoryId:
          direction === 'transfer' ? undefined : (categoryId ?? undefined),
        // Destination fund for a transfer; the loan being paid down for an
        // expense. The backend rejects anything else pointing at potId.
        potId:
          direction === 'transfer'
            ? (potId ?? undefined)
            : direction === 'expense'
              ? (paysOff ?? undefined)
              : undefined,
        payee: payee.trim() || undefined,
        accountId: accountId ?? undefined,
      }
      const takeFromPotId =
        direction === 'expense' && takeFrom !== 'income' ? takeFrom : undefined

      await create({ ...shared, takeFromPotId, occurredOn })

      if (repeat !== 'once' && ruleStartsOn) {
        await createRule({
          ...shared,
          fundedFromPotId: takeFromPotId,
          amountMode: estimate ? 'estimate' : 'exact',
          cadence: repeat,
          anchorDay,
          startOn: ruleStartsOn,
          untilDate,
        })
      }
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add transaction">
      {/* Direction */}
      <div className="flex rounded-xl bg-stone-100 p-1" role="tablist">
        {SEGMENTS.map((s) => (
          <button
            key={s.id}
            role="tab"
            aria-selected={direction === s.id}
            onClick={() => setDirection(s.id)}
            className={`h-10 flex-1 rounded-lg text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
              direction === s.id
                ? 'bg-white text-stone-900'
                : 'text-stone-500 hover:text-stone-700'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Amount. Looks like the figure it is, but you type straight into it —
          a borderless input rather than a keypad, which was a lot of chrome for
          something every keyboard already does. */}
      <label className="mt-6 block">
        <span className="sr-only">Amount</span>
        <span className="flex items-baseline justify-center gap-1">
          <input
            ref={amountRef}
            inputMode="decimal"
            value={amountStr}
            onChange={(e) => setAmountStr(sanitizeMoneyInput(e.target.value))}
            placeholder="0"
            aria-label="Amount"
            // Width follows the content so the figure stays centred as it grows.
            size={Math.max(amountStr.length || 1, 1)}
            className="tnum w-auto min-w-[2ch] border-0 bg-transparent p-0 text-center text-[40px] leading-none text-stone-800 outline-none placeholder:text-stone-300"
          />
          <span className="text-sm text-stone-500">
            {household.baseCurrency}
          </span>
        </span>
      </label>

      {/* Contextual fields */}
      <div className="mt-5 space-y-4">
        {direction === 'transfer' ? (
          <Field label="Into fund">
            {transferTargets.length === 0 ? (
              <p className="text-sm text-stone-400">
                Create a fund first (in Settings) to transfer into it.
              </p>
            ) : (
              <ChipRow>
                {transferTargets.map((p) => (
                  <Chip
                    key={p._id}
                    active={potId === p._id}
                    onClick={() => setPotId(p._id)}
                  >
                    <CategoryIcon icon={p.icon} size={16} color={p.color} /> {p.name}
                  </Chip>
                ))}
              </ChipRow>
            )}
          </Field>
        ) : (
          <Field label="Category">
            <ChipRow>
              {(direction === 'income' ? incomeCats : expenseCats).map((c) => (
                <Chip
                  key={c._id}
                  active={categoryId === c._id}
                  onClick={() => setCategoryId(c._id)}
                >
                  <CategoryIcon icon={c.icon} size={16} color={c.color} /> {c.name}
                </Chip>
              ))}
            </ChipRow>
          </Field>
        )}

        {/* Take from — only for expenses, only when a pot has money */}
        {direction === 'expense' && fundablePots.length > 0 && (
          <Field label="Take from">
            <ChipRow>
              <Chip
                active={takeFrom === 'income'}
                onClick={() => setTakeFrom('income')}
              >
                This month
              </Chip>
              {fundablePots.map((p) => (
                <Chip
                  key={p._id}
                  active={takeFrom === p._id}
                  onClick={() => setTakeFrom(p._id)}
                >
                  <CategoryIcon icon={p.icon} size={16} color={p.color} /> {p.name} · {formatMoney(p.balance)}
                </Chip>
              ))}
            </ChipRow>
          </Field>
        )}

        {/* Paying off — an expense can name the loan it pays down. It is still
            an ordinary expense; this only tells the loan about it. */}
        {direction === 'expense' && loans.length > 0 && (
          <Field label="Paying off">
            <ChipRow>
              <Chip active={paysOff === null} onClick={() => setPaysOff(null)}>
                Nothing
              </Chip>
              {loans.map((l) => (
                <Chip
                  key={l._id}
                  active={paysOff === l._id}
                  onClick={() => setPaysOff(l._id)}
                >
                  <CategoryIcon icon={l.icon} size={16} color={l.color} /> {l.name} ·{' '}
                  {formatMoney(l.owed ?? 0)} left
                </Chip>
              ))}
            </ChipRow>
          </Field>
        )}

        <div className="flex gap-3">
          <Field label="Payee" className="flex-1">
            <input
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
              placeholder="Optional"
              className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-violet-200"
            />
          </Field>
          <Field label="Date">
            <input
              type="date"
              value={occurredOn}
              onChange={(e) => setOccurredOn(e.target.value)}
              className="rounded-lg border border-stone-200 px-3 py-2 text-sm outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-violet-200"
            />
          </Field>
        </div>

        {/* Account — only when there is more than one, so the common case
            stays a single tap. */}
        {accounts.length > 1 && (
          <Field label="Account">
            <ChipRow>
              {accounts.map((a) => (
                <Chip
                  key={a._id}
                  active={
                    accountId === a._id || (!accountId && a.isPrimary)
                  }
                  onClick={() => setAccountId(a._id)}
                >
                  {a.name}
                </Chip>
              ))}
            </ChipRow>
          </Field>
        )}

        {/* Repeat — off by default; most transactions happen once. */}
        <Field label="Repeat">
          <ChipRow>
            {REPEATS.map((r) => (
              <Chip
                key={r.id}
                active={repeat === r.id}
                onClick={() => setRepeat(r.id)}
              >
                {r.label}
              </Chip>
            ))}
          </ChipRow>
        </Field>

        {repeat !== 'once' && ruleStartsOn && (
          <div className="rounded-xl bg-stone-50 p-3">
            <p className="text-xs text-stone-500">
              {cadenceLabel(repeat, 1, anchorDay, ruleStartsOn)} · next on{' '}
              {ruleStartsOn}. This one is saved now.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-stone-500">Ends</span>
              {(
                [
                  ['forever', 'Never'],
                  ['after', 'After'],
                  ['on', 'On'],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setEndMode(mode)}
                  aria-pressed={endMode === mode}
                  className={`min-h-8 rounded-full border px-2.5 text-xs ${
                    endMode === mode
                      ? 'border-brand bg-violet-50 text-stone-900'
                      : 'border-stone-200 text-stone-600 hover:bg-white'
                  }`}
                >
                  {label}
                </button>
              ))}

              {endMode === 'after' && (
                <span className="flex items-center gap-1.5">
                  <input
                    inputMode="numeric"
                    value={times}
                    onChange={(e) =>
                      setTimes(e.target.value.replace(/[^\d]/g, '').slice(0, 3))
                    }
                    aria-label="Number of times"
                    className="tnum w-14 rounded-lg border border-stone-200 bg-white px-2 py-1 text-right text-xs outline-none focus-visible:border-brand"
                  />
                  <span className="text-xs text-stone-500">times in total</span>
                </span>
              )}

              {endMode === 'on' && (
                <input
                  type="date"
                  value={endOn}
                  min={ruleStartsOn}
                  onChange={(e) => setEndOn(e.target.value)}
                  aria-label="Repeat until"
                  className="rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs outline-none focus-visible:border-brand"
                />
              )}
            </div>

            {untilDate && (
              <p className="mt-1.5 text-xs text-stone-500">
                Last one on {untilDate}.
              </p>
            )}

            <label className="mt-2 flex items-center gap-2 text-xs text-stone-600">
              <input
                type="checkbox"
                checked={estimate}
                onChange={(e) => setEstimate(e.target.checked)}
                className="size-4 accent-brand"
              />
              The amount varies — ask me to confirm it each time
            </label>
          </div>
        )}
      </div>

      <button
        onClick={save}
        disabled={!canSave || saving}
        className="mt-6 h-12 w-full rounded-xl bg-brand text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-40"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </Modal>
  )
}

function Field({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <label className={`block ${className ?? ''}`}>
      <span className="mb-1.5 block text-xs font-medium text-stone-400 uppercase tracking-wide">
        {label}
      </span>
      {children}
    </label>
  )
}

function ChipRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">{children}</div>
  )
}

// Colour lives on the category's icon now, not on a separate dot beside it.
function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-sm whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
        active
          ? 'border-brand bg-violet-50 text-stone-900'
          : 'border-stone-200 text-stone-600 hover:bg-stone-50'
      }`}
    >
      {children}
    </button>
  )
}
