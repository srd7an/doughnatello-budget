import { useState } from 'react'
import { useAuthActions } from '@convex-dev/auth/react'

/**
 * Turn a thrown auth error into something a person can act on.
 *
 * Convex Auth rejects a signup for several reasons — a password under 8
 * characters, an address already registered, a misconfigured deployment — and
 * they arrive as the same kind of thrown Error. Guessing at one cause (this used
 * to always say "that email may already be in use") sends people off to fix a
 * problem they do not have, so match on what the error actually says and only
 * fall back to a vague message when there is genuinely nothing to go on.
 */
export function explainAuthError(e: unknown, flow: 'signUp' | 'signIn'): string {
  const raw = e instanceof Error ? e.message : String(e)

  // The Password provider's own rule: `password.length < 8` throws.
  if (/InvalidSecret|password/i.test(raw) && /short|length|invalid/i.test(raw)) {
    return 'Password must be at least 8 characters.'
  }
  if (/already exists|already in use|duplicate/i.test(raw)) {
    return 'An account with that email already exists — sign in instead.'
  }
  if (/InvalidAccountId|InvalidSecret/i.test(raw)) {
    return flow === 'signUp'
      ? 'Could not create that account. Check the email, and use at least 8 characters for the password.'
      : 'That email and password did not match.'
  }
  if (/fetch|network|Failed to fetch/i.test(raw)) {
    return 'Could not reach the server. Check your connection and try again.'
  }
  return flow === 'signUp'
    ? `Could not sign up. ${raw}`
    : `Could not sign in. ${raw}`
}

/**
 * Public sign in + signup with email and password. Pre-Phase-3 styling — the
 * real designed auth screen arrives with the Figma work.
 *
 * Signing IN is the default: almost everyone arriving here already has an
 * account, and landing them on a signup form makes the common case the one that
 * needs a click. Creating an account is one tap away underneath.
 */
export function SignInForm() {
  const { signIn } = useAuthActions()
  const [flow, setFlow] = useState<'signUp' | 'signIn'>('signIn')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  return (
    <div className="min-h-svh grid place-items-center bg-neutral-50 px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="text-3xl">🍩</div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-neutral-900">
            doughnatello
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            {flow === 'signUp'
              ? 'Create an account to start.'
              : 'Welcome back.'}
          </p>
        </div>

        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault()
            setSubmitting(true)
            setError(null)
            const formData = new FormData(e.currentTarget)
            formData.set('flow', flow)
            try {
              await signIn('password', formData)
            } catch (e) {
              setError(explainAuthError(e, flow))
              setSubmitting(false)
            }
          }}
        >
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="Email"
            className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-neutral-900 outline-none focus-visible:border-violet-500 focus-visible:ring-2 focus-visible:ring-violet-200"
          />
          {/* minLength mirrors the Password provider's own rule, so the browser
              catches it before a round trip does. */}
          <input
            name="password"
            type="password"
            required
            minLength={flow === 'signUp' ? 8 : undefined}
            autoComplete={
              flow === 'signUp' ? 'new-password' : 'current-password'
            }
            placeholder={
              flow === 'signUp' ? 'Password — at least 8 characters' : 'Password'
            }
            className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-neutral-900 outline-none focus-visible:border-violet-500 focus-visible:ring-2 focus-visible:ring-violet-200"
          />

          {error && (
            <p className="text-sm text-[#D85A30]" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-[#7C3AED] px-3 py-2.5 font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7C3AED] disabled:opacity-60"
          >
            {submitting
              ? 'One moment…'
              : flow === 'signUp'
                ? 'Create account'
                : 'Sign in'}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-neutral-500">
          {flow === 'signUp' ? 'Already have an account?' : 'New here?'}{' '}
          <button
            type="button"
            className="font-medium text-[#7C3AED] hover:underline"
            onClick={() => {
              setError(null)
              setFlow(flow === 'signUp' ? 'signIn' : 'signUp')
            }}
          >
            {flow === 'signUp' ? 'Sign in' : 'Create one'}
          </button>
        </p>
      </div>
    </div>
  )
}
