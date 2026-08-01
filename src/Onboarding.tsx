import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'

const card =
  'w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-6'
const input =
  'w-full rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-neutral-900 outline-none focus-visible:border-violet-500 focus-visible:ring-2 focus-visible:ring-violet-200'
const primary =
  'w-full rounded-lg bg-[#7C3AED] px-3 py-2.5 font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7C3AED] disabled:opacity-60'

/** First-run screen when the signed-in user belongs to no household yet. */
export function CreateHousehold() {
  const create = useMutation(api.households.create)
  const [submitting, setSubmitting] = useState(false)

  return (
    <div className="min-h-svh grid place-items-center bg-neutral-50 px-6">
      <div className={card}>
        <h1 className="text-xl font-semibold tracking-tight text-neutral-900">
          Create your household
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          You can invite someone else once it's set up.
        </p>
        <form
          className="mt-5 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault()
            setSubmitting(true)
            const data = new FormData(e.currentTarget)
            try {
              await create({
                name: String(data.get('name')),
                displayName: String(data.get('displayName')),
              })
            } finally {
              setSubmitting(false)
            }
          }}
        >
          <label className="block">
            <span className="text-sm text-neutral-600">Household name</span>
            <input name="name" required placeholder="Home" className={input} />
          </label>
          <label className="block">
            <span className="text-sm text-neutral-600">Your name</span>
            <input
              name="displayName"
              required
              placeholder="Srđan"
              className={input}
            />
          </label>
          <button type="submit" disabled={submitting} className={primary}>
            {submitting ? 'Creating…' : 'Create household'}
          </button>
        </form>
      </div>
    </div>
  )
}

/** Join flow reached via a ?invite=<token> link. */
export function AcceptInvite({
  token,
  onDone,
}: {
  token: string
  onDone: () => void
}) {
  const preview = useQuery(api.invites.preview, { token })
  const accept = useMutation(api.invites.accept)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (preview === undefined) {
    return <Centered>Loading invite…</Centered>
  }

  if (preview.status !== 'valid') {
    const message =
      preview.status === 'expired'
        ? 'This invite has expired.'
        : preview.status === 'used'
          ? 'This invite has already been used.'
          : 'This invite link is not valid.'
    return (
      <Centered>
        <div className={card}>
          <p className="text-neutral-700">{message}</p>
          <button className={`${primary} mt-4`} onClick={onDone}>
            Continue
          </button>
        </div>
      </Centered>
    )
  }

  return (
    <Centered>
      <div className={card}>
        <h1 className="text-xl font-semibold tracking-tight text-neutral-900">
          Join {preview.householdName ?? 'this household'}
        </h1>
        <form
          className="mt-5 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault()
            setSubmitting(true)
            setError(null)
            const data = new FormData(e.currentTarget)
            try {
              await accept({ token, displayName: String(data.get('displayName')) })
              onDone()
            } catch {
              setError('Could not join with this invite.')
              setSubmitting(false)
            }
          }}
        >
          <label className="block">
            <span className="text-sm text-neutral-600">Your name</span>
            <input
              name="displayName"
              required
              placeholder="Partner"
              className={input}
            />
          </label>
          {error && <p className="text-sm text-[#D85A30]">{error}</p>}
          <button type="submit" disabled={submitting} className={primary}>
            {submitting ? 'Joining…' : 'Join household'}
          </button>
        </form>
      </div>
    </Centered>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-svh grid place-items-center bg-neutral-50 px-6">
      {children}
    </div>
  )
}
