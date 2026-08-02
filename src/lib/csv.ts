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

/** Plain decimal string → integer para. "44413.00" → 4441300. */
export function decimalToPara(value: string): number | null {
  const cleaned = value
    .trim()
    // Serbian exports use "." for thousands and "," for decimals; plain machine
    // exports use "." for decimals and no grouping. Decide by which separator
    // comes LAST — that one is the decimal point.
    .replace(/\s/g, '')
    .replace(/[^\d.,+-]/g, '')
  if (!cleaned) return null

  const lastComma = cleaned.lastIndexOf(',')
  const lastDot = cleaned.lastIndexOf('.')
  let normalised = cleaned
  if (lastComma > lastDot) {
    normalised = cleaned.replace(/\./g, '').replace(',', '.')
  } else if (lastDot > lastComma) {
    normalised = cleaned.replace(/,/g, '')
  }

  const n = Number(normalised)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100)
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
  'fund',
  'payee',
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

  return {
    date: find('date', 'datum'),
    direction: find('type', 'direction'),
    amount: find('amount', 'iznos', 'value'),
    category: find('category', 'kategorija'),
    fund: find('fund'),
    payee: find('payee', 'description', 'opis', 'merchant'),
    note: find('note', 'napomena', 'memo'),
  }
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
