import { describe, expect, test } from 'vitest'
import {
  formatMoney,
  formatPercent,
  inputToPara,
  paraToInput,
  sanitizeMoneyInput,
} from './format'

/**
 * Money in and out. The grouping is "," and the decimal point is "." — the
 * format this app was asked for, which is NOT the sr-RS convention.
 */
describe('formatMoney', () => {
  test('groups thousands with a comma', () => {
    expect(formatMoney(4_441_300)).toBe('44,413')
    expect(formatMoney(1_200_000_00)).toBe('1,200,000')
  })

  test('shows decimals only when the money has them', () => {
    expect(formatMoney(123450)).toBe('1,234.50')
    expect(formatMoney(1)).toBe('0.01')
    expect(formatMoney(100)).toBe('1')
  })

  test('never hides sub-unit precision by rounding', () => {
    expect(formatMoney(99)).toBe('0.99')
  })

  test('signs', () => {
    expect(formatMoney(-150)).toBe('−1.50')
    expect(formatMoney(200000, { signed: true })).toBe('+2,000')
    expect(formatMoney(0, { signed: true })).toBe('0')
  })
})

describe('formatPercent', () => {
  test('uses a dot decimal to match the money format', () => {
    expect(formatPercent(0.137)).toBe('13.7%')
    expect(formatPercent(0.6)).toBe('60%')
  })
})

describe('money input', () => {
  test('keeps digits and one decimal point', () => {
    expect(sanitizeMoneyInput('1234.56')).toBe('1234.56')
    expect(sanitizeMoneyInput('12.34.56')).toBe('12.3456'.slice(0, 5))
    expect(sanitizeMoneyInput('abc12x.9')).toBe('12.9')
  })

  test('caps at two decimals — para has no room for more', () => {
    expect(sanitizeMoneyInput('1.239')).toBe('1.23')
  })

  test('round-trips through para', () => {
    expect(inputToPara('1234.56')).toBe(123456)
    expect(inputToPara('0.5')).toBe(50)
    expect(inputToPara('')).toBe(0)
    expect(paraToInput(123456)).toBe('1234.56')
    expect(paraToInput(200000)).toBe('2000')
    expect(paraToInput(0)).toBe('')
  })
})
