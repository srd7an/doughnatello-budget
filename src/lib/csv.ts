import { parseMoney } from './format'

/**
 * CSV assembly for the export panel.
 *
 * Money leaves as plain dinars with two decimals — the para integer divided
 * exactly, never rounded — because a spreadsheet is the destination and a
 * spreadsheet wants a number it can sum. This is a deliberate second formatting
 * boundary alongside src/lib/format.ts: that one formats for human eyes (44.413
 * with Serbian grouping), this one formats for a machine (44413.00), and mixing
 * them would produce a file Excel reads as text.
 */

/** Stored para → a plain decimal string: 4441300 → "44413.00". */
export function paraToDecimal(para: number): string {
  const sign = para < 0 ? '-' : ''
  const abs = Math.abs(para)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/**
 * Quote a field for RFC 4180. Anything containing a comma, quote or newline is
 * wrapped, and inner quotes are doubled — a payee called `Bakery "Sun", Novi Sad`
 * must not silently become three columns.
 */
export function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function toCsv(headers: string[], rows: string[][]): string {
  return [headers, ...rows]
    .map((r) => r.map(csvCell).join(','))
    .join('\r\n')
}

/**
 * A written amount → integer para.
 *
 * Delegates to `parseMoney` in lib/format: an amount is punctuated the same way
 * whether it arrives from a CSV or a keyboard, and two copies of that rule would
 * eventually disagree about what "323,403" means.
 */
export function decimalToPara(value: string): number | null {
  return parseMoney(value)
}

/**
 * A written date → YYYY-MM-DD, or null.
 *
 * Accepts ISO and day-first forms separated by "." "/" or "-", including the
 * Serbian "01.07.2026." with its trailing dot. Day-first because that is what
 * this app's users write — a US "07/01/2026" is therefore read as 7 January,
 * which is one reason the preview shows you what will land before it lands.
 */
export function parseDateInput(value: string): string | null {
  const t = value.trim().replace(/\.$/, '')
  if (!t) return null

  const iso = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (iso) return ymd(+iso[1], +iso[2], +iso[3])

  const dayFirst = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/)
  if (dayFirst) return ymd(+dayFirst[3], +dayFirst[2], +dayFirst[1])

  return null
}

function ymd(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const date = new Date(Date.UTC(y, m - 1, d))
  // Rejects 31 February rather than letting it roll silently into March.
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * Split CSV text into rows of cells, honouring RFC 4180 quoting — the same rule
 * the export writes with, so a payee containing a comma survives the round trip.
 * Handles CRLF and LF, and a leading UTF-8 BOM.
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += c
      continue
    }
    if (c === '"') quoted = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  // Drop trailing blank lines.
  return rows.filter((r) => r.some((v) => v.trim() !== ''))
}

/** The columns an import needs, and the export's header names for each. */
export const IMPORT_FIELDS = [
  'date',
  'direction',
  'amount',
  'category',
  'payee',
  // The three the form has and a CSV had no way to say. `fund` is the
  // destination a transfer lands in; `payFrom` is what a spend came OUT of —
  // a fund for an expense, the source fund for a move — and `paysOff` names
  // the loan an instalment pays down.
  'fund',
  'payFrom',
  'paysOff',
  'note',
] as const
export type ImportField = (typeof IMPORT_FIELDS)[number]

/**
 * Guess which CSV column feeds which field, so a file this app exported needs
 * no mapping at all and a bank export starts part-filled rather than blank.
 */
export function guessMapping(headers: string[]): Record<ImportField, number> {
  const norm = headers.map((h) => h.trim().toLowerCase())
  const find = (...names: string[]) =>
    norm.findIndex((h) => names.some((n) => h === n || h.includes(n)))

  const guess: Record<ImportField, number> = {
    date: find('date', 'datum'),
    direction: find('type', 'direction'),
    amount: find('amount', 'iznos', 'value'),
    category: find('category', 'kategorija'),
    fund: find('into', 'fund'),
    payFrom: find('pay from', 'payfrom', 'iz fonda'),
    paysOff: find('paying off', 'paysoff', 'pays off', 'loan', 'kredit'),
    payee: find('payee', 'description', 'opis', 'merchant'),
    note: find('note', 'napomena', 'memo'),
  }

  // A sheet with a Note column and no Payee: the note IS what the row is
  // called, so use it as the name rather than leaving every row nameless.
  if (guess.payee === -1 && guess.note !== -1) {
    guess.payee = guess.note
    guess.note = -1
  }
  return guess
}

/** Hand a generated file to the browser as a download. */
export function downloadFile(
  filename: string,
  contents: string,
  mime = 'text/csv;charset=utf-8',
) {
  // A BOM so Excel opens UTF-8 (č, ž, đ) correctly instead of mojibake.
  const blob = new Blob(['﻿', contents], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
