import { Component, type ReactNode } from 'react'

/**
 * The last thing between a thrown error and a blank white page.
 *
 * Convex's useQuery re-throws during render, so anything that makes a query
 * unhappy — a document deleted while you were looking at it, a dropped
 * connection, a bug — took the whole app down to nothing. A white screen tells
 * you neither what happened nor what to do about it, and is indistinguishable
 * from the app failing to load at all.
 *
 * It is deliberately plain. It has to render when everything else has failed,
 * so it uses nothing that could itself be broken: no queries, no context, no
 * router.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="grid min-h-svh place-items-center bg-white px-6">
        <div className="max-w-sm text-center">
          <p className="text-lg font-semibold tracking-tight text-stone-900">
            Something went wrong
          </p>
          <p className="mt-2 text-sm text-stone-500">
            Nothing was lost — this is the screen, not your money. Going back to
            the overview usually clears it.
          </p>
          {/* The message, quietly. Enough to report, not enough to alarm. */}
          <p className="mt-3 text-xs break-words text-stone-400">
            {error.message}
          </p>
          <button
            onClick={() => {
              // A full load rather than setState: whatever state got the app
              // here is exactly what should not be kept.
              window.location.href = '/'
            }}
            className="mt-6 min-h-11 rounded-full bg-brand px-4 text-sm font-medium text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            Back to the overview
          </button>
        </div>
      </div>
    )
  }
}
