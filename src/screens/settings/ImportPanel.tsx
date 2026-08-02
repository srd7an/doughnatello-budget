import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { useHousehold } from '../../household/HouseholdContext'
import {
  IMPORT_FIELDS,
  decimalToPara,
  guessMapping,
  parseCsv,
  parseDateInput,
  type ImportField,
} from '../../lib/csv'
import {
  Card,
  Empty,
  GhostButton,
  Note,
  Panel,
  PrimaryButton,
  inputClass,
} from './kit'

type Row = {
  date: string
  direction: 'income' | 'expense' | 'transfer'
  amount: number
  category?: string
  fund?: string
  payee?: string
  note?: string
}

/**
 * Bring transactions in from a CSV.
 *
 * Three steps, deliberately: choose a file, confirm which column is which, then
 * see exactly what will happen before anything is written. Import is the one
 * action here that can quietly double a year of history, so the preview is not
 * a nicety — it is the whole feature.
 *
 * A file this app exported needs no mapping; the columns are recognised by name.
 */
export function ImportPanel() {
  const { household } = useHousehold()
  const householdId = household._id

  const accounts = useQuery(api.accounts.list, { householdId })
  const preview = useMutation(api.imports.preview)
  const commit = useMutation(api.imports.commit)

  const [fileName, setFileName] = useState<string | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [body, setBody] = useState<string[][]>([])
  const [mapping, setMapping] = useState<Record<ImportField, number>>()
  const [accountId, setAccountId] = useState<Id<'accounts'> | ''>('')
  const [createMissing, setCreateMissing] = useState(false)
  const [report, setReport] = useState<Awaited<
    ReturnType<typeof preview>
  > | null>(null)
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof commit>
  > | null>(null)
  const [busy, setBusy] = useState(false)

  const reset = () => {
    setFileName(null)
    setHeaders([])
    setBody([])
    setMapping(undefined)
    setReport(null)
    setResult(null)
  }

  const onFile = async (file: File) => {
    const rows = parseCsv(await file.text())
    if (rows.length < 2) return
    setFileName(file.name)
    setHeaders(rows[0])
    setBody(rows.slice(1))
    setMapping(guessMapping(rows[0]))
    setReport(null)
    setResult(null)
  }

  /** Turn the mapped columns into rows the server will accept. */
  const buildRows = (): Row[] => {
    if (!mapping) return []
    const cell = (r: string[], f: ImportField) =>
      mapping[f] >= 0 ? (r[mapping[f]] ?? '').trim() : ''

    return body.map((r) => {
      const rawAmount = cell(r, 'amount')
      const para = decimalToPara(rawAmount) ?? 0
      const rawDirection = cell(r, 'direction').toLowerCase()

      // A bank export has no "type" column — the sign carries it instead.
      const direction: Row['direction'] =
        rawDirection === 'income' || rawDirection === 'transfer'
          ? rawDirection
          : rawDirection === 'expense'
            ? 'expense'
            : para < 0
              ? 'expense'
              : 'income'

      return {
        date: parseDateInput(cell(r, 'date')) ?? cell(r, 'date'),
        direction,
        amount: Math.abs(para),
        category: cell(r, 'category') || undefined,
        fund: cell(r, 'fund') || undefined,
        payee: cell(r, 'payee') || undefined,
        note: cell(r, 'note') || undefined,
      }
    })
  }

  const runPreview = async () => {
    setBusy(true)
    try {
      setReport(await preview({ householdId, rows: buildRows() }))
    } finally {
      setBusy(false)
    }
  }

  const runImport = async () => {
    setBusy(true)
    try {
      setResult(
        await commit({
          householdId,
          rows: buildRows(),
          accountId: accountId || undefined,
          createMissingCategories: createMissing,
        }),
      )
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <Panel>
        <Card className="p-4">
          <p className="text-sm">
            Imported <strong>{result.imported}</strong> transaction
            {result.imported === 1 ? '' : 's'}
            {result.skipped > 0 && `, skipped ${result.skipped}`}
            {result.createdCategories > 0 &&
              `, created ${result.createdCategories} categor${result.createdCategories === 1 ? 'y' : 'ies'}`}
            .
          </p>
          {result.errors.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-stone-500">
              {result.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </Card>
        <PrimaryButton onClick={reset}>Import another file</PrimaryButton>
      </Panel>
    )
  }

  return (
    <Panel description="Bring in transactions from a CSV — a file this app exported, or one from your bank.">
      <div>
        <label className="flex min-h-11 w-fit cursor-pointer items-center gap-2 rounded-full border border-stone-300 bg-white px-4 text-sm font-medium text-stone-800 hover:bg-stone-50">
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void onFile(f)
            }}
          />
          {fileName ? 'Choose a different file' : 'Choose a CSV file'}
        </label>
        {fileName && (
          <p className="mt-2 text-xs text-stone-500">
            {fileName} · {body.length} row{body.length === 1 ? '' : 's'}
          </p>
        )}
      </div>

      {mapping && (
        <>
          <Card className="space-y-3 p-4">
            <p className="text-xs font-medium tracking-wide text-stone-400 uppercase">
              Which column is which
            </p>
            {IMPORT_FIELDS.map((field) => (
              <label key={field} className="flex items-center gap-3">
                <span className="w-24 shrink-0 text-sm font-medium text-stone-800 capitalize">
                  {field}
                </span>
                <select
                  value={mapping[field]}
                  onChange={(e) =>
                    setMapping({ ...mapping, [field]: Number(e.target.value) })
                  }
                  className={`${inputClass} flex-1`}
                >
                  <option value={-1}>— not in this file —</option>
                  {headers.map((h, i) => (
                    <option key={`${h}-${i}`} value={i}>
                      {h || `Column ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <p className="text-xs text-stone-400">
              No Type column? A negative amount is read as an expense and a
              positive one as income.
            </p>
          </Card>

          {accounts && accounts.length > 1 && (
            <label className="flex items-center gap-3">
              <span className="w-24 shrink-0 text-sm font-medium text-stone-800">
                Into account
              </span>
              <select
                value={accountId}
                onChange={(e) =>
                  setAccountId(e.target.value as Id<'accounts'> | '')
                }
                className={`${inputClass} flex-1`}
              >
                <option value="">
                  {accounts.find((a) => a.isPrimary)?.name ?? 'Default'}
                </option>
                {accounts.map((a) => (
                  <option key={a._id} value={a._id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="flex items-center gap-2 text-sm text-stone-600">
            <input
              type="checkbox"
              checked={createMissing}
              onChange={(e) => setCreateMissing(e.target.checked)}
              className="size-4 accent-brand"
            />
            Create categories that don't exist yet
          </label>

          <div className="flex gap-2">
            <PrimaryButton onClick={runPreview} disabled={busy}>
              {busy ? 'Checking…' : 'Check the file'}
            </PrimaryButton>
            {report && (
              <GhostButton onClick={runImport} disabled={busy || report.importable === 0}>
                Import {report.importable} row
                {report.importable === 1 ? '' : 's'}
              </GhostButton>
            )}
          </div>
        </>
      )}

      {report && (
        <Card className="p-4">
          <div className="flex flex-wrap gap-6 text-sm">
            <Figure label="Will import" value={report.importable} tone="gain" />
            <Figure label="Already here" value={report.duplicates} />
            <Figure label="Unreadable" value={report.invalid} tone="debt" />
          </div>

          {report.problems.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-debt">
              {report.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}

          {report.unknownCategories.length > 0 && (
            <p className="mt-3 text-xs text-stone-600">
              Categories not in this household:{' '}
              <strong>{report.unknownCategories.join(', ')}</strong>. Tick
              "create categories" above, or rename them in the file.
            </p>
          )}
          {report.unknownFunds.length > 0 && (
            <p className="mt-2 text-xs text-stone-600">
              Funds not in this household:{' '}
              <strong>{report.unknownFunds.join(', ')}</strong>. Create them in
              Funds first — transfers cannot invent one.
            </p>
          )}
          {report.duplicates > 0 && (
            <p className="mt-2 text-xs text-stone-600">
              Rows already matching a transaction here (same day, amount and
              payee) are skipped, so importing the same file twice is safe.
            </p>
          )}
        </Card>
      )}

      {!fileName && (
        <Empty>
          Exported from this app? The columns will be recognised automatically.
        </Empty>
      )}

      <Note>
        Amounts may use either format: 44.413,00 or 44413.00. Dates must be
        YYYY-MM-DD. Nothing is written until you press Import.
      </Note>
    </Panel>
  )
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: 'gain' | 'debt'
}) {
  return (
    <div>
      <p className="text-xs text-stone-500">{label}</p>
      <p
        data-money
        className={`text-lg font-semibold ${
          value === 0 ? 'text-stone-400' : tone === 'gain' ? 'text-gain' : tone === 'debt' ? 'text-debt' : 'text-stone-800'
        }`}
      >
        {value}
      </p>
    </div>
  )
}
