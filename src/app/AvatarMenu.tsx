import { useHousehold } from '../household/HouseholdContext'
import { initials } from '../lib/format'

/**
 * The avatar. One tap, straight into Settings.
 *
 * It used to open a menu, and the menu was the problem: two items, and both of
 * them already live inside the thing the first one opened. Sign out is in the
 * modal's sidebar; switching household moved there too, beside it, since both
 * answer "which account am I in" rather than being sections of settings.
 *
 * So the dropdown was a stop on the way to somewhere, offering a choice that
 * was not really a choice. Now the avatar is what it looks like — a button that
 * takes you to your account.
 */
export function AvatarMenu({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { household } = useHousehold()

  return (
    <button
      onClick={onOpenSettings}
      aria-label="Settings"
      title="Settings"
      className="grid size-11 place-items-center rounded-full bg-stone-300 text-sm font-medium text-stone-800 hover:bg-stone-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:size-8"
    >
      {initials(household.displayName)}
    </button>
  )
}
