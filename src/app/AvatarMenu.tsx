import { useEffect, useRef, useState } from 'react'
import { useAuthActions } from '@convex-dev/auth/react'
import { useHousehold } from '../household/HouseholdContext'
import { initials } from '../lib/format'
import { CheckIcon } from '../ui/icons'

/**
 * Avatar → menu. Settings lives here (visited twice a year, no permanent nav
 * slot), alongside a household switcher when there's more than one, and sign
 * out.
 */
export function AvatarMenu({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { household, all, setActive } = useHousehold()
  const { signOut } = useAuthActions()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="grid size-8 place-items-center rounded-full bg-stone-300 text-sm font-medium text-stone-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        {initials(household.displayName)}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-56 rounded-xl border border-stone-200 bg-white p-1"
        >
          {all.length > 1 && (
            <>
              <p className="px-3 pt-2 pb-1 text-xs text-stone-400">Households</p>
              {all.map((h) => (
                <button
                  key={h._id}
                  role="menuitemradio"
                  aria-checked={h._id === household._id}
                  onClick={() => {
                    setActive(h._id)
                    setOpen(false)
                  }}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-stone-50"
                >
                  {h.name}
                  {h._id === household._id && (
                    <CheckIcon size={16} className="text-brand" aria-hidden />
                  )}
                </button>
              ))}
              <div className="my-1 border-t border-stone-100" />
            </>
          )}

          <MenuItem
            onClick={() => {
              onOpenSettings()
              setOpen(false)
            }}
          >
            Settings
          </MenuItem>
          <MenuItem onClick={() => void signOut()}>Sign out</MenuItem>
        </div>
      )}
    </div>
  )
}

function MenuItem({
  onClick,
  children,
}: {
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      {children}
    </button>
  )
}
