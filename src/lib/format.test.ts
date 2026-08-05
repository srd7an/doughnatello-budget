import { describe, expect, test } from 'vitest'
import {
  formatMoney,
  groupMoneyInput,
  formatPercent,
  inputToPara,
  paraToInput,
  parseMoney,
  sanitizeMoneyInput,
} from './format'

/**
 * Serbian punctuation: thousands separated by ".", decimals by "," —
 * 44.413,50 and 13,7%.
 */
describe('formatMoney', () => {
  test('groups thousands with a dot', () => {
    expect(formatMoney(4_441_300)).toBe('44.413')
    expect(formatMoney(1_200_000_00)).toBe('1.200.000')
  })

  test('shows decimals with a comma, and only when the money has them', () => {
    expect(formatMoney(123450)).toBe('1.234,50')
    expect(formatMoney(1)).toBe('0,01')
    expect(formatMoney(100)).toBe('1')
  })

  test('never hides sub-unit precision by rounding', () => {
    expect(formatMoney(99)).toBe('0,99')
  })

  test('signs', () => {
    expect(formatMoney(-150)).toBe('−1,50')
    expect(formatMoney(200000, { signed: true })).toBe('+2.000')
    expect(formatMoney(0, { signed: true })).toBe('0')
  })
})

describe('formatPercent', () => {
  test('uses a comma decimal', () => {
    expect(formatPercent(0.137)).toBe('13,7%')
    expect(formatPercent(0.6)).toBe('60%')
  })
})

/**
 * One parser for typed and pasted and imported amounts. The hard case is a lone
 * separator: "323,403" is three hundred thousand, "1,50" is one and a half.
 */
describe('parseMoney', () => {
  test('a lone separator with three digits is grouping', () => {
    expect(parseMoney('323,403')).toBe(32_340_300)
    expect(parseMoney('1.500')).toBe(150_000)
  })

  test('a lone separator with one or two digits is a decimal', () => {
    expect(parseMoney('1,50')).toBe(150)
    expect(parseMoney('1234,5')).toBe(123_450)
    expect(parseMoney('44413.00')).toBe(4_441_300)
  })

  test('both separators: the rightmost is the decimal', () => {
    expect(parseMoney('44.413,50')).toBe(4_441_350)
    expect(parseMoney('1,234.56')).toBe(123_456)
  })

  test('repeated separators are grouping', () => {
    expect(parseMoney('1.234.567')).toBe(123_456_700)
  })

  test('nothing numeric', () => {
    expect(parseMoney('')).toBeNull()
    expect(parseMoney('n/a')).toBeNull()
  })
})

describe('money input', () => {
  test('keeps only digits and separators, and does not rearrange them', () => {
    // A pasted, fully punctuated amount must survive being sanitised.
    expect(sanitizeMoneyInput('44.413,50 RSD')).toBe('44.413,50')
    expect(sanitizeMoneyInput('abc12x,9')).toBe('12,9')
  })

  test('a pasted grouped amount reads correctly', () => {
    expect(inputToPara('44.413,50')).toBe(4_441_350)
  })

  test('a dot typed on a numeric keypad still works as a decimal', () => {
    expect(inputToPara('12.5')).toBe(1250)
  })

  test('round-trips through para, emitting a comma decimal', () => {
    expect(inputToPara('1234,56')).toBe(123456)
    expect(inputToPara('')).toBe(0)
    expect(paraToInput(123456)).toBe('1234,56')
    expect(paraToInput(200000)).toBe('2000')
    expect(paraToInput(0)).toBe('')
  })
})

describe('groupMoneyInput', () => {
  test('groups thousands with dots, Serbian style', () => {
    expect(groupMoneyInput('44413')).toBe('44.413')
    expect(groupMoneyInput('1234567')).toBe('1.234.567')
    expect(groupMoneyInput('999')).toBe('999')
  })

  test('leaves the decimals exactly as typed', () => {
    // Not "44.413,50" — you are still typing the 5.
    expect(groupMoneyInput('44413,5')).toBe('44.413,5')
    expect(groupMoneyInput('44413,50')).toBe('44.413,50')
  })

  test('a just-pressed comma survives', () => {
    expect(groupMoneyInput('1234,')).toBe('1.234,')
  })

  test('regrouping is idempotent — typing does not pile up dots', () => {
    expect(groupMoneyInput('44.413')).toBe('44.413')
    expect(groupMoneyInput(groupMoneyInput('1234567'))).toBe('1.234.567')
  })

  test('and what comes out still parses back to what went in', () => {
    expect(inputToPara(groupMoneyInput('44413,5'))).toBe(inputToPara('44413,5'))
    expect(inputToPara(groupMoneyInput('1234567'))).toBe(1_234_567_00)
  })

  test('empty and separator-only input do not become junk', () => {
    expect(groupMoneyInput('')).toBe('')
    expect(groupMoneyInput(',')).toBe(',')
    expect(groupMoneyInput(',50')).toBe(',50')
  })
})
