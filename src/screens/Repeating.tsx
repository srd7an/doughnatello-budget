import { useMutation, useQuery } from 'convex/react'
import { Link } from 'react-router-dom'
import { api } from '../../convex/_generated/api'
import { useHousehold } from '../household/HouseholdContext'
import { formatMoney } from '../lib/format'
import { categoryEmoji } from '../lib/categoryIcon'
import { localISO } from '../lib/dates'
import { cadenceLabel, dueLabel } from '../lib/recurrence'

/**
 * The list of repeating rules — the "what is set up" view, as opposed to the
 * Due block's "what needs settling now".
 *
 * Rules are created from the Add-transaction modal (Repeat), so this screen only
 * needs to show, pause and delete them. Paused rules sink to the bottom rather
 * than disappearing: pausing is meant to be reversible and visible.
 */
export function Repeating() {
  const { household } = useHousehold()
  const rules = useQuery(api.recurring.listRules, { householdId: household._id })
  const setActive = useMutation(api.recurring.setActive)
  const remove = useMutation(api.recurring.remove)
  const today = localISO(new Date())

  return (
    <div className="space-y-5">
      <section>
        <Link
          to=".."
          relative="path"
          className="text-sm text-stone-500 hover:text-stone-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          ← Settings
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">Repeating</h1>
        <p className="mt-1 text-sm text-stone-500">
          Money that comes back every month. Set one up from Add transaction →
          Repeat.
        </p>
      </section>

      {rules === undefined ? (
        <p className="py-8 text-center text-sm text-stone-400">Loading…</p>
      ) : rules.length === 0 ? (
        <p className="rounded-xl border border-dashed border-stone-200 bg-white p-6 text-center text-sm text-stone-500">
          Nothing repeats yet.
        </p>
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
          {rules.map((r) => {
            const label =
              r.payee ?? r.category?.name ?? r.pot?.name ?? 'Repeating'
            const icon = r.category?.icon ?? r.pot?.icon
            return (
              <li key={r._id} className="border-b border-stone-100 p-4 last:border-b-0">
                <div className="flex items-start gap-3">
                  <span aria-hidden className="text-lg">
                    {icon ? categoryEmoji(icon) : '🔁'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <span className="truncate">{label}</span>
                      {!r.isActive && <Tag>Paused</Tag>}
                      {r.autoPost && <Tag>Automatic</Tag>}
                      {r.amountMode === 'estimate' && <Tag>Estimate</Tag>}
                    </p>
                    <p className="mt-0.5 text-xs text-stone-400">
                      {cadenceLabel(
                        r.cadence,
                        r.intervalCount,
                        r.anchorDay,
                        r.nextDueOn,
                      )}
                      {r.isActive && ` · ${dueLabel(r.nextDueOn, today)}`}
                      {r.fundedFromPot && ` · from ${r.fundedFromPot.name}`}
                    </p>
                  </div>
                  <span
                    data-money
                    className={`text-sm font-semibold ${
                      r.direction === 'income' ? 'text-saved' : ''
                    }`}
                  >
                    {r.direction === 'income' ? '+' : ''}
                    {formatMoney(r.amount)}
                  </span>
                </div>

                <div className="mt-2 flex gap-2 pl-8">
                  <button
                    onClick={() =>
                      setActive({ ruleId: r._id, isActive: !r.isActive })
                    }
                    className="min-h-9 rounded-full border border-stone-200 px-3 text-sm text-stone-600 hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                  >
                    {r.isActive ? 'Pause' : 'Resume'}
                  </button>
                  <button
                    onClick={() => remove({ ruleId: r._id })}
                    className="min-h-9 rounded-full px-3 text-sm text-stone-500 hover:bg-stone-50 hover:text-debt focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                  >
                    Delete
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <p className="px-1 text-xs text-stone-400">
        Deleting a rule stops it repeating. Transactions it already created stay
        — that money happened.
      </p>
    </div>
  )
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-normal text-stone-500">
      {children}
    </span>
  )
}
