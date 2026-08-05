import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { useHousehold } from '../household/HouseholdContext'
import {
  formatMoney,
  inputToPara,
  paraToInput,
  sanitizeMoneyInput,
} from '../lib/format'
import { formatDayMonthYear } from '../lib/dates'
import { ConvexError } from 'convex/values'
import { CalendarDotsIcon, QrCodeIcon, RepeatIcon, XIcon } from '../ui/icons'
import { QrScanner } from '../ui/QrScanner'
import { hexDump, parseQr, toPrefill, type Scan } from '../lib/qr'
import { Button } from '../ui/Button'
import { Popover } from '../ui/Popover'
import {
  PickerRow,
  PILL,
  Row,
  SkeletonRow,
  TextRow,
} from './TransactionRows'
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

/**
 * The sentence a rule was written with.
 *
 * Convex delivers a ConvexError's payload to the client and replaces a plain
 * Error with "Server Error", so the rules a person can break by filling this
 * form in are thrown as ConvexError and read back here. Anything else was not
 * written for a human and gets the fallback.
 */
function reason(e: unknown, fallback: string): string {
  if (e instanceof ConvexError && typeof e.data === 'string') return e.data
  return fallback
}

function todayISO(): string {
  const d = new Date()
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10)
}

type Repeat = 'once' | 'weekly' | 'monthly' | 'yearly'

/** What each direction's rows are called, for the placeholder that stands in
 *  for them. Only the count and the labels matter — the values are what is
 *  still arriving. */
const SKELETON: Record<Direction, string[]> = {
  expense: ['Category', 'Payee', 'Pay from', 'Paying off', 'Repeat', 'Note'],
  income: ['Category', 'Payee', 'Repeat', 'Note'],
  transfer: ['Payee', 'Pay from', 'Into', 'Repeat', 'Note'],
}

const REPEATS: { id: Repeat; label: string }[] = [
  { id: 'once', label: 'Once' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'yearly', label: 'Yearly' },
]

/**
 * The one transaction form. Adding and editing are the same screen because they
 * are the same question — how much, what for, out of what — and two forms that
 * ask it differently is how "I can change the category but not the fund" gets
 * shipped without anyone deciding to.
 *
 * Everything the add form can set, the edit form can change: direction,
 * category, the fund a spend comes out of, the loan it pays down, the fund a
 * transfer lands in. Editing re-derives the funding rows from scratch, so a
 * change of fund or amount cannot leave a stale split behind.
 *
 * The two genuine differences, both because they cannot mean anything here:
 *  - Repeat is add-only. It creates a RULE beside the transaction; an existing
 *    transaction has nothing to repeat, and rules are edited in Repeating.
 *  - Editing shows how the money was actually funded, and offers Delete. Both
 *    need a transaction to exist first.
 */
export function TransactionForm({
  transactionId,
  copyOf,
  onDone,
}: {
  transactionId?: Id<'transactions'>
  /**
   * Start from an existing transaction without being that transaction.
   *
   * Everything is prefilled except the DATE, which is today: you are recording
   * that the same thing happened again, and the one date you certainly do not
   * mean is the old one. Saving creates; nothing is written to the original.
   */
  copyOf?: Id<'transactions'>
  onDone: () => void
}) {
  const { household } = useHousehold()
  const householdId = household._id
  const isEdit = transactionId !== undefined
  const navigate = useNavigate()
  const location = useLocation()

  // Stop asking the moment it is on its way out. Deleting leaves the form
  // mounted for the instant before the route changes, and `detail` is reactive:
  // it would re-run against an id that no longer resolves, throw, and take the
  // screen with it. Skipping is how a query says "never mind".
  const [deleting, setDeleting] = useState(false)
  const source = transactionId ?? copyOf
  const detail = useQuery(
    api.transactions.detail,
    source && !deleting ? { transactionId: source } : 'skip',
  )
  const categoryList = useQuery(api.categories.list, { householdId })
  const potList = useQuery(api.pots.balances, { householdId })
  const accountList = useQuery(api.accounts.list, { householdId })
  const categories = categoryList ?? []
  const potBalances = potList ?? []
  const accounts = accountList ?? []
  // Everything the ROWS need. The header, the date and the amount need none of
  // it, so they are drawn straight away — the amount is the first thing anyone
  // types, and making it wait on a query for a list of funds would be absurd.
  const ready =
    categoryList !== undefined &&
    potList !== undefined &&
    accountList !== undefined &&
    (source === undefined || detail !== undefined)
  const create = useMutation(api.transactions.create)
  const update = useMutation(api.transactions.update)
  const remove = useMutation(api.transactions.remove)
  const createRule = useMutation(api.recurring.create)

  const incomeCats = categories.filter((c) => c.kind === 'income')
  const expenseCats = categories.filter((c) => c.kind !== 'income')
  const transferTargets = potBalances.filter((p) => p.kind !== 'debt')
  // A loan you have finished paying is not something you can pay again — but
  // one this transaction already pays stays listed, so it can be unset.
  const loans = potBalances.filter(
    (p) => p.kind === 'debt' && ((p.owed ?? 0) > 0 || p._id === detail?.potId),
  )

  const [direction, setDirection] = useState<Direction>('expense')
  const [amountStr, setAmountStr] = useState('')
  const [categoryId, setCategoryId] = useState<Id<'categories'> | null>(null)
  const [potId, setPotId] = useState<Id<'pots'> | null>(null)
  const [takeFrom, setTakeFrom] = useState<'income' | Id<'pots'>>('income')
  // Transfers: where the money comes from. 'income' is the ordinary "set some
  // aside"; a fund makes it a move of money that was already set aside once.
  const [from, setFrom] = useState<'income' | Id<'pots'>>('income')
  // The loan this expense pays down, if it is one. Independent of takeFrom:
  // paying a loan out of a fund is both a payment and a withdrawal.
  const [paysOff, setPaysOff] = useState<Id<'pots'> | null>(null)
  const [occurredOn, setOccurredOn] = useState(todayISO())
  const [payee, setPayee] = useState('')
  const [note, setNote] = useState('')
  const [accountId, setAccountId] = useState<Id<'accounts'> | null>(null)
  const [repeat, setRepeat] = useState<Repeat>('once')
  const [estimate, setEstimate] = useState(false)
  // How the repeat ends. Stored as an untilDate either way — "12 times" is
  // just a friendlier way of picking the date the twelfth one falls on.
  const [endMode, setEndMode] = useState<'forever' | 'on' | 'after'>('forever')
  const [endOn, setEndOn] = useState('')
  const [times, setTimes] = useState('12')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const amountRef = useRef<HTMLInputElement>(null)
  const [scanning, setScanning] = useState(false)
  // What a scan produced when it could not be turned into an amount. Kept so
  // the code can be LOOKED AT rather than silently discarded — which is how
  // the fiscal receipt layout gets worked out at all.
  const [scan, setScan] = useState<Scan | null>(null)

  // Load the transaction being edited into the form. Keyed on its id, so
  // opening a different one reloads rather than merging.
  useEffect(() => {
    if (!detail) return
    setDirection(detail.direction)
    setAmountStr(paraToInput(detail.amount))
    setCategoryId(detail.categoryId)
    setPotId(detail.direction === 'transfer' ? detail.potId : null)
    setPaysOff(detail.direction === 'expense' ? detail.potId : null)
    setFrom(detail.fromPotId ?? 'income')
    // On a move the pot-funded row is the source, not a spend it came out of.
    setTakeFrom(
      detail.direction === 'transfer'
        ? 'income'
        : (detail.funding.find((f) => f.potId)?.potId ?? 'income'),
    )
    // A copy happens today; only an edit keeps the original's date.
    if (isEdit) setOccurredOn(detail.occurredOn)
    setPayee(detail.payee ?? '')
    setNote(detail.note ?? '')
    setAccountId(detail.accountId)
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?._id])

  // Adding: focus the amount, because that is always the first thing typed.
  // Editing: leave focus alone — the field you came to change is rarely it.
  // A copy is an add, but its amount is already filled in and is the single
  // most likely thing to differ, so it gets the focus too.
  useEffect(() => {
    if (isEdit) return
    const id = requestAnimationFrame(() => amountRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [isEdit])

  // Default the category to the first relevant one so one-tap save works. It
  // runs when editing too: switching an existing expense to income has to drop
  // a category that no longer belongs to it, not save income as Grocery.
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

  // Only the funds that could actually pay — plus the one already paying, so
  // an edit does not silently drop it when the fund runs dry.
  const fundablePots = potBalances.filter(
    (p) => p.kind !== 'debt' && (p.balance > 0 || p._id === takeFrom),
  )

  // Every fund can be moved out of, empty or not: a move may leave a fund
  // owed, which is how "I spent it and will put it back" is written down.
  const sourceFunds = potBalances.filter((p) => p.kind !== 'debt')
  // A fund cannot move money to itself, so the chosen source leaves the list.
  const destinations = transferTargets.filter((p) => p._id !== from)

  // A transfer needs at least one end: into a fund (saving or a move), or out
  // of one (releasing it back to the balance).
  const valid =
    amountPara > 0 &&
    (direction === 'transfer' ? !!potId || from !== 'income' : !!categoryId)

  // What the form would save, flattened — compared against the same shape read
  // back off the transaction, so Save is dead until something really changed.
  const shape = [
    direction,
    amountPara,
    categoryId ?? '',
    direction === 'transfer' ? (potId ?? '') : '',
    direction === 'transfer' ? from : 'income',
    direction === 'expense' ? takeFrom : 'income',
    direction === 'expense' ? (paysOff ?? '') : '',
    occurredOn,
    payee.trim(),
    note.trim(),
    accountId ?? '',
  ].join('|')
  const savedShape = detail
    ? [
        detail.direction,
        detail.amount,
        detail.categoryId ?? '',
        detail.direction === 'transfer' ? (detail.potId ?? '') : '',
        detail.direction === 'transfer' ? (detail.fromPotId ?? 'income') : 'income',
        detail.direction === 'expense'
          ? (detail.funding.find((f) => f.potId)?.potId ?? 'income')
          : 'income',
        detail.direction === 'expense' ? (detail.potId ?? '') : '',
        detail.occurredOn,
        detail.payee ?? '',
        detail.note ?? '',
        detail.accountId,
      ].join('|')
    : null
  const dirty = !isEdit || shape !== savedShape

  const canSave = ready && valid && dirty && !saving

  // The rule starts at the NEXT occurrence: the transaction being saved right
  // now covers this one, so generating an occurrence for it too would double it.
  const anchorDay = parseISO(occurredOn).d
  const recurrence =
    repeat === 'once' ? null : { cadence: repeat, intervalCount: 1, anchorDay }
  const ruleStartsOn = recurrence ? nextDue(occurredOn, recurrence) : null

  /**
   * The date the rule should stop.
   *
   * "Repeats 12 times" counts the transaction being entered right now as the
   * first — so the rule generates 11 more, and we walk forward to find the date
   * the last of them lands on. Storing a date rather than a count keeps one
   * source of truth: the rule already stops at untilDate.
   */
  const untilDate = useMemo(() => {
    if (!recurrence || !ruleStartsOn) return undefined
    if (endMode === 'on') return endOn || undefined
    if (endMode === 'after') {
      return untilDateForCount(ruleStartsOn, recurrence, Number(times), nextDue) ?? undefined
    }
    return undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repeat, anchorDay, ruleStartsOn, endMode, endOn, times])

  /**
   * "1 time" means this one and no more, so there is no rule to write.
   *
   * The count includes the transaction being saved now, which makes 1 a
   * perfectly reasonable thing to type and a perfectly useless rule to create.
   * It used to be clamped up to 2 and quietly repeated once.
   */
  const repeatsAtAll =
    repeat !== 'once' && !(endMode === 'after' && Number(times) < 2)

  const save = async () => {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const shared = {
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
        accountId: accountId ?? undefined,
      }
      const takeFromPotId =
        direction === 'expense' && takeFrom !== 'income' ? takeFrom : undefined
      const fromPotId =
        direction === 'transfer' && from !== 'income' ? from : undefined

      if (transactionId) {
        // The clear flags say "no longer any", which an absent field cannot:
        // update keeps what it is not told about, so that a rename does not
        // wipe the funding.
        await update({
          transactionId,
          ...shared,
          occurredOn,
          takeFromPotId,
          fromPotId,
          clearPotFunding: !takeFromPotId,
          clearLoan: !shared.potId || direction !== 'expense',
          clearFromPot: !fromPotId,
          clearDestination: direction === 'transfer' && !shared.potId,
          // Empty means empty here — the field was cleared on purpose.
          payee: payee.trim(),
          note: note.trim(),
        })
      } else {
        const text = {
          payee: payee.trim() || undefined,
          note: note.trim() || undefined,
        }
        await create({
          householdId,
          ...shared,
          ...text,
          takeFromPotId,
          fromPotId,
          occurredOn,
        })
        if (repeatsAtAll && ruleStartsOn) {
          await createRule({
            householdId,
            ...shared,
            ...text,
            fundedFromPotId: takeFromPotId,
            amountMode: estimate ? 'estimate' : 'exact',
            cadence: repeat,
            anchorDay,
            startOn: ruleStartsOn,
            untilDate,
          })
        }
      }
      onDone()
    } catch (e) {
      setError(reason(e, 'Could not save'))
    } finally {
      setSaving(false)
    }
  }

  const catOptions = (direction === 'income' ? incomeCats : expenseCats).map(
    (c) => ({ key: c._id, icon: c.icon, color: c.color, text: c.name, value: c._id }),
  )
  const chosenCat = categories.find((c) => c._id === categoryId)
  const chosenTakeFrom = potBalances.find((p) => p._id === takeFrom)
  const chosenFrom = potBalances.find((p) => p._id === from)
  const chosenInto = potBalances.find((p) => p._id === potId)
  const chosenLoan = potBalances.find((p) => p._id === paysOff)
  const repeatLabel = REPEATS.find((r) => r.id === repeat)!.label

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-6 px-6 py-5">
        {/* Direction. Plain words, not a segmented control: there are three of
            them, they are always visible, and the chosen one is simply the
            one that is dark. */}
        <div className="flex items-center gap-3">
          <div
            className="flex min-w-0 flex-1 items-center gap-3 text-base font-medium tracking-[-0.16px]"
            role="tablist"
          >
            {SEGMENTS.map((s) => (
              <button
                key={s.id}
                role="tab"
                aria-selected={direction === s.id}
                onClick={() => setDirection(s.id)}
                className={`rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                  direction === s.id
                    ? 'text-stone-800'
                    : 'text-stone-500 hover:text-stone-700'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <button
            onClick={onDone}
            aria-label="Close"
            className="grid size-11 shrink-0 place-items-center rounded-full text-stone-600 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:size-8"
          >
            <XIcon size={20} aria-hidden />
          </button>
        </div>

        {/* Date sits above the amount and carries no label — it is when this
            happened, which is part of the headline, not one of the fields. */}
        <div className="flex items-center gap-1.5">
          <label className={`${PILL} relative cursor-pointer`}>
            <CalendarDotsIcon size={16} aria-hidden />
            {formatDayMonthYear(occurredOn)}
            <input
              type="date"
              value={occurredOn}
              aria-label="Date"
              onChange={(e) => setOccurredOn(e.target.value || occurredOn)}
              onClick={(e) => e.currentTarget.showPicker?.()}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>

          {/* Scanning fills the amount, so it belongs on the headline beside
              the date rather than down among the fields. Editing is left out:
              a code describes a purchase, and re-reading one over a
              transaction that already exists is not a thing anyone does. */}
          {!isEdit && (
            <button
              type="button"
              onClick={() => {
                setScan(null)
                setScanning(true)
              }}
              className={`${PILL} shrink-0`}
              aria-label="Scan a QR code"
            >
              <QrCodeIcon size={16} aria-hidden />
              Scan
            </button>
          )}
        </div>

        {/* The amount is the headline: you type straight into it. */}
        {/* The label wraps for click-to-focus, but the NAME is on the input:
            the currency sits inside the same label, so reading the label's
            text gave "Amount RSD". */}
        <label className="flex items-baseline gap-1">
          <input
            ref={amountRef}
            aria-label="Amount"
            inputMode="decimal"
            value={amountStr}
            onChange={(e) => setAmountStr(sanitizeMoneyInput(e.target.value))}
            placeholder="0"
            data-money
            className="min-w-px flex-1 border-0 bg-transparent p-0 text-[40px] leading-8 tracking-[-0.8px] text-stone-900 outline-none placeholder:text-stone-400"
          />
          <span className="shrink-0 text-sm text-stone-600">
            {household.baseCurrency}
          </span>
        </label>

        {/* A code was read but carried no amount we are willing to trust. It is
            shown rather than swallowed: for a fiscal receipt this dump IS the
            specification, and copying one from a real receipt is how the layout
            gets decoded. */}
        {scan && (
          <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium text-stone-800">
                {scan.kind === 'fiscal'
                  ? 'Fiscal receipt — amount not readable yet'
                  : 'Scanned, but not a payment code'}
              </p>
              <button
                type="button"
                onClick={() => setScan(null)}
                aria-label="Dismiss"
                className="grid size-8 shrink-0 place-items-center rounded-full text-stone-500 hover:bg-stone-200"
              >
                <XIcon size={16} aria-hidden />
              </button>
            </div>
            <p className="mt-1 text-xs text-stone-500">
              {scan.kind === 'fiscal'
                ? 'Type the total in yourself for now. Copy what is below and this will learn to read it.'
                : 'Nothing here looked like an amount.'}
            </p>
            <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-white p-2 text-[10px] leading-tight whitespace-pre text-stone-600">
              {scan.kind === 'fiscal' && scan.bytes
                ? `${scan.url}\n\n${hexDump(scan.bytes)}`
                : scan.raw}
            </pre>
            <button
              type="button"
              onClick={() => {
                const text =
                  scan.kind === 'fiscal' && scan.bytes
                    ? `${scan.url}\n\n${hexDump(scan.bytes)}`
                    : scan.raw
                navigator.clipboard?.writeText(text)
              }}
              className="mt-2 text-xs text-brand hover:underline"
            >
              Copy
            </button>
          </div>
        )}

        <div className="flex flex-col">
          {!ready ? (
            // As many rows as this direction will end up with, so the card is
            // already the height it is about to be.
            SKELETON[direction].map((label, i) => (
              <SkeletonRow key={label} label={label} first={i === 0} />
            ))
          ) : (
            <>
          {direction !== 'transfer' && (
            <PickerRow
              first
              label="Category"
              value={
                chosenCat
                  ? { icon: chosenCat.icon, color: chosenCat.color, text: chosenCat.name }
                  : null
              }
              options={catOptions}
              onPick={setCategoryId}
            />
          )}

          <TextRow
            first={direction === 'transfer'}
            label="Payee"
            value={payee}
            onChange={setPayee}
            placeholder="Enter payee"
          />

          {/* Where the money comes from. On an expense it is a fund it is
              spent out of; on a transfer, a fund it is moved out of. Both
              default to this month. */}
          {direction === 'expense' && fundablePots.length > 0 && (
            <PickerRow
              label="Pay from"
              value={{
                icon: chosenTakeFrom?.icon,
                color: chosenTakeFrom?.color,
                text: chosenTakeFrom?.name ?? "Month's income",
              }}
              options={[
                { key: 'income', text: "Month's income", value: 'income' as const },
                ...fundablePots.map((p) => ({
                  key: p._id,
                  icon: p.icon,
                  color: p.color,
                  text: p.name,
                  hint: formatMoney(p.balance),
                  value: p._id,
                })),
              ]}
              onPick={setTakeFrom}
            />
          )}

          {direction === 'transfer' && sourceFunds.length > 0 && (
            <PickerRow
              label="Pay from"
              value={{
                icon: chosenFrom?.icon,
                color: chosenFrom?.color,
                text: chosenFrom?.name ?? "Month's income",
              }}
              options={[
                { key: 'income', text: "Month's income", value: 'income' as const },
                ...sourceFunds.map((p) => ({
                  key: p._id,
                  icon: p.icon,
                  color: p.color,
                  text: p.name,
                  hint: formatMoney(p.balance),
                  value: p._id,
                })),
              ]}
              onPick={(v: 'income' | Id<'pots'>) => {
                setFrom(v)
                if (potId === v) setPotId(null)
              }}
            />
          )}

          {direction === 'transfer' && (
            <PickerRow
              label="Into"
              value={
                chosenInto
                  ? { icon: chosenInto.icon, color: chosenInto.color, text: chosenInto.name }
                  : from !== 'income'
                    ? { text: 'Nothing — free it up' }
                    : null
              }
              emptyAction="Fund"
              options={[
                ...destinations.map((p) => ({
                  key: p._id,
                  icon: p.icon,
                  color: p.color,
                  text: p.name,
                  value: p._id as Id<'pots'> | null,
                })),
                ...(from !== 'income'
                  ? [{ key: 'none', text: 'Nothing — free it up', value: null }]
                  : []),
              ]}
              onPick={setPotId}
            />
          )}

          {/* A loan this expense pays down. Unset it is an action, not an
              empty field — there is nothing to show, only something to do. */}
          {direction === 'expense' && loans.length > 0 && (
            <PickerRow
              label="Paying off"
              value={
                chosenLoan
                  ? { icon: chosenLoan.icon, color: chosenLoan.color, text: chosenLoan.name }
                  : null
              }
              emptyAction="Loan"
              options={[
                { key: 'none', text: 'Nothing', value: null },
                ...loans.map((l) => ({
                  key: l._id,
                  icon: l.icon,
                  color: l.color,
                  text: l.name,
                  hint: formatMoney(l.owed ?? 0),
                  value: l._id as Id<'pots'> | null,
                })),
              ]}
              onPick={setPaysOff}
            />
          )}

          {/* Repeat is one row and a whole panel: the cadence, when it ends,
              and whether the amount is a guess. All of it belongs to the same
              decision, so all of it lives behind the same pill. */}
          {!isEdit && (
            <Row label="Repeat">
              <Popover
                label="Repeat"
                align="right"
                triggerClassName={PILL}
                trigger={
                  <>
                    <RepeatIcon size={16} aria-hidden />
                    {repeatLabel}
                  </>
                }
              >
                {() => (
                  <div className="w-64 p-1">
                    <ul>
                      {REPEATS.map((r) => (
                        <li key={r.id}>
                          <button
                            type="button"
                            onClick={() => setRepeat(r.id)}
                            aria-pressed={repeat === r.id}
                            className={`flex min-h-11 w-full items-center rounded-lg px-2 text-left text-sm hover:bg-stone-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand sm:min-h-9 ${
                              repeat === r.id ? 'text-stone-900' : 'text-stone-600'
                            }`}
                          >
                            {r.label}
                          </button>
                        </li>
                      ))}
                    </ul>

                    {repeat !== 'once' && ruleStartsOn && (
                      <div className="mt-2 border-t border-stone-100 pt-2">
                        <p className="px-2 text-xs text-stone-500">
                          {cadenceLabel(repeat, 1, anchorDay, ruleStartsOn)} · next
                          on {ruleStartsOn}. This one is saved now.
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2 px-2">
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
                              className={`min-h-11 rounded-full border px-2.5 text-xs sm:min-h-8 ${
                                endMode === mode
                                  ? 'border-brand bg-violet-50 text-stone-900'
                                  : 'border-stone-200 text-stone-600 hover:bg-stone-50'
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
                                  setTimes(
                                    e.target.value.replace(/[^\d]/g, '').slice(0, 3),
                                  )
                                }
                                aria-label="Number of times"
                                data-money
                                className="w-14 rounded-lg border border-stone-200 bg-white px-2 py-1 text-right text-xs outline-none focus-visible:border-brand"
                              />
                              <span className="text-xs text-stone-500">times</span>
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
                          <p className="mt-1.5 px-2 text-xs text-stone-500">
                            Last one on {untilDate}.
                          </p>
                        )}
                        {endMode === 'after' && !repeatsAtAll && (
                          <p className="mt-1.5 px-2 text-xs text-stone-500">
                            Once is just this one — nothing will repeat.
                          </p>
                        )}
                        <label className="mt-2 flex items-center gap-2 px-2 text-xs text-stone-600">
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
                )}
              </Popover>
            </Row>
          )}

          <TextRow
            label="Note"
            value={note}
            onChange={setNote}
            placeholder="Enter note"
          />

          {/* Accounts only when there is more than one, so the common case
              stays one fewer row. */}
          {accounts.length > 1 && (
            <PickerRow
              label="Account"
              value={{
                text:
                  accounts.find((a) => a._id === accountId)?.name ??
                  accounts.find((a) => a.isPrimary)?.name ??
                  '—',
              }}
              options={accounts.map((a) => ({
                key: a._id,
                text: a.name,
                value: a._id,
              }))}
              onPick={setAccountId}
            />
          )}
            </>
          )}
        </div>

        {/* How it was actually funded. Derived at the moment it was recorded,
            so it is reported, never typed — and the only place a split across
            two sources is visible. */}
        {detail && detail.funding.length > 1 && (
          <div className="rounded-xl bg-stone-50 p-3">
            <p className="text-xs font-medium tracking-wide text-stone-400 uppercase">
              Paid from
            </p>
            <ul className="mt-1 space-y-0.5">
              {detail.funding.map((f, i) => (
                <li
                  key={i}
                  className="flex justify-between text-xs text-stone-600"
                >
                  <span>{f.potName ?? 'This month'}</span>
                  <span data-money>{formatMoney(f.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <p className="text-sm text-debt">{error}</p>}
      </div>

      {scanning && (
        <QrScanner
          onClose={() => setScanning(false)}
          onRead={(text) => {
            setScanning(false)
            const result = parseQr(text)
            const prefill = toPrefill(result)
            if (prefill) {
              if (prefill.amount) setAmountStr(paraToInput(prefill.amount))
              // Only fill an empty payee: a code read second must not wipe what
              // you typed first.
              if (prefill.payee) setPayee((p) => p || prefill.payee!)
              // A receipt knows the day it happened, and it is often not today.
              if (prefill.occurredOn) setOccurredOn(prefill.occurredOn)
              setScan(null)
            } else {
              setScan(result)
            }
          }}
        />
      )}

      <div className="flex flex-col gap-2 px-4 pb-4">
        <Button variant="primary" full onClick={save} disabled={!canSave}>
          {saving ? 'Saving…' : 'Save'}
        </Button>

        {/* The same thing happened again. Everything carries over except the
            date, which is today — see `copyOf`. It leaves the original alone,
            so it sits above Delete rather than beside it. */}
        {transactionId && (
          <Button
            variant="secondary"
            full
            onClick={() => {
              // Carries the period across as every other jump does, and adds
              // the one thing this jump is about.
              const params = new URLSearchParams(location.search)
              params.set('copy', transactionId)
              navigate({ pathname: '/add', search: params.toString() })
            }}
          >
            Duplicate
          </Button>
        )}

        {transactionId && (
          <Button
            variant="danger"
            full
            onClick={async () => {
              if (!confirmDelete) {
                setConfirmDelete(true)
                return
              }
              setDeleting(true)
              try {
                await remove({ transactionId })
                onDone()
              } catch (e) {
                setDeleting(false)
                setConfirmDelete(false)
                setError(reason(e, 'Could not delete'))
              }
            }}
            onBlur={() => setConfirmDelete(false)}
          >
            {confirmDelete ? 'Yes, delete it' : 'Delete'}
          </Button>
        )}
      </div>
    </div>
  )
}
