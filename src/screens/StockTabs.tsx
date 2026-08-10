import { useState } from 'react'
import { Link } from 'react-router-dom'
import { formatMoney } from '../lib/format'
import { CategoryIcon } from '../ui/icons'
import { useKeepPeriod } from '../period/PeriodContext'

export type StockItem = {
  _id: string
  name: string
  icon: string
  color: string
  /** Where it stands now. Loans are negative — that is what owing looks like. */
  balance: number
  /** What this period did to it. */
  change: number
}

type Groups = { funds: StockItem[]; loans: StockItem[]; assets: StockItem[] }

const TABS = [
  { key: 'funds', label: 'Funds' },
  { key: 'loans', label: 'Loans' },
  { key: 'assets', label: 'Assets' },
] as const

/**
 * What you HAVE, as three tabs of cards — the same block on the month and on
 * the year, differing only in what `change` is measured over.
 *
 * It replaced a table of Change and Total columns on the year and a row of
 * chips on the month, which were two answers to one question. A card carries
 * both figures without a column to align, which is what let the same component
 * serve a 350px phone and an 800px page: cards scroll sideways, columns cannot.
 *
 * Tabs rather than three stacked lists because these are alternatives, not a
 * sequence. Nobody reads their funds and then their loans; you look at one.
 */
export function StockTabs({ groups }: { groups: Groups }) {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('funds')
  const keepPeriod = useKeepPeriod()
  const items = groups[tab]

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center gap-3" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`min-h-11 text-base font-medium tracking-[-0.16px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:min-h-9 ${
              tab === t.key ? 'text-stone-800' : 'text-stone-500 hover:text-stone-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-stone-400">Nothing here yet.</p>
      ) : (
        // One line, always, bleeding to the screen edges so a card can scroll
        // out from under the page's padding rather than stopping short of it.
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
          {items.map((it) => (
            <Card key={it._id} item={it} keepPeriod={keepPeriod} />
          ))}
        </div>
      )}
    </section>
  )
}

function Card({
  item,
  keepPeriod,
}: {
  item: StockItem
  keepPeriod: (p: string) => { pathname: string; search: string }
}) {
  // Loans are stored negative — owing 900.000 is −900.000 — and a card reading
  // "−900.000" beside a name is right but hard, so the sign moves into the
  // meaning: what you owe, as a plain figure.
  const owed = item.balance < 0
  const total = Math.abs(item.balance)
  const up = item.change > 0

  return (
    <Link
      to={keepPeriod(`/funds/${item._id}`)}
      className="flex min-w-[220px] shrink-0 items-center gap-3 rounded-xl border border-stone-200 px-3 py-2.5 hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <span
        aria-hidden
        className="grid size-9 shrink-0 place-items-center rounded-full"
        style={{ backgroundColor: `${item.color}1f` }}
      >
        <CategoryIcon icon={item.icon} color={item.color} size={20} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-stone-800">
          {item.name}
        </span>
        <span data-money className="block text-sm">
          <span className={up && !owed ? 'text-gain' : 'text-stone-500'}>
            {up ? '+' : ''}
            {formatMoney(item.change)}
          </span>
          <span className="text-stone-400"> / {formatMoney(total)}</span>
        </span>
      </span>
    </Link>
  )
}
