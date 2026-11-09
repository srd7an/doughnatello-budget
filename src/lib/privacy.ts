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
 *
 * ONE EXCEPTION, and it is opt-in. Covered-on-open is right for a phone on a
 * tram and wrong for a laptop at a kitchen table, where it is one press before
 * every single look at the screen — and "at a glance" is what the overview is
 * for. So a device can be told to remember: it then opens however it was left.
 * Off unless switched on, per device, and switching it off forgets the stored
 * state rather than leaving it to come back later. The argument above still
 * holds for every device that has not been told otherwise.
 */

const REMEMBER_KEY = 'privacy:remember'
const STATE_KEY = 'privacy:hidden'

/** Storage that is missing, full or forbidden is the same as nothing stored:
 *  the app then starts covered, which is the safe way to be wrong. */
function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // Nothing to do — the choice does not outlive the page.
  }
}

const listeners = new Set<() => void>()
let hidden = true

/** The attribute the stylesheet keys off. */
function apply(value: boolean) {
  document.documentElement.toggleAttribute('data-private', value)
}

export function setHidden(value: boolean) {
  hidden = value
  apply(value)
  if (remembers()) write(STATE_KEY, value ? '1' : '0')
  for (const l of listeners) l()
}

/** Whether this device has been told to open as it was left. */
export function remembers(): boolean {
  return read(REMEMBER_KEY) === '1'
}

export function setRemember(on: boolean) {
  write(REMEMBER_KEY, on ? '1' : null)
  // Off forgets, rather than keeping a state to resurface if it is ever
  // switched back on by someone who does not know what it last held.
  write(STATE_KEY, on ? (hidden ? '1' : '0') : null)
  for (const l of listeners) l()
}

/** Called once at startup, before React renders. */
export function initPrivacy() {
  // Only an explicit "shown" on a device that remembers uncovers the figures.
  // Anything else — no preference, no stored state, no storage — stays covered.
  if (remembers() && read(STATE_KEY) === '0') hidden = false
  apply(hidden)
}

/** The device preference, for the one switch in Settings that sets it. */
export function useRemember(): { remember: boolean; set: (on: boolean) => void } {
  const value = useSyncExternalStore(
    (notify) => {
      listeners.add(notify)
      return () => listeners.delete(notify)
    },
    remembers,
    () => false,
  )
  return { remember: value, set: setRemember }
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
