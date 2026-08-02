import { useState } from 'react'
import { formatMoney, formatPercent } from '../lib/format'
import { CaretRightIcon, CategoryIcon } from '../ui/icons'
import { dayLabel } from '../lib/dates'

export type CategoryRowData = {
  _id: string
  direction: string
  amount: number
  occurredOn: string
  payee: string | null
  categoryId: string | null
  category: { name: string; icon: string; color: string; kind: string } | null
}

type Txn = { id: string; payee: string; occurredOn: string; amount: number }
type CatAgg = {
  id: string
  name: string
  icon: string
  color: string
  kind: string
  total: number
  txns: Txn[]
}

/**
 * The Categories lens. Each category's "%" is its computed SHARE of the
 * period's total spending (not a target). A proportional bar visualises it; a
 * chevron expands to the transactions inside. "Group by needs and wants" adds a
 * Needs/Wants grouping layer. Shared by the month and (later) year views.
 */
export function CategoriesList({
  rows,
  paidFromFunds,
  grouped: groupedProp,
  onGroupedChange,
}: {
  rows: CategoryRowData[]
  paidFromFunds: number
  /** Lift the grouping toggle out when the parent renders it (the design puts
   *  it in the lens-tab row, shared by both tabs). Uncontrolled otherwise. */
  grouped?: boolean
  onGroupedChange?: (v: boolean) => void
}) {
  const [ownGrouped, setOwnGrouped] = useState(false)
  const controlled = groupedProp !== undefined && onGroupedChange !== undefined
  const grouped = controlled ? groupedProp : ownGrouped
  const setGrouped = controlled ? onGroupedChange : setOwnGrouped
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (k: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      next.has(k) ? next.delete(k) : next.add(k)
      return next
    })

  const incomeRows = rows.filter((r) => r.direction === 'income')
  const expenseRows = rows.filter((r) => r.direction === 'expense')
  const totalExpense = expenseRows.reduce((s, r) => s + r.amount, 0)
  const income = incomeRows.reduce((s, r) => s + r.amount, 0)

  if (incomeRows.length === 0 && expenseRows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-stone-200 bg-white p-8 text-center">
        <p className="text-stone-500">Nothing logged this month yet.</p>
      </div>
    )
  }

  const byCat = new Map<string, CatAgg>()
  for (const r of expenseRows) {
    const id = (r.categoryId as string) ?? 'uncategorised'
    let agg = byCat.get(id)
    if (!agg) {
      agg = {
        id,
        name: r.category?.name ?? 'Uncategorised',
        icon: r.category?.icon ?? '',
        color: r.category?.color ?? '#a8a29e',
        kind: r.category?.kind ?? 'committed',
        total: 0,
        txns: [],
      }
      byCat.set(id, agg)
    }
    agg.total += r.amount
    agg.txns.push({
      id: r._id,
      payee: r.payee || r.category?.name || '—',
      occurredOn: r.occurredOn,
      amount: r.amount,
    })
  }
  const cats = [...byCat.values()].sort((a, b) => b.total - a.total)
  const incomeTxns: Txn[] = incomeRows
    .map((r) => ({
      id: r._id,
      payee: r.payee || 'Income',
      occurredOn: r.occurredOn,
      amount: r.amount,
    }))
    .sort((a, b) => (a.occurredOn < b.occurredOn ? 1 : -1))

  const share = (total: number) => (totalExpense > 0 ? total / totalExpense : 0)

  return (
    <div>
      {!controlled && (
        <div className="mb-3 flex items-center justify-end">
          <Toggle
            on={grouped}
            onChange={setGrouped}
            label="Group by needs and wants"
          />
        </div>
      )}

      <div className="flex flex-col gap-1">
        {/* Income spans the full width — it is not a share of spending, so
            there is no bar to draw and no percentage to show. */}
        <FullRow
          tone="bg-lime-100"
          expanded={open.has('income')}
          onClick={() => toggle('income')}
          label="Income"
          amount={income}
        />
        {open.has('income') && <TxnList txns={incomeTxns} />}

        {grouped ? (
          <>
            <Group
              label="Needs"
              cats={cats.filter((c) => c.kind === 'committed')}
              totalExpense={totalExpense}
              open={open}
              toggle={toggle}
            />
            <Group
              label="Wants"
              cats={cats.filter((c) => c.kind === 'discretionary')}
              totalExpense={totalExpense}
              open={open}
              toggle={toggle}
            />
          </>
        ) : (
          cats.map((c) => (
            <CategoryRow
              key={c.id}
              cat={c}
              share={share(c.total)}
              open={open}
              toggle={toggle}
            />
          ))
        )}
      </div>

      {paidFromFunds > 0 && (
        <p className="tnum mt-2 text-sm text-stone-500">
          +{formatMoney(paidFromFunds)} paid from funds
        </p>
      )}
    </div>
  )
}

/**
 * A category row. The BAR IS THE ROW: the tinted block's width encodes this
 * category's share of the period's spending, with the figures sitting outside
 * it to the right. That is the design's mechanism, and it is more honest than
 * the tint-behind-the-row it replaced — the block's edge is a readable position
 * you can compare down the column, where a wash of colour is not.
 *
 * The width is share-of-total, the same number the % shows. Normalising to the
 * largest category would make the top row always full and the bar would then
 * disagree with its own label.
 */
function BarRow({
  share,
  tone,
  expanded,
  onClick,
  icon,
  iconColor,
  label,
  amount,
  indent = false,
}: {
  share: number
  tone: string
  expanded: boolean
  onClick: () => void
  icon?: string
  iconColor?: string
  label: string
  amount: number
  indent?: boolean
}) {
  return (
    <div className={`flex items-center gap-2 ${indent ? 'pl-6' : ''}`}>
      <div className="min-w-0 flex-1">
        <button
          onClick={onClick}
          aria-expanded={expanded}
          // A floor of 11rem so a 2% category still shows its name. Without it
          // the smallest rows collapse to an unreadable stub.
          style={{ width: `max(${Math.min(share * 100, 100)}%, 11rem)` }}
          className={`flex min-h-9 max-w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand ${tone}`}
        >
          <CaretRightIcon
            size={16}
            aria-hidden
            className={`shrink-0 text-stone-500 transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
          {icon && <CategoryIcon icon={icon} color={iconColor} className="shrink-0" />}
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-stone-800">
            {label}
          </span>
        </button>
      </div>
      <span data-money className="w-9 shrink-0 text-right text-sm text-stone-500">
        {formatPercent(share)}
      </span>
      <span
        data-money
        className="w-[100px] shrink-0 text-right text-sm text-stone-800"
      >
        {formatMoney(amount)}
      </span>
    </div>
  )
}

/** A row with no share to encode — the block spans the width, figure inside. */
function FullRow({
  tone,
  expanded,
  onClick,
  label,
  amount,
}: {
  tone: string
  expanded: boolean
  onClick: () => void
  label: string
  amount: number
}) {
  return (
    <button
      onClick={onClick}
      aria-expanded={expanded}
      className={`flex min-h-9 w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand ${tone}`}
    >
      <CaretRightIcon
        size={16}
        aria-hidden
        className={`shrink-0 text-stone-500 transition-transform ${expanded ? 'rotate-90' : ''}`}
      />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-stone-800">
        {label}
      </span>
      <span data-money className="w-[100px] text-right text-sm text-stone-800">
        {formatMoney(amount)}
      </span>
    </button>
  )
}

function Group({
  label,
  cats,
  totalExpense,
  open,
  toggle,
}: {
  label: string
  cats: CatAgg[]
  totalExpense: number
  open: Set<string>
  toggle: (k: string) => void
}) {
  const total = cats.reduce((s, c) => s + c.total, 0)
  const key = `group-${label}`
  const share = totalExpense > 0 ? total / totalExpense : 0
  return (
    <>
      <BarRow
        share={share}
        // Needs/Wants keep their own tints — this is the one view where the
        // committed/discretionary split is expressed as colour.
        tone={label === 'Needs' ? 'bg-violet-100' : 'bg-orange-100'}
        expanded={open.has(key)}
        onClick={() => toggle(key)}
        label={label}
        amount={total}
      />
      {open.has(key) &&
        cats.map((c) => (
          <CategoryRow
            key={c.id}
            cat={c}
            share={totalExpense > 0 ? c.total / totalExpense : 0}
            open={open}
            toggle={toggle}
            indent
          />
        ))}
    </>
  )
}

function CategoryRow({
  cat,
  share,
  open,
  toggle,
  indent,
}: {
  cat: CatAgg
  share: number
  open: Set<string>
  toggle: (k: string) => void
  indent?: boolean
}) {
  return (
    <>
      <BarRow
        share={share}
        tone="bg-stone-100"
        expanded={open.has(cat.id)}
        onClick={() => toggle(cat.id)}
        icon={cat.icon}
        iconColor={cat.color}
        label={cat.name}
        amount={cat.total}
        indent={indent}
      />
      {open.has(cat.id) && <TxnList txns={cat.txns} />}
    </>
  )
}

function TxnList({ txns }: { txns: Txn[] }) {
  return (
    <ul>
      {txns.map((t) => (
        <li
          key={t.id}
          className="flex items-center gap-2 border-b border-dashed border-stone-300 py-1.5 pr-3 pl-11 text-sm"
        >
          <span className="min-w-0 flex-1 truncate font-medium text-stone-800">
            {t.payee}
          </span>
          <span className="flex-1 text-stone-600">{dayLabel(t.occurredOn)}</span>
          <span data-money className="w-[100px] shrink-0 text-right text-stone-700">
            {formatMoney(t.amount)}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex items-center gap-2 text-sm text-stone-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <span
        className={`relative h-6 w-10 rounded-full transition-colors ${
          on ? 'bg-brand' : 'bg-stone-300'
        }`}
      >
        <span
          className={`absolute top-0.5 size-5 rounded-full bg-white transition-all ${
            on ? 'left-[18px]' : 'left-0.5'
          }`}
        />
      </span>
      {label}
    </button>
  )
}
