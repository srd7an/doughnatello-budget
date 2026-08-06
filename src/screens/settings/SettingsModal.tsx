import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useAuthActions } from '@convex-dev/auth/react'
import { useHousehold } from '../../household/HouseholdContext'
import { useNavigate } from 'react-router-dom'
import { useKeepPeriod } from '../../period/PeriodContext'
import { Button } from '../../ui/Button'
import { CheckIcon, SignOutIcon, XIcon } from '../../ui/icons'
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

/**
 * `editId` arrives from /settings/funds/<id> — a page that owns a thing links
 * to the panel that can change it, with the thing already open. Panels that
 * hold a list of records take it; the rest ignore it.
 */
const BODIES: Record<SectionId, (editId?: string) => ReactNode> = {
  accounts: () => <AccountsPanel />,
  funds: (editId) => <FundsPanel editId={editId} />,
  assets: (editId) => <AssetsPanel editId={editId} />,
  loans: (editId) => <LoansPanel editId={editId} />,
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

  // The panel rebuilds its handlers on every render, so they cannot go in the
  // dependency list — publishing a new object each render would loop.
  //
  // But keying the effect on the flags alone published the handlers CAPTURED at
  // the moment `dirty` first turned true, which is the first keystroke. Every
  // character after that was invisible to the footer: Save ran a commit that
  // still saw the draft as it had been one letter in. Renaming an account
  // reverted, because clearing the field first made that captured draft empty,
  // which the commit skips — and then it cleared the draft anyway.
  //
  // So the flags still drive the effect, and the handlers are called THROUGH a
  // ref that every render refreshes. Fresh callbacks, no loop.
  const latest = useRef(state)
  latest.current = state

  useEffect(() => {
    if (!latest.current) {
      set(null)
      return
    }
    set({
      dirty,
      saving,
      onSave: () => latest.current?.onSave(),
      onDiscard: () => latest.current?.onDiscard(),
    })
    return () => set(null)
  }, [dirty, saving, set])
}

const SECTION_IDS = new Set(GROUPS.flatMap((g) => g.items).map((i) => i.id))
const isSection = (v: string | undefined): v is SectionId =>
  !!v && SECTION_IDS.has(v as SectionId)

export function SettingsModal({
  open,
  section: sectionParam,
  itemId,
  onClose,
}: {
  open: boolean
  /** From the URL — /settings/funds opens on Funds. */
  section?: string
  /** And /settings/funds/<id> opens that fund's form. */
  itemId?: string
  onClose: () => void
}) {
  const { signOut } = useAuthActions()
  const { household, all, setActive } = useHousehold()
  const navigate = useNavigate()
  const keepPeriod = useKeepPeriod()
  // The URL is the source of truth for which section is showing, so a link to
  // one lands on it and picking another is a navigation like any other.
  const section: SectionId = isSection(sectionParam) ? sectionParam : 'accounts'
  // Replaces rather than pushes: moving between panels is not a new place,
  // it is the same modal showing something else. Pushing meant closing took
  // one Back per section you had looked at. And it carries the period, or the
  // month behind the modal jumps to today the moment you change panel.
  const setSection = (id: SectionId) =>
    navigate(keepPeriod(`/settings/${id}`), { replace: true })
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
                    className={`min-h-11 sm:min-h-9 w-full rounded-lg px-3 py-1.5 text-left text-sm font-medium whitespace-nowrap text-stone-800 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand ${
                      section === item.id ? 'bg-stone-200' : 'hover:bg-stone-100'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          ))}

          {/* Switching household used to live in a dropdown under the avatar,
              which was otherwise a menu of two items that both exist here. It
              belongs beside Sign out: both answer "which account am I in", and
              neither is a section of settings. Shown only when there is more
              than one, since a switcher with one option is a label. */}
          <div className="mt-auto shrink-0">
            {all.length > 1 && (
              <div className="mb-1">
                <p className="px-3 pb-1 text-xs text-stone-400">Households</p>
                {all.map((h) => (
                  <button
                    key={h._id}
                    aria-current={h._id === household._id}
                    onClick={() => setActive(h._id)}
                    className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-left text-sm text-stone-800 hover:bg-stone-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand sm:min-h-9"
                  >
                    <span className="min-w-0 truncate">{h.name}</span>
                    {h._id === household._id && (
                      <CheckIcon size={16} className="shrink-0 text-brand" aria-hidden />
                    )}
                  </button>
                ))}
              </div>
            )}

            <button
              onClick={() => void signOut()}
              className="flex min-h-11 w-full shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-stone-800 hover:bg-stone-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand sm:min-h-9"
            >
              <SignOutIcon size={20} aria-hidden />
              Sign out
            </button>
          </div>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start justify-between px-6 pt-5">
            <h2 className="text-base font-semibold text-stone-800">{title}</h2>
            <button
              onClick={onClose}
              aria-label="Close settings"
              className="grid size-11 sm:size-8 place-items-center rounded-full text-stone-600 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <XIcon size={20} aria-hidden />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-6">
            <FooterContext.Provider value={setFooter}>
              {BODIES[section](itemId)}
            </FooterContext.Provider>
          </div>

          {footer?.dirty && (
            <div className="flex shrink-0 items-center gap-2.5 border-t border-stone-200 bg-stone-50 px-6 py-3">
              <Button
                variant="primary"
                onClick={() => void footer.onSave()}
                disabled={footer.saving}
                className="w-20"
              >
                {footer.saving ? '…' : 'Save'}
              </Button>
              <Button
                onClick={footer.onDiscard}
                disabled={footer.saving}
                className="w-20 border-violet-300 text-brand hover:bg-violet-50"
              >
                Discard
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
