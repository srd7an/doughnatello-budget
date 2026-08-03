import { useSearchParams } from 'react-router-dom'
import { Modal } from '../ui/Modal'
import { TransactionForm } from './TransactionForm'
import type { Id } from '../../convex/_generated/dataModel'

/**
 * `/add?copy=<id>` prefills from an existing transaction. It is a search param
 * rather than a route of its own because it does not change WHAT the screen is
 * — it is still Add — only what it starts out holding.
 */
function useCopyOf(): Id<'transactions'> | undefined {
  const [params] = useSearchParams()
  return (params.get('copy') as Id<'transactions'>) ?? undefined
}

/**
 * Adding a transaction, in the two shapes the design asks for — and they are
 * not one component styled two ways, because of where each has to LIVE.
 *
 * The sheet has to be rendered at the root of the page. The header carries
 * `backdrop-blur`, and a backdrop-filter makes an element the containing block
 * for its fixed descendants — so a sheet rendered inside the header is not
 * pinned to the viewport at all, it is pinned to the header, which is how it
 * came to be a strip of form above the page instead of an overlay.
 *
 * The popover has to be rendered inside the header, because it hangs off the
 * button there. It is absolutely positioned, which also keeps it OUT OF FLOW:
 * as an ordinary child of that flex row it counted as an item, and its gap
 * shoved the button left the moment it opened.
 */
export function AddTransactionSheet({ onClose }: { onClose: () => void }) {
  const copyOf = useCopyOf()
  return (
    <Modal
      open
      bare
      onClose={onClose}
      title={copyOf ? 'Duplicate transaction' : 'Add transaction'}
    >
      <TransactionForm copyOf={copyOf} onDone={onClose} />
    </Modal>
  )
}

export function AddTransactionPopover({ onClose }: { onClose: () => void }) {
  const copyOf = useCopyOf()
  return (
    <>
      {/* Anywhere else closes it, the way a popover should. */}
      <button
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default"
      />
      <div className="absolute top-full right-0 z-50 mt-2 w-[360px] overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-[0px_12px_16px_6px_rgba(0,0,0,0.06)]">
        <TransactionForm copyOf={copyOf} onDone={onClose} />
      </div>
    </>
  )
}
