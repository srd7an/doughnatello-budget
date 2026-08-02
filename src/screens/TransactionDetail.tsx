import type { Id } from '../../convex/_generated/dataModel'
import { TransactionForm } from '../app/TransactionForm'
import { Modal } from '../ui/Modal'

/**
 * One transaction, opened from the list.
 *
 * Reading and editing are the same view rather than two: there is little here
 * to read, and the thing you want after looking at a transaction is almost
 * always to correct it. It is also the same view as adding one — the same form
 * component, prefilled — because "what can I change afterwards" should never be
 * a shorter list than "what could I set".
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
    <Modal open onClose={onClose} title="Edit transaction">
      <TransactionForm transactionId={transactionId} onDone={onClose} />
    </Modal>
  )
}
