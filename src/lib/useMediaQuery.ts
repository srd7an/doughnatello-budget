import { useSyncExternalStore } from 'react'

/**
 * Whether a media query matches, as state.
 *
 * Used where the two layouts are genuinely different COMPONENTS rather than
 * different styling — the add form is a popover in the header on a desktop and
 * a sheet at the root of the page on a phone, and those cannot both be mounted
 * and hidden with a class: one of them has to not exist.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', notify)
      return () => mql.removeEventListener('change', notify)
    },
    () => window.matchMedia(query).matches,
    () => false, // server / first paint: assume the phone, the narrower case
  )
}

/** Tailwind's `sm` breakpoint, which is where this app changes its mind. */
export const SM = '(min-width: 40rem)'
