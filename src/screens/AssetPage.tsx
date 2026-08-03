import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { formatMoney } from '../lib/format'
import { CategoryIcon } from '../ui/icons'

/** A value older than this is probably fiction, so the page says so. */
const STALE_DAYS = 365

/**
 * One asset and everything it has been worth.
 *
 * An asset has no transactions — nothing is ever spent from a flat — so where
 * a fund's page lists money moving, this one lists the only thing an asset
 * does: change value. Each entry is a dated observation, and the difference
 * between two of them is what the year's net-worth change reads.
 */
export function AssetPage() {
  const { assetId } = useParams<{ assetId: string }>()
  const navigate = useNavigate()
  const asset = useQuery(
    api.assets.detail,
    assetId ? { assetId: assetId as Id<'assets'> } : 'skip',
  )

  if (asset === undefined) {
    return <p className="py-8 text-center text-sm text-stone-400">Loading…</p>
  }

  const age = Math.round(
    (Date.now() - Date.parse(asset.valuedOn)) / 86_400_000,
  )
  const stale = age > STALE_DAYS
  // Against the entry before it, so each row says what that re-valuation did.
  const withChange = asset.history.map((h, i) => ({
    ...h,
    change: i < asset.history.length - 1 ? h.value - asset.history[i + 1].value : null,
  }))

  return (
    <div className="space-y-6">
      <section>
        <p className="flex items-center gap-2 text-sm text-stone-500">
          <CategoryIcon icon={asset.icon} className="shrink-0 text-stone-500" />
          {asset.name}
          {asset.isArchived && (
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">
              Archived
            </span>
          )}
        </p>
        <p className="tnum mt-1">
          <span className="text-[32px] leading-none text-stone-800">
            {formatMoney(asset.value)}
          </span>
          <span className="ml-2 text-sm text-stone-500">worth today</span>
        </p>
        <p
          className={`mt-1 text-xs ${stale ? 'text-status-near' : 'text-stone-400'}`}
        >
          Valued {asset.valuedOn}
          {stale && ' · over a year ago, worth checking'}
          {asset.linkedDebt && ` · bought with ${asset.linkedDebt.name}`}
        </p>

        <button
          onClick={() => navigate(`/settings/assets/${asset._id}`)}
          className="mt-4 flex min-h-11 items-center rounded-full border border-stone-200 px-4 text-sm text-stone-700 hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:min-h-9"
        >
          Edit in settings
        </button>
      </section>

      <section>
        <h2 className="mb-3 text-base font-medium tracking-[-0.16px] text-stone-800">
          What it has been worth
        </h2>
        <ul className="flex flex-col gap-1">
          {withChange.map((h) => (
            <li
              key={h._id}
              className="flex min-h-11 items-center gap-3 border-b border-dashed border-stone-300 px-3 py-1.5 text-sm sm:min-h-9"
            >
              <span className="shrink-0 text-stone-600">{h.valuedOn}</span>
              <span className="min-w-0 flex-1 truncate text-stone-500">
                {h.note ?? ''}
              </span>
              {h.change !== null && h.change !== 0 && (
                <span
                  data-money
                  className={`shrink-0 text-sm ${h.change > 0 ? 'text-gain' : 'text-debt'}`}
                >
                  {formatMoney(h.change, { signed: true })}
                </span>
              )}
              <span
                data-money
                className="w-[110px] shrink-0 text-right font-medium text-stone-800"
              >
                {formatMoney(h.value)}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-stone-400">
          The first entry is what it was worth when you wrote it down, so it
          counts as no change — an asset appearing is not a year's gain.
        </p>
      </section>
    </div>
  )
}
