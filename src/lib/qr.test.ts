import { describe, expect, test } from 'vitest'
import { applyScan, hexDump, parseQr, toPrefill } from './qr'

/**
 * IPS is pinned tightly because it is parsed offline and its output goes
 * straight into an amount field. Fiscal is pinned loosely on purpose: the only
 * promise made about it is that it is RECOGNISED and its bytes handed back, so
 * that the layout can be worked out from a real receipt rather than invented
 * here.
 */
describe('IPS payment slips', () => {
  const slip =
    'K:PR|V:01|C:1|R:265104031000032461|N:EPS SNABDEVANJE DOO\nBALKANSKA 13\nBEOGRAD|I:RSD4235,50|SF:189|S:Utrosena elektricna energija|RO:97 1234567890'

  test('reads the amount, in para', () => {
    const s = parseQr(slip)
    expect(s.kind).toBe('ips')
    if (s.kind !== 'ips') return
    expect(s.amount).toBe(4_235_50)
  })

  test('takes the recipient name without its address', () => {
    const s = parseQr(slip)
    if (s.kind !== 'ips') return
    expect(s.payee).toBe('EPS SNABDEVANJE DOO')
    expect(s.purpose).toBe('Utrosena elektricna energija')
  })

  test('a purpose containing a colon stays one field', () => {
    const s = parseQr('K:PR|V:01|C:1|R:265|N:Firma|I:RSD100,00|S:Racun 07/2026: struja')
    if (s.kind !== 'ips') return
    expect(s.purpose).toBe('Racun 07/2026: struja')
  })

  test('a whole-dinar amount needs no decimals', () => {
    const s = parseQr('K:PR|V:01|C:1|R:265|N:Firma|I:RSD1200')
    if (s.kind !== 'ips') return
    expect(s.amount).toBe(1_200_00)
  })

  test('a slip with no amount says so rather than guessing zero', () => {
    const s = parseQr('K:PR|V:01|C:1|R:265|N:Firma')
    if (s.kind !== 'ips') return
    expect(s.amount).toBeNull()
    expect(toPrefill(s)).toEqual({ merchant: 'Firma' })
  })

  test('the recipient is the merchant, and the purpose is the description', () => {
    // A utility you are paying is a merchant in exactly the sense a shop is:
    // it is WHERE the money went. What it was FOR is the purpose line.
    expect(toPrefill(parseQr(slip))).toEqual({
      amount: 4_235_50,
      merchant: 'EPS SNABDEVANJE DOO',
      payee: 'Utrosena elektricna energija',
    })
  })
})

/** A real receipt: total 4.599,00 RSD, 16 June 2026. Everything about the
 *  fiscal layout is pinned against this one, because it is the only thing that
 *  proved it. */
const REAL =
  'https://suf.purs.gov.rs/v/?vl=A1NFR05VTjNOU0VHTlVOM07kGAEA/hIBAHDAvQIAAAAAAAABntEvVmgAAABAIxsFS7Ys9frBYoJj6fiYKzBSMxQkzMIKZRAx4uSR+k+rWDHWCIw+C7Ky4VmqtyRdcFZ5vSl1Sgc2lXeMeLD1gifqU/WSyFS5TUySyca7F+YGoJmYSNR2F/epOsPNlIzU7ceqHONRpmOg2AhenDZPPXB70ubWUmeeDtAInhl58v6wF/0KJ4XlBSqeT9nZsxnsZjE9dGoZ2eI2LlzfBGRGC0oJUexyBNi1lZ/BLgIPZvqj51gpTVSpst/xDpchwYyuhz8HkhYm18KZysDqfTCmYxRzIPTbOp0A2AKEjlWml1nrVzmi/PHX8rS8E16NbSOg2Q6fQeoxI6o/QPOjX7BOskDsThs0VLoxARvNRX+eXk8i2uVNhtBmHkGfLd1hrsUAsl2Le/Q7YAbmMwxP1eM3sNIw/9h92gjaZDmJjQLuEiFrrYhbnsfxQS9OMSv0XnO7oPOhfipDPldqW6LQmhEVgQEkUelBNKcAZqo4Uw4XkS6312UNzrPRXRWzS8EwkujmzHihYi2eo5ApUhRzwPiHikw+Yld+D4pIoQ6dx3hRKrXFMEpnlQAZuV7Wov1riQGuEsr9tEr7+O+St8DPOnsL2yEwC3U6wqyXONCQBu7DHF0H08PxkNVNr0clOqAfXIWfdfiUaiXVuC7w3cSvNyAsfdHJs9dv38qLj1dTFyRVbeu/imSZTqXvvKvMzIimdWc='

describe('a real fiscal receipt', () => {
  test('reads the total, in para', () => {
    const s = parseQr(REAL)
    expect(s.kind).toBe('fiscal')
    if (s.kind !== 'fiscal') return
    // 45.990.000 at a scale of 10.000 is 4.599,00 RSD.
    expect(s.invoice?.amount).toBe(4_599_00)
  })

  test('reads the day it happened', () => {
    const s = parseQr(REAL)
    if (s.kind !== 'fiscal') return
    expect(s.invoice?.occurredOn).toBe('2026-06-16')
  })

  test('reads the counters printed on the paper', () => {
    const s = parseQr(REAL)
    if (s.kind !== 'fiscal') return
    expect(s.invoice?.counter).toBe(71_908)
    expect(s.invoice?.typeCounter).toBe(70_398)
    expect(s.invoice?.device).toBe('SEGNUN3N')
  })

  test('the prefill carries the amount, the date and the till — never a payee', () => {
    // The record holds the till's identifier and no shop name at all, which is
    // exactly why the identifier is worth keeping: the name gets attached to it
    // once, by hand, and comes back on every later scan at the same shop.
    expect(toPrefill(parseQr(REAL))).toEqual({
      amount: 4_599_00,
      occurredOn: '2026-06-16',
      fiscalDevice: 'SEGNUN3N',
    })
  })
})

describe('fiscal receipts', () => {
  // Not a real receipt — "hello" in base64 — because the point of this test is
  // the recognising and the handing back, not the layout.
  const url = 'https://suf.purs.gov.rs/v/?vl=aGVsbG8='

  test('is recognised and its payload decoded', () => {
    const s = parseQr(url)
    expect(s.kind).toBe('fiscal')
    if (s.kind !== 'fiscal') return
    expect(s.bytes).not.toBeNull()
    expect(new TextDecoder().decode(s.bytes!)).toBe('hello')
  })

  test('a payload too short to be a receipt yields no amount', () => {
    expect(toPrefill(parseQr(url))).toBeNull()
  })

  test('an unknown version is refused rather than misread', () => {
    // Same bytes, version byte bumped to 4.
    const bytes = new Uint8Array(64)
    bytes[0] = 4
    const b64 = Buffer.from(bytes).toString('base64')
    const s = parseQr(`https://suf.purs.gov.rs/v/?vl=${b64}`)
    if (s.kind !== 'fiscal') return
    expect(s.invoice).toBeNull()
  })

  test('a malformed payload does not throw', () => {
    const s = parseQr('https://suf.purs.gov.rs/v/?vl=!!!not base64!!!')
    expect(s.kind).toBe('fiscal')
  })

  test('another government host on the same domain still counts', () => {
    expect(parseQr('https://suf.purs.gov.rs/v/?vl=aGk=').kind).toBe('fiscal')
  })

  test('a lookalike domain does not', () => {
    // purs.gov.rs.evil.com must not be mistaken for the real thing.
    expect(parseQr('https://purs.gov.rs.evil.com/v/?vl=aGk=').kind).toBe('unknown')
  })
})

describe('anything else', () => {
  test('is returned intact rather than swallowed', () => {
    expect(parseQr('  just some text  ')).toEqual({
      kind: 'unknown',
      raw: 'just some text',
    })
  })

  test('an ordinary URL is not a receipt', () => {
    expect(parseQr('https://example.com').kind).toBe('unknown')
  })
})

describe('hexDump', () => {
  test('shows offsets, hex and the printable characters', () => {
    const d = hexDump(new TextEncoder().encode('AB'))
    expect(d).toContain('0000')
    expect(d).toContain('41 42')
    expect(d).toContain('AB')
  })

  test('a long payload is truncated with a count of what is left', () => {
    const d = hexDump(new Uint8Array(600), 512)
    expect(d).toContain('88 more bytes')
  })
})

describe('applyScan — who owns what is in the field', () => {
  test('an empty field takes whatever the scan says', () => {
    expect(applyScan('', undefined, 'EPS')).toBe('EPS')
  })

  test('a value an earlier scan wrote is replaced', () => {
    expect(applyScan('EPS', 'EPS', 'Maxi')).toBe('Maxi')
  })

  test('a value you typed is never touched', () => {
    expect(applyScan('My shop', 'EPS', 'Maxi')).toBe('My shop')
    expect(applyScan('My shop', undefined, 'Maxi')).toBe('My shop')
  })

  test('an edited machine value counts as yours', () => {
    // The scan wrote "EPS", you made it "EPS Beograd" — that is now typed.
    expect(applyScan('EPS Beograd', 'EPS', 'Maxi')).toBe('EPS Beograd')
  })

  test('a scan with nothing to say CLEARS what a machine wrote', () => {
    // The receipt case: no shop name in it, so the slip's utility has to go —
    // otherwise it poses as this receipt's shop and blocks the lookup.
    expect(applyScan('EPS', 'EPS', undefined)).toBe('')
  })

  test('but never clears what you typed', () => {
    expect(applyScan('My shop', 'EPS', undefined)).toBe('My shop')
  })
})
