import { useState } from 'react'
import { Link } from 'react-router-dom'
import { formatMoney, formatPercent } from '../lib/format'
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
  /** What it is going towards — a fund's target, a loan's original amount. */
  goal?: number | null
}

type Groups = { funds: StockItem[]; loans: StockItem[]; assets: StockItem[] }
type Kind = keyof Groups

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
 *
 * Each tab says what is behind it. Three words in a row told you nothing until
 * you pressed each and added up the cards yourself; the total is the first
 * thing anyone wants from "Loans", and now it is on the tab.
 */
export function StockTabs({
  groups,
  period,
}: {
  groups: Groups
  /** How to say what `change` covers: "this month", "in October", "this year". */
  period: string
}) {
  const [tab, setTab] = useState<Kind>('funds')
  const keepPeriod = useKeepPeriod()
  const items = groups[tab]

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-start gap-5" role="tablist">
        {TABS.map((t) => {
          // Loans are stored negative and read as what is owed. A fund is
          // NOT made positive: one that has been overdrawn is below zero, and
          // a total that hides that is a total that is wrong.
          const total = groups[t.key].reduce(
            (s, i) => s + (t.key === 'loans' ? Math.abs(i.balance) : i.balance),
            0,
          )
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`flex min-h-11 flex-col items-start justify-center text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                tab === t.key ? 'text-stone-800' : 'text-stone-500 hover:text-stone-700'
              }`}
            >
              <span className="text-base font-medium tracking-[-0.16px]">
                {t.label}
              </span>
              {/* Under the word rather than beside it: three totals in a row
                  with their labels is wider than a phone, and a tab bar that
                  wraps stops looking like one. A figure, so lighter than the
                  word — it is not what the tab is called, it is how much is
                  in it. */}
              {groups[t.key].length > 0 && (
                <span data-money className="text-xs text-stone-400">
                  {formatMoney(total, { whole: true })}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-stone-400">Nothing here yet.</p>
      ) : (
        // One line, always, bleeding to the screen edges so a card can scroll
        // out from under the page's padding rather than stopping short of it.
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
          {items.map((it) => (
            <Card
              key={it._id}
              item={it}
              kind={tab}
              period={period}
              to={keepPeriod(
                `/${tab === 'assets' ? 'assets' : 'funds'}/${it._id}`,
              )}
            />
          ))}
        </div>
      )}
    </section>
  )
}

/**
 * One thing you have, or owe.
 *
 * The card read "+38.400 / 5.232.000": two figures and a slash, and what each
 * was is something you had to already know. On a loan it was worse than
 * unlabelled — a green-ish plus beside a debt reads as the debt growing, and it
 * was the month's repayment. So the standing figure leads, alone, and the
 * period's movement is a sentence under it that says which way the money went:
 * set aside, taken out, paid off.
 *
 * Where there is somewhere to get to — a fund's target, a loan's original
 * amount — a bar shows how far along it is, with the share in words beside it.
 */
function Card({
  item,
  kind,
  period,
  to,
}: {
  item: StockItem
  kind: Kind
  period: string
  to: { pathname: string; search: string }
}) {
  // What is owed, as a plain figure — the sign has moved into the word beside
  // it. A fund keeps its sign: below zero is overdrawn, and says so.
  const standing = kind === 'loans' ? Math.abs(item.balance) : item.balance
  const moved = Math.abs(item.change)

  const movement =
    item.change === 0
      ? `No change ${period}`
      : kind === 'loans'
        ? `${formatMoney(moved, { whole: true })} paid off ${period}`
        : kind === 'funds'
          ? item.change > 0
            ? `+${formatMoney(moved, { whole: true })} set aside ${period}`
            : `${formatMoney(-moved, { whole: true })} taken out ${period}`
          : `${formatMoney(item.change, { signed: true, whole: true })} ${period}`

  // How far along: of a fund's target, what is in it; of a loan, what has been
  // paid. Nothing when there is no goal — a bar to nowhere is decoration.
  const goal = item.goal && item.goal > 0 ? item.goal : null
  const progress =
    goal === null
      ? null
      : Math.min(
          1,
          Math.max(0, kind === 'loans' ? (goal - standing) / goal : standing / goal),
        )

  return (
    <Link
      to={to}
      className="flex w-[240px] shrink-0 items-start gap-3 rounded-xl border border-stone-200 px-3 py-2.5 hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <span
        aria-hidden
        className="grid size-9 shrink-0 place-items-center rounded-full"
        style={{ backgroundColor: `${item.color}1f` }}
      >
        <CategoryIcon icon={item.icon} color={item.color} size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-stone-800">
          {item.name}
        </span>
        <span data-money className="block truncate text-base text-stone-800">
          {formatMoney(standing, { whole: true })}
          {kind === 'loans' && (
            <span className="ml-1 text-xs text-stone-400">owed</span>
          )}
        </span>
        <span
          data-money
          className={`block truncate text-xs ${
            item.change > 0 && kind !== 'loans' ? 'text-gain' : 'text-stone-500'
          }`}
        >
          {movement}
        </span>
        {progress !== null && goal !== null && (
          <span className="mt-1.5 block">
            <span
              aria-hidden
              className="block h-1 overflow-hidden rounded-full bg-stone-100"
            >
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${progress * 100}%`,
                  backgroundColor: item.color,
                }}
              />
            </span>
            <span data-money className="mt-1 block truncate text-xs text-stone-400">
              {formatPercent(progress)}{' '}
              {kind === 'loans' ? 'paid off' : `of ${formatMoney(goal, { whole: true })}`}
            </span>
          </span>
        )}
      </span>
    </Link>
  )
}
