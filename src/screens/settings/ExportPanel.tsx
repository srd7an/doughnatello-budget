import { useState } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { useHousehold } from '../../household/HouseholdContext'
import { downloadFile, paraToDecimal, toCsv } from '../../lib/csv'
import { localISO } from '../../lib/dates'
import { Card, Empty, Loading, Note, Panel, PrimaryButton } from './kit'

const HEADERS = [
  'Date',
  'Type',
  'Amount',
  'Category',
  'Fund',
  'Paid from fund',
  'Payee',
  'Note',
  'Paid by',
]

/**
 * Take your money elsewhere.
 *
 * Every transaction, with names instead of ids and amounts as plain decimals a
 * spreadsheet can sum. Nothing is filtered and nothing is summarised — an export
 * that only gives you the app's opinion of your data is not an export.
 */
export function ExportPanel() {
  const { household } = useHousehold()
  const rows = useQuery(api.exports.transactions, { householdId: household._id })
  const [done, setDone] = useState(false)

  if (rows === undefined) return <Loading />

  const filename = `${household.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-transactions-${localISO(new Date())}.csv`

  const download = () => {
    const csv = toCsv(
      HEADERS,
      rows.map((r) => [
        r.date,
        r.direction,
        paraToDecimal(r.amount),
        r.category,
        r.fund,
        r.fundedFrom,
        r.payee,
        r.note,
        r.paidBy,
      ]),
    )
    downloadFile(filename, csv)
    setDone(true)
  }

  return (
    <Panel
      description="Your money, in a file you own. Nothing here locks your history into this app."
    >
      {rows.length === 0 ? (
        <Empty>Nothing to export yet.</Empty>
      ) : (
        <>
          <Card className="p-4">
            <p className="text-sm">
              <span data-money className="font-semibold">
                {rows.length}
              </span>{' '}
              {rows.length === 1 ? 'transaction' : 'transactions'}, from{' '}
              {rows[0].date} to {rows[rows.length - 1].date}.
            </p>
            <p className="mt-1 text-xs text-stone-400">
              Downloads as {filename}
            </p>
          </Card>

          <PrimaryButton onClick={download}>
            {done ? 'Download again' : 'Download CSV'}
          </PrimaryButton>

          <Card className="overflow-x-auto p-4">
            <p className="text-xs font-medium tracking-wide text-stone-400 uppercase">
              Columns
            </p>
            <p className="mt-1.5 font-mono text-xs whitespace-nowrap text-stone-600">
              {HEADERS.join(', ')}
            </p>
          </Card>
        </>
      )}

      <Note>
        Amounts are plain decimals (44413.00) so a spreadsheet reads them as
        numbers. "Paid from fund" tells you an expense came out of a fund rather
        than that month's income — without it the totals will not reconcile.
      </Note>
    </Panel>
  )
}
