import { useSyncExternalStore } from 'react'

/**
 * Hiding the figures, for when someone is looking over your shoulder.
 *
 * This is a CURTAIN, not a lock. The numbers are already in the page — blurred
 * in CSS, readable to anyone who opens the developer tools. It defends against
 * a person beside you on a tram, which is the threat it is for, and against
 * nothing else. Anything stronger has to happen before the data is fetched.
 *
 * The setting is remembered, and remembered ON: someone who turned this on once
 * did not mean "until I next open the app". Kept in localStorage rather than in
 * the household, because it belongs to this device — the phone you read on the
 * tram, not the laptop at home.
 *
 * State lives outside React so the toggle and the page cannot disagree, and so
 * the class is on <html> before the first paint rather than a frame after it.
 */

const KEY = 'doughnatello:private'

const listeners = new Set<() => void>()
let hidden = read()

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    // Private browsing, or storage denied. Not a reason to fail.
    return false
  }
}

/** The attribute the stylesheet keys off. */
function apply(value: boolean) {
  document.documentElement.toggleAttribute('data-private', value)
}

export function setHidden(value: boolean) {
  hidden = value
  try {
    localStorage.setItem(KEY, value ? '1' : '0')
  } catch {
    // The toggle still works for this session.
  }
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
    () => false,
  )
  return { hidden: value, toggle: () => setHidden(!value) }
}
