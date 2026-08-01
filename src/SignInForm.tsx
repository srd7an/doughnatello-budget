import { useState } from 'react'
import { useAuthActions } from '@convex-dev/auth/react'

/**
 * Public signup + sign in with email and password. Pre-Phase-3 styling — the
 * real designed auth screen arrives with the Figma work.
 */
export function SignInForm() {
  const { signIn } = useAuthActions()
  const [flow, setFlow] = useState<'signUp' | 'signIn'>('signUp')
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
            } catch {
              setError(
                flow === 'signUp'
                  ? 'Could not sign up. That email may already be in use.'
                  : 'That email and password did not match.',
              )
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
          <input
            name="password"
            type="password"
            required
            autoComplete={
              flow === 'signUp' ? 'new-password' : 'current-password'
            }
            placeholder="Password"
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
