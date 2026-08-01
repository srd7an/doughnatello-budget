import { describe, expect, test } from 'vitest'
import { explainAuthError } from './SignInForm'

/**
 * The sign-in form used to report every signup failure as "that email may
 * already be in use", which sent people hunting for an account that did not
 * exist. These cases pin the distinctions that message got wrong.
 */
describe('explainAuthError', () => {
  test('a short password says so, rather than blaming the email', () => {
    const msg = explainAuthError(new Error('Invalid password'), 'signUp')
    expect(msg).toMatch(/8 characters/)
    expect(msg).not.toMatch(/already/)
  })

  test('a genuine duplicate points at signing in', () => {
    expect(
      explainAuthError(new Error('Account already exists'), 'signUp'),
    ).toMatch(/already exists/)
  })

  test('a failed sign-in does not leak whether the account exists', () => {
    const msg = explainAuthError(new Error('InvalidAccountId'), 'signIn')
    expect(msg).toBe('That email and password did not match.')
  })

  test('a network failure is named as one', () => {
    expect(explainAuthError(new Error('Failed to fetch'), 'signUp')).toMatch(
      /Could not reach the server/,
    )
  })

  test('an unrecognised error is passed through rather than guessed at', () => {
    const msg = explainAuthError(new Error('Server Error: boom'), 'signUp')
    expect(msg).toMatch(/boom/)
  })

  test('a non-Error throw does not crash the handler', () => {
    expect(() => explainAuthError('something odd', 'signIn')).not.toThrow()
  })
})
