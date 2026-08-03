import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useHousehold } from '../household/HouseholdContext'
import { formatMoney } from '../lib/format'
import { CategoryIcon, RepeatIcon } from '../ui/icons'
import { localISO } from '../lib/dates'
import { cadenceLabel, dueLabel } from '../lib/recurrence'
import {
  ConfirmButton,
  EditRow,
  Empty,
  GhostButton,
  ItemRow,
  Loading,
  Note,
  Panel,
  Rows,
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
  const [open, setOpen] = useState<string | null>(null)
  const remove = useMutation(api.recurring.remove)
  const today = localISO(new Date())

  return (
    <Panel
      description="Money that comes back every month. Set one up from Add transaction → Repeat."
    >
      {rules === undefined ? (
        <Loading />
      ) : rules.length === 0 ? (
        <Empty>Nothing repeats yet.</Empty>
      ) : (
        <Rows>
          {rules.map((r) => {
            const label = r.payee ?? r.category?.name ?? r.pot?.name ?? 'Repeating'
            const icon = r.category?.icon ?? r.pot?.icon
            const meta = [
              cadenceLabel(r.cadence, r.intervalCount, r.anchorDay, r.nextDueOn),
              r.isActive && dueLabel(r.nextDueOn, today),
              r.fundedFromPot && `from ${r.fundedFromPot.name}`,
            ]
              .filter(Boolean)
              .join(' · ')

            // Open, like every other list in Settings, rather than carrying its
            // controls at rest. Revealing them on hover was the tempting middle
            // way and it is the wrong one: a phone has no hover, so Pause and
            // Delete would simply not exist on the device most likely to be
            // holding this screen.
            if (open === r._id) {
              return (
                <EditRow key={r._id}>
                  <div className="space-y-3 px-3 py-2">
                    <div className="flex items-center gap-2">
                      {icon ? (
                        <CategoryIcon
                          icon={icon}
                          color={r.category?.color ?? r.pot?.color}
                          className="shrink-0"
                        />
                      ) : (
                        <RepeatIcon size={20} aria-hidden className="shrink-0" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-stone-800">
                        {label}
                      </span>
                      <span
                        data-money
                        className={`shrink-0 text-sm ${
                          r.direction === 'income' ? 'text-gain' : 'text-stone-800'
                        }`}
                      >
                        {r.direction === 'income' ? '+' : ''}
                        {formatMoney(r.amount)}
                      </span>
                    </div>
                    <p className="text-xs text-stone-400">{meta}</p>
                    <div className="flex items-center gap-2">
                      <GhostButton
                        onClick={() =>
                          setActive({ ruleId: r._id, isActive: !r.isActive })
                        }
                      >
                        {r.isActive ? 'Pause' : 'Resume'}
                      </GhostButton>
                      <GhostButton onClick={() => setOpen(null)}>Close</GhostButton>
                      <span className="ml-auto">
                        <ConfirmButton
                          label="Delete"
                          confirmLabel="Yes, delete it"
                          onConfirm={async () => {
                            await remove({ ruleId: r._id })
                            setOpen(null)
                          }}
                        />
                      </span>
                    </div>
                  </div>
                </EditRow>
              )
            }

            return (
              <ItemRow
                key={r._id}
                icon={icon ?? 'schedule'}
                color={r.category?.color ?? r.pot?.color}
                name={label}
                muted={!r.isActive}
                tags={
                  <>
                    {!r.isActive && <Tag>Paused</Tag>}
                    {r.autoPost && <Tag>Automatic</Tag>}
                    {r.amountMode === 'estimate' && <Tag>Estimate</Tag>}
                  </>
                }
                meta={meta}
                figure={`${r.direction === 'income' ? '+' : ''}${formatMoney(r.amount)}`}
                figureClass={`${
                  r.direction === 'income' ? 'text-gain' : 'text-stone-800'
                } ${r.isActive ? '' : 'opacity-50'}`}
                onClick={() => setOpen(r._id)}
              />
            )
          })}
        </Rows>
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
