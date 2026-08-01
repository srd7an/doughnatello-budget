import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { useHousehold } from '../household/HouseholdContext'
import { Modal } from '../ui/Modal'
import { formatMoney, toPara } from '../lib/format'
import { categoryEmoji } from '../lib/categoryIcon'
// The one implementation of the recurrence calendar, shared with the backend so
// the date the modal promises is the date the rule generates.
import { nextDue, parseISO } from '../../convex/lib/recurrence'
import { cadenceLabel } from '../lib/recurrence'

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
 * today · you). Take from lets a pot fund the spend.
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
  const create = useMutation(api.transactions.create)
  const createRule = useMutation(api.recurring.create)

  const incomeCats = categories.filter((c) => c.kind === 'income')
  const expenseCats = categories.filter((c) => c.kind !== 'income')
  const transferTargets = potBalances.filter((p) => p.kind !== 'debt')
  const fundablePots = potBalances.filter(
    (p) => p.kind !== 'debt' && p.balance > 0,
  )

  const [direction, setDirection] = useState<Direction>('expense')
  const [amountStr, setAmountStr] = useState('')
  const [categoryId, setCategoryId] = useState<Id<'categories'> | null>(null)
  const [potId, setPotId] = useState<Id<'pots'> | null>(null)
  const [takeFrom, setTakeFrom] = useState<'income' | Id<'pots'>>('income')
  const [occurredOn, setOccurredOn] = useState(todayISO())
  const [payee, setPayee] = useState('')
  const [repeat, setRepeat] = useState<Repeat>('once')
  const [estimate, setEstimate] = useState(false)
  const [saving, setSaving] = useState(false)

  // Reset to sensible defaults whenever the modal opens.
  useEffect(() => {
    if (!open) return
    setDirection('expense')
    setAmountStr('')
    setPotId(null)
    setTakeFrom('income')
    setOccurredOn(todayISO())
    setPayee('')
    setRepeat('once')
    setEstimate(false)
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

  const amountDinars = Number(amountStr || '0')
  const amountPara = toPara(amountDinars)

  const canSave = useMemo(() => {
    if (amountDinars <= 0) return false
    if (direction === 'transfer') return !!potId
    return !!categoryId
  }, [amountDinars, direction, potId, categoryId])

  const press = (key: string) => {
    setAmountStr((s) => {
      if (key === 'back') return s.slice(0, -1)
      if (s.length >= 9) return s // cap
      if (s === '' && key === '0') return s
      return s + key
    })
  }

  // The rule starts at the NEXT occurrence: the transaction being saved right
  // now covers this one, so generating an occurrence for it too would double it.
  const anchorDay = parseISO(occurredOn).d
  const ruleStartsOn =
    repeat === 'once'
      ? null
      : nextDue(occurredOn, { cadence: repeat, intervalCount: 1, anchorDay })

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
        potId: direction === 'transfer' ? (potId ?? undefined) : undefined,
        payee: payee.trim() || undefined,
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

      {/* Amount */}
      <div className="mt-5 text-center tnum">
        <span className="text-4xl font-semibold tracking-tight">
          {formatMoney(amountPara)}
        </span>
        <span className="ml-1 text-sm text-stone-400">RSD</span>
      </div>

      {/* Keypad */}
      <div className="mt-4 grid grid-cols-3 gap-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0', 'back'].map(
          (k) => (
            <button
              key={k}
              onClick={() => (k === '000' ? ['0', '0', '0'].forEach(press) : press(k))}
              aria-label={k === 'back' ? 'Delete' : k}
              className="h-12 rounded-xl bg-stone-50 text-lg font-medium text-stone-800 hover:bg-stone-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
            >
              {k === 'back' ? '⌫' : k}
            </button>
          ),
        )}
      </div>

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
                    color={p.color}
                    onClick={() => setPotId(p._id)}
                  >
                    {categoryEmoji(p.icon)} {p.name}
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
                  color={c.color}
                  onClick={() => setCategoryId(c._id)}
                >
                  {categoryEmoji(c.icon)} {c.name}
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
                  color={p.color}
                  onClick={() => setTakeFrom(p._id)}
                >
                  {categoryEmoji(p.icon)} {p.name} · {formatMoney(p.balance)}
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

function Chip({
  active,
  color,
  onClick,
  children,
}: {
  active: boolean
  color?: string
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
      {color && (
        <span
          aria-hidden
          className="size-2 rounded-full"
          style={{ backgroundColor: color }}
        />
      )}
      {children}
    </button>
  )
}
