import { useState } from 'react'
import { formatMoney, formatPercent } from '../lib/format'
import { categoryEmoji } from '../lib/categoryIcon'
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
}: {
  rows: CategoryRowData[]
  paidFromFunds: number
}) {
  const [grouped, setGrouped] = useState(false)
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
      <div className="mb-3 flex items-center justify-end">
        <Toggle
          on={grouped}
          onChange={setGrouped}
          label="Group by needs and wants"
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-stone-200">
        {/* Income */}
        <RowShell tint="#bef264" bg="bg-lime-50">
          <RowButton
            expanded={open.has('income')}
            onClick={() => toggle('income')}
            leading={<span className="font-medium">Income</span>}
            trailing={
              <span data-money className="font-semibold">
                {formatMoney(income)}
              </span>
            }
          />
        </RowShell>
        {open.has('income') && <TxnList txns={incomeTxns} />}

        {grouped ? (
          <>
            <Group
              label="Needs"
              bg="bg-stone-50"
              cats={cats.filter((c) => c.kind === 'committed')}
              totalExpense={totalExpense}
              open={open}
              toggle={toggle}
            />
            <Group
              label="Wants"
              bg="bg-orange-50"
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

function Group({
  label,
  bg,
  cats,
  totalExpense,
  open,
  toggle,
}: {
  label: string
  bg: string
  cats: CatAgg[]
  totalExpense: number
  open: Set<string>
  toggle: (k: string) => void
}) {
  const total = cats.reduce((s, c) => s + c.total, 0)
  const key = `group-${label}`
  return (
    <>
      <RowShell
        tint={label === 'Needs' ? '#534AB7' : '#f59e0b'}
        bg={bg}
        share={totalExpense > 0 ? total / totalExpense : 0}
      >
        <RowButton
          expanded={open.has(key)}
          onClick={() => toggle(key)}
          leading={<span className="font-medium">{label}</span>}
          trailing={
            <Amounts
              share={totalExpense > 0 ? total / totalExpense : 0}
              amount={total}
            />
          }
        />
      </RowShell>
      {open.has(key) &&
        cats.map((c) => (
          <div key={c.id} className="pl-4">
            <CategoryRow
              cat={c}
              share={totalExpense > 0 ? c.total / totalExpense : 0}
              open={open}
              toggle={toggle}
            />
          </div>
        ))}
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
      <RowShell tint={cat.color} share={share}>
        <RowButton
          expanded={open.has(cat.id)}
          onClick={() => toggle(cat.id)}
          leading={
            <span className="flex items-center gap-2">
              <span aria-hidden>{categoryEmoji(cat.icon)}</span>
              <span className="font-medium">{cat.name}</span>
            </span>
          }
          trailing={<Amounts share={share} amount={cat.total} />}
        />
      </RowShell>
      {open.has(cat.id) && <TxnList txns={cat.txns} />}
    </>
  )
}

function Amounts({ share, amount }: { share: number; amount: number }) {
  return (
    <span className="tnum flex items-center gap-3">
      <span className="text-sm text-stone-400">{formatPercent(share)}</span>
      <span className="w-20 text-right font-medium">{formatMoney(amount)}</span>
    </span>
  )
}

/** A row with a proportional bar behind it (share of total). */
function RowShell({
  tint,
  bg,
  share,
  children,
}: {
  tint?: string
  bg?: string
  share?: number
  children: React.ReactNode
}) {
  return (
    <div className={`relative border-b border-stone-100 last:border-b-0 ${bg ?? ''}`}>
      {share !== undefined && share > 0 && (
        <div
          aria-hidden
          className="absolute inset-y-0 left-0"
          style={{
            width: `${Math.min(share * 100, 100)}%`,
            backgroundColor: `${tint ?? '#a8a29e'}22`,
          }}
        />
      )}
      <div className="relative">{children}</div>
    </div>
  )
}

function RowButton({
  expanded,
  onClick,
  leading,
  trailing,
}: {
  expanded: boolean
  onClick: () => void
  leading: React.ReactNode
  trailing: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-expanded={expanded}
      className="flex min-h-11 w-full items-center gap-2 px-4 text-left text-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
    >
      <span
        aria-hidden
        className="w-3 shrink-0 text-xs text-stone-400"
      >
        {expanded ? '▾' : '▸'}
      </span>
      <span className="min-w-0 flex-1 truncate">{leading}</span>
      {trailing}
    </button>
  )
}

function TxnList({ txns }: { txns: Txn[] }) {
  return (
    <ul className="bg-white">
      {txns.map((t) => (
        <li
          key={t.id}
          className="flex items-center gap-2 border-b border-stone-100 py-2 pr-4 pl-9 text-sm text-stone-600 last:border-b-0"
        >
          <span className="min-w-0 flex-1 truncate">{t.payee}</span>
          <span className="text-xs text-stone-400">{dayLabel(t.occurredOn)}</span>
          <span data-money className="w-20 text-right">
            {formatMoney(t.amount)}
          </span>
        </li>
      ))}
    </ul>
  )
}

function Toggle({
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
