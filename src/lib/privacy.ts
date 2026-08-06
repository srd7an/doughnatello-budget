import { useSyncExternalStore } from 'react'

/**
 * Hiding the figures, for when someone is looking over your shoulder.
 *
 * Hidden every time the app opens, and NOT remembered. That is the whole
 * design: a setting that persists has to be right, and the moment it is wrong
 * it is wrong in the direction that shows your money to a room. Starting
 * covered can only ever cost one tap; starting uncovered can cost the thing
 * this exists to protect. There is also nothing to restore, so nothing that can
 * be restored late — the figures are never briefly visible on a slow start.
 *
 * This is a CURTAIN, not a lock. The numbers are already in the page, blurred
 * in CSS and readable to anyone who opens the developer tools. It defends
 * against a person beside you on a tram, which is the threat it is for, and
 * against nothing else. A real lock has to act before the data is fetched — see
 * the note on locking the app.
 *
 * State lives outside React so the toggle and the page cannot disagree, and so
 * the attribute is on <html> before the first paint rather than a frame after.
 */

const listeners = new Set<() => void>()
let hidden = true

/** The attribute the stylesheet keys off. */
function apply(value: boolean) {
  document.documentElement.toggleAttribute('data-private', value)
}

export function setHidden(value: boolean) {
  hidden = value
  apply(value)
  for (const l of listeners) l()
}

/** Called once at startup, before React renders. */
export function initPrivacy() {
  apply(hidden)
}

export function usePrivacy(): { hidden: boolean; toggle: () => void } {
  const value = useSyncExternalStore(
    (notify) => {
      listeners.add(notify)
      return () => listeners.delete(notify)
    },
    () => hidden,
    () => true,
  )
  return { hidden: value, toggle: () => setHidden(!value) }
}
