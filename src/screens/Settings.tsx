import { Link } from 'react-router-dom'
import { useAuthActions } from '@convex-dev/auth/react'
import { useHousehold } from '../household/HouseholdContext'

/**
 * CONFIG, not flow or stock — no period control, no figures. Settings is a
 * directory: one subject per panel, grouped so the money things sit together and
 * the household things sit together.
 */
const SECTIONS: { group: string; items: { label: string; to: string }[] }[] = [
  {
    group: 'Your money',
    items: [
      { label: 'Account & bank', to: 'account' },
      { label: 'Funds', to: 'funds' },
      { label: 'Assets', to: 'assets' },
      { label: 'Loans', to: 'loans' },
    ],
  },
  {
    group: 'Organising',
    items: [
      { label: 'Categories', to: 'categories' },
      { label: 'Repeating', to: 'repeating' },
    ],
  },
  {
    group: 'Household',
    items: [
      { label: 'People', to: 'people' },
      { label: 'Invites', to: 'invites' },
    ],
  },
  {
    group: 'App',
    items: [
      { label: 'Currency & format', to: 'format' },
      { label: 'Export', to: 'export' },
    ],
  },
]

export function Settings() {
  const { household } = useHousehold()
  const { signOut } = useAuthActions()

  return (
    <div className="space-y-6">
      <section>
        {/* Settings is a dead end without this — the period control that
            normally navigates is hidden here. */}
        <Link
          to="/"
          className="text-sm text-stone-500 hover:text-stone-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          ← Home
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">Settings</h1>
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
                <li key={item.label} className="border-b border-stone-100 last:border-b-0">
                  <Link
                    to={item.to}
                    className="flex min-h-11 items-center px-4 text-sm text-stone-700 hover:bg-stone-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
                  >
                    <span className="flex-1">{item.label}</span>
                    <span aria-hidden className="text-stone-300">
                      ›
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}

        {/* Sign out is an action, not a panel, so it sits on its own. */}
        <button
          onClick={() => void signOut()}
          className="flex min-h-11 w-full items-center rounded-xl border border-stone-200 bg-white px-4 text-sm text-stone-700 hover:bg-stone-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
