import { Modal } from '../ui/Modal'
import { TransactionForm } from './TransactionForm'

/**
 * Adding a transaction, in the two shapes the design asks for.
 *
 * On a phone it is the bottom sheet everything else uses. From `sm` up it is a
 * popover hanging off the Add transaction button — the thing you pressed stays
 * where it is and the panel appears next to it, which is a smaller
 * interruption than a card in the middle of a dimmed screen for what is often
 * a ten-second job.
 *
 * The desktop panel is positioned by AppShell, which owns the button and the
 * header it sits in; this only decides which of the two to draw. There is no
 * measuring: the header's inner container is the same 800px box the button is
 * aligned to, so `right-0` under it lands exactly under the button.
 */
export function AddTransactionModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  if (!open) return null

  return (
    <>
      {/* Phone: the sheet. */}
      <div className="sm:hidden">
        <Modal open bare onClose={onClose} title="Add transaction">
          <TransactionForm onDone={onClose} />
        </Modal>
      </div>

      {/* Desktop: a click anywhere else closes it, the way a popover should. */}
      <div className="hidden sm:block">
        <button
          aria-label="Close"
          tabIndex={-1}
          onClick={onClose}
          className="fixed inset-0 z-40 cursor-default"
        />
        <div className="absolute top-full right-0 z-50 mt-2 w-[360px] overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-[0px_12px_16px_6px_rgba(0,0,0,0.06)]">
          <TransactionForm onDone={onClose} />
        </div>
      </div>
    </>
  )
}
