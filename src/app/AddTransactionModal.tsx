import { Modal } from '../ui/Modal'
import { TransactionForm } from './TransactionForm'

/**
 * The most important screen in the app: log an expense in a few seconds.
 * Amount-focused, everything else defaulted (expense · primary account ·
 * today · you).
 *
 * The form itself is shared with editing — see TransactionForm. This is only
 * the chrome around it. Modal unmounts its children when closed, so each open
 * starts from a fresh form with no state to reset.
 */
export function AddTransactionModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  return (
    <Modal open={open} onClose={onClose} title="Add transaction">
      <TransactionForm onDone={onClose} />
    </Modal>
  )
}
