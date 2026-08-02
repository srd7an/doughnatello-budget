import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useAuthActions } from '@convex-dev/auth/react'
import { SignOutIcon, XIcon } from '../../ui/icons'
import { AccountsPanel } from './AccountsPanel'
import { FundsPanel } from './FundsPanel'
import { AssetsPanel } from './AssetsPanel'
import { LoansPanel } from './LoansPanel'
import { CategoriesPanel } from './CategoriesPanel'
import { PeoplePanel } from './PeoplePanel'
import { InvitesPanel } from './InvitesPanel'
import { FormatPanel } from './FormatPanel'
import { ExportPanel } from './ExportPanel'
import { ImportPanel } from './ImportPanel'
import { Repeating } from '../Repeating'

/**
 * Settings as a modal: a sidebar of sections on the left, one section's body on
 * the right. Config, not flow — it sits ON the app rather than replacing it, so
 * you never lose your place in the month you were reading.
 */

type SectionId =
  | 'accounts' | 'funds' | 'assets' | 'loans'
  | 'categories' | 'repeating'
  | 'people' | 'invites'
  | 'format' | 'export' | 'import'

const GROUPS: { label: string; items: { id: SectionId; label: string }[] }[] = [
  {
    label: 'Set up',
    items: [
      { id: 'accounts', label: 'Account & bank' },
      { id: 'funds', label: 'Funds' },
      { id: 'assets', label: 'Assets' },
      { id: 'loans', label: 'Loans' },
    ],
  },
  {
    label: 'Organizing',
    items: [
      { id: 'categories', label: 'Categories' },
      { id: 'repeating', label: 'Repeating' },
    ],
  },
  {
    label: 'Household',
    items: [
      { id: 'people', label: 'People' },
      { id: 'invites', label: 'Invites' },
    ],
  },
  {
    label: 'App',
    items: [
      { id: 'format', label: 'Currency & format' },
      { id: 'export', label: 'Export data' },
      { id: 'import', label: 'Import data' },
    ],
  },
]

const BODIES: Record<SectionId, () => ReactNode> = {
  accounts: () => <AccountsPanel />,
  funds: () => <FundsPanel />,
  assets: () => <AssetsPanel />,
  loans: () => <LoansPanel />,
  categories: () => <CategoriesPanel />,
  repeating: () => <Repeating />,
  people: () => <PeoplePanel />,
  invites: () => <InvitesPanel />,
  format: () => <FormatPanel />,
  export: () => <ExportPanel />,
  import: () => <ImportPanel />,
}

/**
 * Unsaved-changes plumbing. A panel with a dirty form reports it here and the
 * modal renders the Save/Discard bar — one bar in one place, rather than each
 * panel growing its own and drifting.
 */
type FooterState = {
  dirty: boolean
  saving?: boolean
  onSave: () => void | Promise<unknown>
  onDiscard: () => void
} | null

const FooterContext = createContext<(s: FooterState) => void>(() => {})

/** Call from a panel whenever its dirty state changes. */
export function useSettingsFooter(state: FooterState) {
  const set = useContext(FooterContext)
  const dirty = state?.dirty ?? false
  const saving = state?.saving ?? false
  // Deliberately keyed on the flags, not the callbacks: panels rebuild their
  // handlers every render, and depending on those would loop.
  useEffect(() => {
    set(state)
    return () => set(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, saving])
}

export function SettingsModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { signOut } = useAuthActions()
  const [section, setSection] = useState<SectionId>('accounts')
  const [footer, setFooter] = useState<FooterState>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    restoreTo.current = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      restoreTo.current?.focus()
    }
  }, [open, onClose])

  if (!open) return null

  const title =
    GROUPS.flatMap((g) => g.items).find((i) => i.id === section)?.label ?? ''

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-stone-900/30 p-0 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full flex-col overflow-hidden bg-white outline-none sm:h-[min(680px,90vh)] sm:max-w-4xl sm:flex-row sm:rounded-2xl sm:border sm:border-stone-200 sm:shadow-[0px_6px_10px_-4px_rgba(0,0,0,0.1)]"
      >
        {/* Sidebar. On mobile it becomes a scrolling strip above the body. */}
        <nav className="flex shrink-0 gap-6 overflow-x-auto border-b border-stone-200 bg-stone-50 px-3 py-3 sm:w-60 sm:flex-col sm:gap-8 sm:overflow-y-auto sm:border-r sm:border-b-0 sm:py-6">
          {GROUPS.map((group) => (
            <div key={group.label} className="shrink-0 sm:w-full">
              <p className="px-3 text-xs text-stone-600">{group.label}</p>
              <div className="mt-2 flex gap-1 sm:mt-2 sm:flex-col sm:gap-0">
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setSection(item.id)}
                    aria-current={section === item.id}
                    className={`min-h-9 w-full rounded-lg px-3 py-1.5 text-left text-sm font-medium whitespace-nowrap text-stone-800 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand ${
                      section === item.id ? 'bg-stone-200' : 'hover:bg-stone-100'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          ))}

          <button
            onClick={() => void signOut()}
            className="mt-auto flex min-h-9 shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-stone-800 hover:bg-stone-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
          >
            <SignOutIcon size={20} aria-hidden />
            Sign out
          </button>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start justify-between px-6 pt-5">
            <h2 className="text-base font-semibold text-stone-800">{title}</h2>
            <button
              onClick={onClose}
              aria-label="Close settings"
              className="grid size-8 place-items-center rounded-full text-stone-600 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <XIcon size={20} aria-hidden />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-6">
            <FooterContext.Provider value={setFooter}>
              {BODIES[section]()}
            </FooterContext.Provider>
          </div>

          {footer?.dirty && (
            <div className="flex shrink-0 items-center gap-2.5 border-t border-stone-200 bg-stone-50 px-6 py-3">
              <button
                onClick={() => void footer.onSave()}
                disabled={footer.saving}
                className="min-h-9 w-20 rounded-full border border-violet-800 bg-brand text-sm font-medium text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-40"
              >
                {footer.saving ? '…' : 'Save'}
              </button>
              <button
                onClick={footer.onDiscard}
                disabled={footer.saving}
                className="min-h-9 w-20 rounded-full border border-violet-300 bg-white text-sm font-medium text-brand hover:bg-violet-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-40"
              >
                Discard
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
