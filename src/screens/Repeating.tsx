import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useHousehold } from '../household/HouseholdContext'
import { formatMoney } from '../lib/format'
import { CategoryIcon, RepeatIcon } from '../ui/icons'
import { localISO } from '../lib/dates'
import { cadenceLabel, dueLabel } from '../lib/recurrence'
import {
  Card,
  ConfirmButton,
  Empty,
  GhostButton,
  Loading,
  Note,
  Panel,
} from './settings/kit'

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
  const rules = useQuery(api.recurring.listRules, {
    householdId: household._id,
  })
  const setActive = useMutation(api.recurring.setActive)
  const remove = useMutation(api.recurring.remove)
  const today = localISO(new Date())

  return (
    <Panel
      title="Repeating"
      description="Money that comes back every month. Set one up from Add transaction → Repeat."
    >
      {rules === undefined ? (
        <Loading />
      ) : rules.length === 0 ? (
        <Empty>Nothing repeats yet.</Empty>
      ) : (
        <Card className="overflow-hidden">
          <ul>
            {rules.map((r) => {
              const label =
                r.payee ?? r.category?.name ?? r.pot?.name ?? 'Repeating'
              const icon = r.category?.icon ?? r.pot?.icon
              return (
                <li
                  key={r._id}
                  className="border-b border-stone-100 p-4 last:border-b-0"
                >
                  <div className="flex items-start gap-3">
                    {icon ? (
                      <CategoryIcon icon={icon} />
                    ) : (
                      <RepeatIcon size={20} aria-hidden />
                    )}
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
                        r.direction === 'income' ? 'text-gain' : ''
                      }`}
                    >
                      {r.direction === 'income' ? '+' : ''}
                      {formatMoney(r.amount)}
                    </span>
                  </div>

                  <div className="mt-2 flex items-center gap-2 pl-8">
                    <GhostButton
                      onClick={() =>
                        setActive({ ruleId: r._id, isActive: !r.isActive })
                      }
                    >
                      {r.isActive ? 'Pause' : 'Resume'}
                    </GhostButton>
                    <ConfirmButton
                      label="Delete"
                      confirmLabel="Delete it"
                      onConfirm={() => remove({ ruleId: r._id })}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      <Note>
        Deleting a rule stops it repeating. Transactions it already created stay
        — that money happened.
      </Note>
    </Panel>
  )
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-normal text-stone-500">
      {children}
    </span>
  )
}
