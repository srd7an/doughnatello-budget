import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import {
  formatMonth,
  formatMoney,
  formatPercent,
  initials,
} from '../lib/format'
import { dayLabel } from '../lib/dates'
import { ArrowRightIcon, CategoryIcon } from '../ui/icons'

/**
 * One fund or one loan, in full.
 *
 * It is a PAGE, not a modal, because it has history to scroll and a place of
 * its own to come back to. It is also the one screen the period control does
 * not govern: a fund's balance is all of time, so the header gives up that slot
 * for a way back (see AppShell).
 *
 * Editing is not here. A fund's name, target and icon are CONFIG, and config
 * lives in Settings — so Edit walks you there, to the panel that already knows
 * how to change them, rather than growing a second form that would drift from
 * the first.
 */
export function PotPage() {
  const { potId } = useParams<{ potId: string }>()
  const navigate = useNavigate()
  const pot = useQuery(
    api.pots.detail,
    potId ? { potId: potId as Id<'pots'> } : 'skip',
  )

  if (pot === undefined) {
    return <p className="py-8 text-center text-sm text-stone-400">Loading…</p>
  }

  const isLoan = pot.kind === 'debt'
  // A loan counts down to zero, a fund counts up to its target. Both are "how
  // far along am I", so both draw the same bar.
  const goal = isLoan ? (pot.originalAmount ?? 0) : (pot.targetAmount ?? 0)
  const progress = isLoan
    ? goal > 0
      ? (goal - (pot.owed ?? 0)) / goal
      : null
    : goal > 0
      ? pot.balance / goal
      : null

  // Newest first, grouped by the month it happened in — a fund's history is
  // read in months, not days.
  const groups: { month: string; rows: typeof pot.rows }[] = []
  for (const row of pot.rows) {
    const month = row.occurredOn.slice(0, 7)
    const last = groups.at(-1)
    if (last && last.month === month) last.rows.push(row)
    else groups.push({ month, rows: [row] })
  }

  return (
    <div className="space-y-6">
      <section>
        <p className="flex items-center gap-2 text-sm text-stone-500">
          <CategoryIcon icon={pot.icon} color={pot.color} className="shrink-0" />
          {pot.name}
          {pot.isArchived && (
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">
              Archived
            </span>
          )}
        </p>
        <p className="tnum mt-1">
          <span
            className={`text-[32px] leading-none ${isLoan ? 'text-debt' : 'text-stone-800'}`}
          >
            {formatMoney(isLoan ? (pot.owed ?? 0) : pot.balance)}
          </span>
          <span className="ml-2 text-sm text-stone-500">
            {isLoan ? 'still owed' : 'set aside'}
          </span>
        </p>

        {progress !== null && (
          <div className="mt-3">
            <div className="h-2 overflow-hidden rounded-full bg-stone-100">
              <div
                className={`h-full rounded-full ${isLoan ? 'bg-debt' : 'bg-saved'}`}
                style={{
                  width: `${Math.max(0, Math.min(progress, 1)) * 100}%`,
                }}
              />
            </div>
            <p className="tnum mt-1.5 text-xs text-stone-500">
              {formatPercent(Math.max(0, Math.min(progress, 1)))}{' '}
              {isLoan ? 'paid off' : 'of'} {!isLoan && formatMoney(goal)}
              {!isLoan && pot.targetDate && ` by ${pot.targetDate}`}
            </p>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-8">
          {isLoan ? (
            <>
              <Fact label="Borrowed" value={formatMoney(pot.originalAmount ?? 0)} />
              <Fact
                label="Paid so far"
                value={formatMoney((pot.originalAmount ?? 0) - (pot.owed ?? 0))}
              />
              {pot.interestRate !== null && (
                <Fact label="Interest" value={`${pot.interestRate}%`} />
              )}
              {pot.minimumPayment !== null && (
                <Fact label="Minimum" value={formatMoney(pot.minimumPayment)} />
              )}
            </>
          ) : (
            <Fact label="Movements" value={String(pot.rows.length)} />
          )}
        </div>

        <button
          onClick={() =>
            navigate(`/settings/${isLoan ? 'loans' : 'funds'}/${pot._id}`)
          }
          className="mt-4 flex min-h-11 items-center rounded-full border border-stone-200 px-4 text-sm text-stone-700 hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:min-h-9"
        >
          Edit in settings
        </button>
      </section>

      <section>
        <h2 className="mb-3 text-base font-medium tracking-[-0.16px] text-stone-800">
          Everything that touched it
        </h2>
        {groups.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-stone-200 bg-white p-8 text-center">
            <p className="text-stone-500">Nothing yet.</p>
            <p className="mt-1 text-sm text-stone-400">
              {isLoan
                ? 'Record a payment as an expense and tag it with this loan.'
                : 'Transfer into it from Add transaction.'}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map((g) => (
              <div key={g.month}>
                <h3 className="mb-1 text-xs tracking-[0.24px] text-stone-600 uppercase">
                  {formatMonth(Number(g.month.slice(0, 4)), Number(g.month.slice(5, 7)))}
                </h3>
                <ul className="flex flex-col gap-1">
                  {g.rows.map((row) => (
                    <li key={row._id}>
                      <button
                        onClick={() => navigate(`/transactions/${row._id}`)}
                        className="flex min-h-11 w-full items-center gap-2 border-b border-dashed border-stone-300 px-3 py-1.5 text-left hover:rounded-lg hover:border-transparent hover:bg-stone-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand sm:min-h-9"
                      >
                        <CategoryIcon
                          icon={row.category?.icon ?? row.pot?.icon}
                          color={row.category?.color ?? row.pot?.color ?? '#a8a29e'}
                          className="shrink-0"
                        />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-stone-800">
                          {row.payee || row.category?.name || row.pot?.name || '—'}
                        </span>
                        <span className="hidden shrink-0 text-xs text-stone-500 sm:block">
                          {dayLabel(row.occurredOn)}
                        </span>
                        {/* What this row did TO this fund, which is the only
                            reason it is on this page. */}
                        <span className="hidden shrink-0 items-center gap-1 rounded-md border border-stone-300 bg-white px-1.5 py-0.5 text-xs text-stone-800 sm:inline-flex">
                          {effect(row, pot._id)}
                        </span>
                        <span
                          aria-label={`Paid by ${row.paidByName}`}
                          title={row.paidByName}
                          className="grid size-5 shrink-0 place-items-center rounded-full bg-stone-200 text-[10px] font-medium text-stone-600"
                        >
                          {initials(row.paidByName)}
                        </span>
                        <span
                          data-money
                          className={`w-[100px] shrink-0 text-right text-sm ${
                            row.direction === 'income'
                              ? 'text-gain'
                              : 'text-stone-800'
                          }`}
                        >
                          {row.direction === 'expense' ? '−' : ''}
                          {formatMoney(row.amount)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

/**
 * How a row touched THIS fund. The same transaction reads differently on a
 * different fund's page — a move is "out" on one and "in" on the other — which
 * is why it is worked out here rather than stored on the row.
 */
function effect(
  row: {
    direction: string
    potId: string | null
    fromPotId: string | null
    fundedFromPotId: string | null
  },
  potId: string,
) {
  if (row.direction === 'transfer') {
    if (row.fromPotId === potId) {
      return (
        <>
          Out <ArrowRightIcon size={12} aria-hidden />
        </>
      )
    }
    return 'In'
  }
  if (row.fundedFromPotId === potId) return 'Spent from it'
  if (row.potId === potId) return 'Payment'
  return ''
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm text-stone-500">{label}</p>
      <p data-money className="mt-0.5 text-sm text-stone-800">
        {value}
      </p>
    </div>
  )
}
