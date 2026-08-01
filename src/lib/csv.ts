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
