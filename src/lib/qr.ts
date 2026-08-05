import { parseMoney } from './format'
import { localISO } from './dates'

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
 *   invoice, carrying the total and the moment of sale. The layout is written
 *   out at `parseFiscal`; it was worked out from a real receipt rather than
 *   from a specification, so anything that does not match it exactly is
 *   returned unparsed rather than approximated.
 *
 * A code that cannot be turned into an amount keeps its bytes, and the scanner
 * shows them — which is how the layout above came to be known, and how the next
 * variant will be. Everything else is returned as `unknown` with its text
 * intact, for the same reason.
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
  | {
      kind: 'fiscal'
      raw: string
      url: string
      bytes: Uint8Array | null
      /** Null when the record is a version or shape this does not know. */
      invoice: FiscalInvoice | null
    }
  | { kind: 'unknown'; raw: string }

export type FiscalInvoice = {
  /** Para, like every other amount in this app. */
  amount: number
  /** YYYY-MM-DD, in local time — the receipt's own clock, not UTC's. */
  occurredOn: string
  /** The two numbers printed as "Бројач рачуна: 86204/92097". */
  counter: number
  typeCounter: number
  /** The fiscal device's identifier. Not the shop's name — there isn't one. */
  device: string
}

/**
 * The fiscal record, worked out from a receipt whose total was known.
 *
 *   0      version, 3
 *   1–8    requestedBy   ASCII, the device's ЈИД
 *   9–16   signedBy      ASCII
 *   17–20  u32 LE        invoice counter
 *   21–24  u32 LE        counter within the transaction type
 *   25–32  u64 LE        total, scaled by 10.000
 *   33–40  u64 BE        milliseconds since the epoch
 *   41…    signature
 *
 * The mixed endianness is not a typo — the counters and the total are
 * little-endian and the timestamp is big-endian. The timestamp is also what
 * proves the layout: no other offset in the header yields a date this century,
 * and an eight-byte field landing inside a ten-year window by chance is not
 * something that happens.
 *
 * The scale is 10.000 (a .NET `currency`), while this app counts para, so the
 * conversion is a division by 100 — confirmed against a receipt reading
 * 4.599,00 whose record held 45.990.000.
 */
function parseFiscal(b: Uint8Array): FiscalInvoice | null {
  if (b.length < 41 || b[0] !== 3) return null
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)

  const amount = Math.round(Number(dv.getBigUint64(25, true)) / 100)
  const ms = Number(dv.getBigUint64(33, false))
  // A receipt older than fiscalisation, or dated after tomorrow, means the
  // offsets are being read out of something that is not a receipt.
  if (!Number.isFinite(amount) || amount <= 0) return null
  if (ms < Date.UTC(2021, 0, 1) || ms > Date.now() + 86_400_000) return null

  return {
    amount,
    occurredOn: localISO(new Date(ms)),
    counter: dv.getUint32(17, true),
    typeCounter: dv.getUint32(21, true),
    device: new TextDecoder().decode(b.slice(1, 9)).replace(/\0+$/, ''),
  }
}

/**
 * base64 → bytes. Returns null rather than throwing on malformed input.
 *
 * Spaces are turned back into `+` first. A query string is form-encoded, so
 * `URLSearchParams` decodes every `+` in it as a space — and a fiscal payload
 * is plain base64, full of them. Base64 has no space in its alphabet, so the
 * reverse is unambiguous. Without this the record decodes to noise and every
 * receipt looks like an unknown version.
 */
function decodeBase64(input: string): Uint8Array | null {
  try {
    const padded = input.replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/')
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
        const bytes = vl ? decodeBase64(vl) : null
        return {
          kind: 'fiscal',
          raw: text,
          url: text,
          bytes,
          invoice: bytes ? parseFiscal(bytes) : null,
        }
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
export type Prefill = { amount?: number; payee?: string; occurredOn?: string }

export function toPrefill(scan: Scan): Prefill | null {
  const out: Prefill = {}

  if (scan.kind === 'ips') {
    if (scan.amount) out.amount = scan.amount
    // The purpose describes the bill better than the utility's legal name does,
    // but the name is what you would recognise in a list, so it wins.
    if (scan.payee) out.payee = scan.payee
  } else if (scan.kind === 'fiscal' && scan.invoice) {
    out.amount = scan.invoice.amount
    // A receipt carries the day it happened, and it is often not today — you
    // empty your pockets on Sunday. No payee: the record holds the till's
    // identifier, never the shop's name.
    out.occurredOn = scan.invoice.occurredOn
  }

  return Object.keys(out).length > 0 ? out : null
}
