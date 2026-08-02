import { describe, expect, test } from 'vitest'
import { cadenceLabel, dueLabel, ordinal, untilDateForCount } from './recurrence'
import { nextDue } from '../../convex/lib/recurrence'

/**
 * "Repeats N times" is the one place a person's counting and the rule's
 * counting can disagree, so the boundary is pinned here: the transaction being
 * entered right now IS the first of the N.
 */
describe('untilDateForCount', () => {
  const monthly = { cadence: 'monthly' as const, intervalCount: 1, anchorDay: 10 }

  test('twice means one more after today', () => {
    expect(untilDateForCount('2026-08-10', monthly, 2, nextDue)).toBe('2026-08-10')
  })

  test('twelve times ends eleven periods after the start', () => {
    // Entered in July, rule starts August, twelfth lands the following June.
    expect(untilDateForCount('2026-08-10', monthly, 12, nextDue)).toBe('2027-06-10')
  })

  test('a month-end anchor still clamps along the way', () => {
    const r = { cadence: 'monthly' as const, intervalCount: 1, anchorDay: 31 }
    expect(untilDateForCount('2026-02-28', r, 3, nextDue)).toBe('2026-03-31')
  })

  test('weekly counts whole weeks', () => {
    const w = { cadence: 'weekly' as const, intervalCount: 1, anchorDay: 1 }
    expect(untilDateForCount('2026-08-03', w, 4, nextDue)).toBe('2026-08-17')
  })

  test('nonsense totals are clamped, never looped', () => {
    expect(untilDateForCount('2026-08-10', monthly, 0, nextDue)).toBe('2026-08-10')
    expect(untilDateForCount('2026-08-10', monthly, -5, nextDue)).toBe('2026-08-10')
    expect(untilDateForCount('2026-08-10', monthly, 99999, nextDue)).toBeTruthy()
  })
})

describe('labels', () => {
  test('ordinals', () => {
    expect(ordinal(1)).toBe('1st')
    expect(ordinal(11)).toBe('11th')
    expect(ordinal(22)).toBe('22nd')
  })

  test('cadence reads naturally', () => {
    expect(cadenceLabel('monthly', 1, 10, '2026-08-10')).toBe('Monthly on the 10th')
    expect(cadenceLabel('weekly', 2, 1, '2026-08-10')).toBe('Every 2 weeks')
  })

  test('due labels', () => {
    expect(dueLabel('2026-08-02', '2026-08-02')).toBe('Due today')
    expect(dueLabel('2026-08-03', '2026-08-02')).toBe('Due tomorrow')
    expect(dueLabel('2026-08-01', '2026-08-02')).toBe('1 day late')
  })
})
