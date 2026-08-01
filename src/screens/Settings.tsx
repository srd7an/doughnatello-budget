import { Link } from 'react-router-dom'
import { useHousehold } from '../household/HouseholdContext'
import { Scaffolded } from '../ui/Swatch'

// CONFIG, not flow or stock — no period control. Grouped as Your money /
// Organising / Household / App. Items with a `to` are built; the rest become
// editable detail panels in Phase 10.
type Item = { label: string; to?: string }

const SECTIONS: { group: string; items: Item[] }[] = [
  {
    group: 'Your money',
    items: [
      { label: 'Account & bank' },
      { label: 'Funds' },
      { label: 'Assets' },
      { label: 'Loans' },
    ],
  },
  {
    group: 'Organising',
    items: [
      { label: 'Categories' },
      { label: 'Repeating', to: 'repeating' },
    ],
  },
  { group: 'Household', items: [{ label: 'People' }, { label: 'Invites' }] },
  {
    group: 'App',
    items: [
      { label: 'Currency & format' },
      { label: 'Export' },
      { label: 'Sign out' },
    ],
  },
]

export function Settings() {
  const { household } = useHousehold()

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-stone-500">
          {household.name} · you are {household.role === 'admin' ? 'an admin' : 'a member'}
        </p>
      </section>

      <div className="space-y-5">
        {SECTIONS.map((section) => (
          <section key={section.group}>
            <h2 className="mb-2 text-xs font-medium tracking-wide text-stone-400 uppercase">
              {section.group}
            </h2>
            <ul className="overflow-hidden rounded-xl border border-stone-200 bg-white">
              {section.items.map((item) => (
                <li
                  key={item.label}
                  className="border-b border-stone-100 last:border-b-0"
                >
                  {item.to ? (
                    <Link
                      to={item.to}
                      className="flex min-h-11 items-center px-4 text-sm text-stone-700 hover:bg-stone-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
                    >
                      <span className="flex-1">{item.label}</span>
                      <span aria-hidden className="text-stone-300">
                        ›
                      </span>
                    </Link>
                  ) : (
                    <span className="flex min-h-11 items-center px-4 text-sm text-stone-400">
                      {item.label}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <Scaffolded>
        The greyed sections become editable detail panels in Phase 10.
      </Scaffolded>
    </div>
  )
}
