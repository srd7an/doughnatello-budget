import type { ReactNode } from 'react'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { HouseholdProvider } from '../household/HouseholdContext'
import { PeriodProvider } from '../period/PeriodContext'

/**
 * Rendering a screen the way the app does, minus the network.
 *
 * `convex/react` is mocked rather than pointed at a fake server: these tests
 * are about whether a screen DRAWS — one Add button, a form that appears, a
 * page that does not come back blank — and every one of those questions is
 * answered by the component tree alone. The data layer already has its own
 * suite, against a real Convex runtime, where the counting rules belong.
 *
 * Queries are looked up by the name Convex generates for them, so a fixture
 * says `'transactions:listMonth'` and reads like the function it stands for.
 */
/**
 * Hoisted, because `vi.mock` factories are lifted above the imports and cannot
 * see a normal one — the lookup silently failed and every query answered
 * `undefined`, which looks exactly like data that has not arrived.
 */
const { getFunctionName } = await vi.hoisted(
  async () => await import('convex/server'),
)

export type Fixtures = Record<string, unknown>

let fixtures: Fixtures = {}

/** What each query answers with. Anything unlisted stays `undefined`, which
 *  is how a component sees a query that has not landed yet — the loading
 *  state is a state worth testing, not an accident to paper over. */
export function setFixtures(next: Fixtures) {
  fixtures = next
}

// Sign-out lives behind the same wall as the queries; the shell only needs it
// to exist.
vi.mock('@convex-dev/auth/react', () => ({
  useAuthActions: () => ({ signIn: vi.fn(), signOut: vi.fn() }),
}))

vi.mock('convex/react', () => ({
  useQuery: (fn: unknown, args: unknown) => {
    if (args === 'skip') return undefined
    return fixtures[nameOf(fn)]
  },
  useMutation: () => vi.fn(async () => undefined),
  useAction: () => vi.fn(async () => undefined),
  Authenticated: ({ children }: { children: ReactNode }) => children,
  Unauthenticated: () => null,
  AuthLoading: () => null,
  ConvexProvider: ({ children }: { children: ReactNode }) => children,
}))

/** Convex's own answer to "which function is this?" — the same string the
 *  client sends over the wire, so a fixture key cannot drift from the call. */
function nameOf(fn: unknown): string {
  try {
    return getFunctionName(fn as never)
  } catch {
    // A reference Convex cannot name is one no fixture can answer; treat it as
    // a query that has not landed rather than crashing the render.
    return '<unnamed>'
  }
}

const HOUSEHOLD = {
  _id: 'h1' as never,
  name: 'Home',
  baseCurrency: 'RSD',
  role: 'admin' as const,
  displayName: 'Me',
}

export function renderScreen(ui: ReactNode, { route = '/' } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <HouseholdProvider households={[HOUSEHOLD]}>
        <PeriodProvider>{ui}</PeriodProvider>
      </HouseholdProvider>
    </MemoryRouter>,
  )
}
