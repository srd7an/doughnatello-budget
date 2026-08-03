/**
 * Matching what someone typed against a list of names.
 *
 * Two things beyond a substring test, both because the names in this app are
 * Serbian:
 *
 * Diacritics are ignored in BOTH directions. Typing "stednja" has to find
 * "Štednja", because the keyboard in front of you is often the English one —
 * and typing "š" has to keep finding it too. NFD splits a letter into its base
 * and its accent, so stripping the combining marks leaves the base; đ and ђ do
 * not decompose at all and are mapped by hand.
 *
 * Matching is per WORD, not on the whole string: "kuc rac" finds "Kućni
 * računi". Anyone typing two fragments means both, in any order, which is what
 * you do when you half-remember a name.
 */

const BY_HAND: Record<string, string> = {
  đ: 'd',
  Đ: 'd',
  ђ: 'd',
  Ђ: 'd',
  ł: 'l',
  ø: 'o',
  ß: 'ss',
  æ: 'ae',
}

/** Lowercase, unaccented, trimmed — the form both sides are compared in. */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // the combining marks NFD just split off
    .replace(/[đĐђЂłøßæ]/g, (c) => BY_HAND[c] ?? c)
    .toLowerCase()
    .trim()
}

/** Whether `text` matches every word of `query`. An empty query matches all. */
export function matches(text: string, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const hay = fold(text)
  return words.every((w) => hay.includes(w))
}

/**
 * Below this many options, a search field is worse than no search field: it
 * costs a row of height and a decision, to filter a list you can already read
 * in one glance.
 */
export const SEARCH_FROM = 8
