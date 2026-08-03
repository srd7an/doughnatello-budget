import type { Id } from '../../convex/_generated/dataModel'
import { TransactionForm } from '../app/TransactionForm'
import { Modal } from '../ui/Modal'

/**
 * One transaction, opened from a list.
 *
 * The same form as adding one, prefilled — because "what can I change
 * afterwards" should never be a shorter list than "what could I set". It stays
 * a centred sheet rather than a popover: it is opened from a row somewhere down
 * a list, and there is no button for it to hang off.
 */
export function TransactionDetail({
  transactionId,
  onClose,
}: {
  transactionId: Id<'transactions'> | null
  onClose: () => void
}) {
  if (!transactionId) return null

  return (
    <Modal open bare onClose={onClose} title="Edit transaction">
      <TransactionForm transactionId={transactionId} onDone={onClose} />
    </Modal>
  )
}
