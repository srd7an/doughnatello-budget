import { describe, expect, test } from 'vitest'
import { hexDump, parseQr, toPrefill } from './qr'

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
    expect(toPrefill(s)).toEqual({ payee: 'Firma' })
  })

  test('the prefill carries amount and payee, and nothing else', () => {
    expect(toPrefill(parseQr(slip))).toEqual({
      amount: 4_235_50,
      payee: 'EPS SNABDEVANJE DOO',
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

  test('no amount is claimed from a layout nobody has confirmed', () => {
    expect(toPrefill(parseQr(url))).toBeNull()
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
