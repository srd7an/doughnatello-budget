import { describe, expect, test } from 'vitest'
import {
  csvCell,
  decimalToPara,
  guessMapping,
  paraToDecimal,
  parseCsv,
  toCsv,
} from './csv'

/**
 * The export is the one place the app hands your money to another program, so
 * the two ways it could quietly corrupt a file are tested directly: losing
 * precision on an amount, and losing a column to an unescaped comma.
 */

describe('paraToDecimal', () => {
  test('divides exactly — never rounds', () => {
    expect(paraToDecimal(4_441_300)).toBe('44413.00')
    expect(paraToDecimal(1)).toBe('0.01')
    expect(paraToDecimal(199)).toBe('1.99')
    expect(paraToDecimal(0)).toBe('0.00')
  })

  test('keeps the sign', () => {
    expect(paraToDecimal(-1_50)).toBe('-1.50')
  })

  test('a large amount stays intact', () => {
    expect(paraToDecimal(999_999_999_99)).toBe('999999999.99')
  })
})

describe('csvCell', () => {
  test('leaves ordinary text alone', () => {
    expect(csvCell('Grocery')).toBe('Grocery')
    expect(csvCell('Novi Sad')).toBe('Novi Sad')
  })

  test('wraps a comma so it cannot become a new column', () => {
    expect(csvCell('Bakery, Novi Sad')).toBe('"Bakery, Novi Sad"')
  })

  test('doubles inner quotes', () => {
    expect(csvCell('Bakery "Sun", Novi Sad')).toBe('"Bakery ""Sun"", Novi Sad"')
  })

  test('wraps newlines', () => {
    expect(csvCell('line one\nline two')).toBe('"line one\nline two"')
  })

  test('leaves Serbian characters untouched', () => {
    expect(csvCell('Čačak — pekara')).toBe('Čačak — pekara')
  })
})

describe('toCsv', () => {
  test('joins with CRLF and quotes only what needs it', () => {
    const csv = toCsv(
      ['Date', 'Payee', 'Amount'],
      [
        ['2026-07-01', 'Idea', '2000.00'],
        ['2026-07-02', 'Bakery, Sun', '350.50'],
      ],
    )
    expect(csv).toBe(
      'Date,Payee,Amount\r\n' +
        '2026-07-01,Idea,2000.00\r\n' +
        '2026-07-02,"Bakery, Sun",350.50',
    )
  })
})

describe('parseCsv', () => {
  test('reads quoted cells containing commas and quotes', () => {
    const rows = parseCsv(
      'Date,Payee,Amount\r\n2026-07-02,"Bakery ""Sun"", Novi Sad",350.50',
    )
    expect(rows[1]).toEqual(['2026-07-02', 'Bakery "Sun", Novi Sad', '350.50'])
  })

  test('survives its own export — BOM, CRLF, trailing newline', () => {
    const csv = '﻿Date,Amount\r\n2026-07-01,2000.00\r\n'
    expect(parseCsv(csv)).toEqual([
      ['Date', 'Amount'],
      ['2026-07-01', '2000.00'],
    ])
  })

  test('keeps embedded newlines inside quotes', () => {
    expect(parseCsv('A,B\n"one\ntwo",x')[1]).toEqual(['one\ntwo', 'x'])
  })
})

describe('decimalToPara', () => {
  test('reads our own export format', () => {
    expect(decimalToPara('44413.00')).toBe(4441300)
    expect(decimalToPara('1.99')).toBe(199)
    expect(decimalToPara('-1.50')).toBe(-150)
  })

  test('reads Serbian grouping, where the comma is the decimal', () => {
    expect(decimalToPara('44.413,00')).toBe(4441300)
    expect(decimalToPara('1.234,56')).toBe(123456)
  })

  test('reads thousands separators with a dot decimal', () => {
    expect(decimalToPara('1,234.56')).toBe(123456)
  })

  test('strips currency symbols and spaces', () => {
    expect(decimalToPara(' 2 000,00 RSD ')).toBe(200000)
  })

  test('returns null for junk', () => {
    expect(decimalToPara('')).toBeNull()
    expect(decimalToPara('n/a')).toBeNull()
  })
})

describe('guessMapping', () => {
  test('maps our export headers exactly', () => {
    const m = guessMapping([
      'Date', 'Type', 'Amount', 'Category', 'Fund',
      'Paid from fund', 'Payee', 'Note', 'Paid by',
    ])
    expect(m.date).toBe(0)
    expect(m.direction).toBe(1)
    expect(m.amount).toBe(2)
    expect(m.category).toBe(3)
    expect(m.payee).toBe(6)
  })

  test('finds what it can in a bank export and leaves the rest unset', () => {
    const m = guessMapping(['Datum', 'Opis', 'Iznos'])
    expect(m.date).toBe(0)
    expect(m.payee).toBe(1)
    expect(m.amount).toBe(2)
    expect(m.fund).toBe(-1)
  })
})
