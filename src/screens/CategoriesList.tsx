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
 * chevron expands to the transactions inside.
 *
 * Spending is always split into Needs and Wants. It used to be a toggle, off by
 * default, which meant the answer to "how much of this was unavoidable" — the
 * one question the committed/discretionary split exists to answer — was hidden
 * behind a switch most people never flipped. Both groups start open, so the
 * grouping is a heading over the categories rather than a wall to click through.
 */
export function CategoriesList({
  rows,
  paidFromFunds,
}: {
  rows: CategoryRowData[]
  paidFromFunds: number
}) {
  const [open, setOpen] = useState<Set<string>>(
    new Set(['group-Needs', 'group-Wants']),
  )
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

  return (
    <div>
      <div className="flex flex-col gap-1">
        {/* Income fills the row: it is not a share of spending, so there is no
            proportion to draw and no percentage to show. */}
        <BarRow
          share={1}
          showShare={false}
          tone="bg-lime-100"
          expanded={open.has('income')}
          onClick={() => toggle('income')}
          label="Income"
          amount={income}
        />
        {open.has('income') && <TxnList txns={incomeTxns} />}

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
 * A category row: a full-width row of text, with a tinted fill behind it whose
 * width is this category's share of the period's spending.
 *
 * The fill and the text are separate layers, and that is the whole point. When
 * the tinted block WAS the row, it had to be wide enough to hold a name — an
 * 11rem floor — so on a phone, where the row is barely wider than that floor,
 * 13% and 7% and 1% all drew the same block and the encoding said nothing. Even
 * on a wide screen it flattened everything below about a fifth into one width.
 *
 * Freed of the text, the fill can be 1.4% wide and look it. The width is
 * share-of-total, the same number the % beside it shows; normalising to the
 * largest category would make the top row always full and the bar would then
 * disagree with its own label.
 *
 * Children are indented by the rule their group draws, track and all — a
 * category's bar is read against its siblings, which share that indent, and
 * against the % printed beside it either way.
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
  showShare = true,
}: {
  share: number
  tone: string
  expanded: boolean
  onClick: () => void
  icon?: string
  iconColor?: string
  label: string
  amount: number
  /** Income is not a share of spending — it has no percentage to show. */
  showShare?: boolean
}) {
  const pct = Math.max(0, Math.min(share, 1)) * 100
  return (
    <div className="relative overflow-hidden rounded-lg">
      <div
        aria-hidden
        className={`absolute inset-y-0 left-0 ${tone}`}
        // A hairline floor so a rounding-to-zero category is still a mark
        // rather than nothing at all.
        style={{ width: `max(${pct}%, 2px)` }}
      />
      <button
        onClick={onClick}
        aria-expanded={expanded}
        className="relative flex min-h-11 w-full items-center gap-2 px-3 py-1.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand sm:min-h-9"
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
        {showShare && (
          <span data-money className="shrink-0 text-sm text-stone-500">
            {formatPercent(share)}
          </span>
        )}
        <span
          data-money
          className="w-[88px] shrink-0 text-right text-sm text-stone-800"
        >
          {formatMoney(amount)}
        </span>
      </button>
    </div>
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
      {/* One rule down the left of everything inside this group, so where a
          group ends is a line you can see rather than an indent you infer. It
          spans the categories AND any transactions opened under them. */}
      {open.has(key) && (
        <div className="ml-4 flex flex-col gap-1 border-l border-stone-200 pl-4">
          {cats.map((c) => (
            <CategoryRow
              key={c.id}
              cat={c}
              share={totalExpense > 0 ? c.total / totalExpense : 0}
              open={open}
              toggle={toggle}
            />
          ))}
        </div>
      )}
    </>
  )
}

function CategoryRow({
  cat,
  share,
  open,
  toggle,
}: {
  cat: CatAgg
  share: number
  open: Set<string>
  toggle: (k: string) => void
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
      />
      {open.has(cat.id) && <TxnList txns={cat.txns} />}
    </>
  )
}

/**
 * The transactions inside a category.
 *
 * The dashed rule is a BORDER ON THE ROW, not a divider between rows: on hover
 * the row takes a filled, rounded shape and the rule goes with it, which only
 * works if the row owns it.
 */
function TxnList({ txns }: { txns: Txn[] }) {
  return (
    <ul>
      {txns.map((t) => (
        <li
          key={t.id}
          className="flex items-center gap-2 rounded-lg border-b border-dashed border-stone-300 py-1.5 pr-3 pl-8 text-sm hover:border-transparent hover:bg-stone-100"
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
