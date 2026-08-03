import { describe, expect, test } from 'vitest'
import { fold, matches, SEARCH_FROM } from './search'

describe('fold', () => {
  test('strips the accents Serbian names are full of', () => {
    expect(fold('Štednja')).toBe('stednja')
    expect(fold('Kućni računi')).toBe('kucni racuni')
    expect(fold('Čačak')).toBe('cacak')
    expect(fold('Životno osiguranje')).toBe('zivotno osiguranje')
  })

  test('đ has no accent to strip and is mapped by hand', () => {
    // NFD leaves đ whole — it is a distinct letter, not d plus a mark — so
    // without the explicit map this is the one that quietly never matches.
    expect(fold('Đubrivo')).toBe('dubrivo')
    expect(fold('đak')).toBe('dak')
    expect('đ'.normalize('NFD').length).toBe(1) // the reason the map exists
  })

  test('lowercases and trims', () => {
    expect(fold('  GROCERY  ')).toBe('grocery')
  })
})

describe('matches', () => {
  test('finds an accented name from an unaccented keyboard, and back', () => {
    expect(matches('Štednja', 'sted')).toBe(true)
    expect(matches('Štednja', 'šted')).toBe(true)
    expect(matches('Stednja', 'šted')).toBe(true)
  })

  test('every word must match, in any order', () => {
    expect(matches('Kućni računi', 'kuc rac')).toBe(true)
    expect(matches('Kućni računi', 'rac kuc')).toBe(true)
    expect(matches('Kućni računi', 'kuc struja')).toBe(false)
  })

  test('matches anywhere in the name, not only the start', () => {
    expect(matches('Clothes & Shoes', 'shoes')).toBe(true)
  })

  test('an empty or blank query matches everything', () => {
    expect(matches('anything', '')).toBe(true)
    expect(matches('anything', '   ')).toBe(true)
  })

  test('case is ignored on both sides', () => {
    expect(matches('grocery', 'GROC')).toBe(true)
  })
})

test('the threshold is a list you can no longer take in at a glance', () => {
  expect(SEARCH_FROM).toBeGreaterThan(5)
  expect(SEARCH_FROM).toBeLessThanOrEqual(10)
})
