import { parseMoney } from './format'

/**
 * Reading what a scanned QR code says.
 *
 * Two kinds turn up on Serbian paper, and they could not be more different:
 *
 *   IPS (NBS) — on payment slips: electricity, Infostan, anything with a
 *   uplatnica. Plain text, pipe-separated key:value, and the amount is simply
 *   sitting there. Parsed entirely offline.
 *
 *   Fiscal (ПУРС) — on every shop receipt since fiscalisation. The code holds a
 *   verification URL whose `vl` parameter is base64 of a BINARY record of the
 *   invoice. Its layout is not documented here and is not guessed at: this
 *   module recognises the code and hands back the decoded bytes, and the
 *   scanner shows them. Filling in an amount read out of a structure nobody has
 *   confirmed would be worse than filling in nothing.
 *
 * Everything else is returned as `unknown` with its text intact, for the same
 * reason — so the thing that was scanned can be looked at rather than guessed.
 */

export type Scan =
  | {
      kind: 'ips'
      raw: string
      /** Para, or null when the code carried no amount (some slips do not). */
      amount: number | null
      payee: string | null
      purpose: string | null
    }
  | { kind: 'fiscal'; raw: string; url: string; bytes: Uint8Array | null }
  | { kind: 'unknown'; raw: string }

/** base64url → bytes. Returns null rather than throwing on malformed input. */
function decodeBase64(input: string): Uint8Array | null {
  try {
    const padded = input.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

/**
 * IPS fields are `KEY:value` joined by `|`. Split on the FIRST colon only — a
 * purpose line reading "Racun 07/2026: struja" is one field, not two.
 */
function ipsFields(text: string): Map<string, string> {
  const fields = new Map<string, string>()
  for (const part of text.split('|')) {
    const at = part.indexOf(':')
    if (at <= 0) continue
    fields.set(part.slice(0, at).toUpperCase(), part.slice(at + 1))
  }
  return fields
}

export function parseQr(raw: string): Scan {
  const text = raw.trim()

  // IPS: identified by its leading K: tag, not by guessing at the shape.
  if (/^K:/i.test(text)) {
    const f = ipsFields(text)
    // "RSD1234,56" — the currency is a prefix, and the separator is whatever
    // the printer felt like, which is what parseMoney is for.
    const amountField = f.get('I') ?? ''
    const amount = amountField ? parseMoney(amountField.replace(/[A-Za-z]/g, '')) : null

    // N is name, then address and city — sometimes newline-separated, sometimes
    // comma. The first segment is the one worth putting in a Payee field.
    const name = (f.get('N') ?? '').split(/[\n\r]/)[0].trim()

    return {
      kind: 'ips',
      raw: text,
      amount: amount && amount > 0 ? amount : null,
      payee: name || null,
      purpose: (f.get('S') ?? '').trim() || null,
    }
  }

  // Fiscal: the tax administration's verification URL.
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text)
      if (/(^|\.)purs\.gov\.rs$/i.test(url.hostname)) {
        const vl = url.searchParams.get('vl')
        return { kind: 'fiscal', raw: text, url: text, bytes: vl ? decodeBase64(vl) : null }
      }
    } catch {
      // Not a URL after all; fall through.
    }
  }

  return { kind: 'unknown', raw: text }
}

/**
 * A hex + ASCII dump, the way you would look at an unknown record in a debugger.
 *
 * This exists to be READ by a person: the fiscal payload's layout is worked out
 * by scanning a receipt whose total is known and finding it in these columns.
 */
export function hexDump(bytes: Uint8Array, maxBytes = 512): string {
  const lines: string[] = []
  const n = Math.min(bytes.length, maxBytes)
  for (let i = 0; i < n; i += 16) {
    const row = Array.from(bytes.slice(i, i + 16))
    const hex = row.map((b) => b.toString(16).padStart(2, '0')).join(' ')
    const ascii = row.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('')
    lines.push(`${i.toString(16).padStart(4, '0')}  ${hex.padEnd(47)}  ${ascii}`)
  }
  if (bytes.length > n) lines.push(`… ${bytes.length - n} more bytes`)
  return lines.join('\n')
}

/** What the scanner can hand to the form. Absent fields are left alone. */
export type Prefill = { amount?: number; payee?: string }

export function toPrefill(scan: Scan): Prefill | null {
  if (scan.kind !== 'ips') return null
  const out: Prefill = {}
  if (scan.amount) out.amount = scan.amount
  // The purpose describes the bill better than the utility's legal name does,
  // but the name is what you would recognise in a list, so it wins.
  if (scan.payee) out.payee = scan.payee
  return Object.keys(out).length > 0 ? out : null
}
