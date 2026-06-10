import { useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell, ScatterChart, Scatter, Legend,
} from 'recharts'
import { useRecommendations } from '../hooks/useData'
import { useFilters } from '../hooks/useFilters'
import { CITYWIDE_STORE_MIN } from '../utils/constants'
import { getCityName } from '../utils/cityMap'
import FilterBar from '../components/FilterBar'
import ClassBadge from '../components/ClassBadge'
import { LoadingSpinner, ErrorState } from '../components/LoadingState'

const SUGGESTED_ACTIONS = {
  ESCALATE_STOCKOUT_CENSORED_DEMAND: 'Investigate supply chain. Review safety stock levels.',
  ESCALATE_HIGH_CENSORED_DEMAND:     'Prioritize replenishment. Reported demand is significantly understated.',
  ESCALATE_INSUFFICIENT_DATA:        'Extend observation period before making stocking decisions.',
  REVIEW_HIGH_SALES_VOLATILITY:      'Build buffer stock. Investigate demand drivers (promotions, weather).',
  REVIEW_HIGH_PROMO_DEPENDENCY:      'Test baseline demand with minimal promotion before broad rollout.',
  REVIEW_BORDERLINE_SCORE:           'Request merchant review of sell-through performance.',
  REVIEW_LOW_SCORE:                  'Consider deprioritizing or reducing shelf space.',
  LOCALIZE_CONCENTRATED_DEMAND:      'Restrict distribution to high-demand locations.',
  LOCALIZE_GEOGRAPHIC_CONCENTRATION: 'Pilot in top-performing stores before broader distribution.',
}

export default function RiskDiagnostics() {
  const { data, loading, error } = useRecommendations()
  const { filters, setFilters, options, filtered } = useFilters(data)

  /* Stockout rate by SKU (top 15) */
  const stockoutBySku = useMemo(() => {
    const agg = {}
    filtered.forEach(r => {
      if (!agg[r.sku_id]) agg[r.sku_id] = { sku: String(r.sku_id), sum: 0, n: 0 }
      agg[r.sku_id].sum += r.stockout_rate ?? 0
      agg[r.sku_id].n++
    })
    return Object.values(agg)
      .map(s => ({ sku: s.sku, rate: +(s.sum / s.n * 100).toFixed(1) }))
      .sort((a, b) => b.rate - a.rate).slice(0, 15)
  }, [filtered])

  /* Stockout by city */
  const stockoutByCity = useMemo(() => {
    const agg = {}
    filtered.forEach(r => {
      const c = String(r.city_id)
      if (!agg[c]) agg[c] = { city: c, sum: 0, n: 0 }
      agg[c].sum += r.stockout_rate ?? 0
      agg[c].n++
    })
    return Object.values(agg)
      .map(s => ({ city: getCityName(s.city), rate: +(s.sum / s.n * 100).toFixed(1) }))
      .sort((a, b) => b.rate - a.rate)
  }, [filtered])

  /* Recovered demand by SKU (top 15) */
  const recoveredBySku = useMemo(() => {
    const agg = {}
    filtered.forEach(r => {
      if (!agg[r.sku_id]) agg[r.sku_id] = { sku: String(r.sku_id), val: 0 }
      agg[r.sku_id].val += r.recovered_units ?? 0
    })
    return Object.values(agg)
      .sort((a, b) => b.val - a.val).slice(0, 15)
  }, [filtered])

  /* Volatility distribution */
  const volDist = useMemo(() => {
    const bins = Array.from({ length: 10 }, (_, i) => ({
      range: `${i * 10}–${i * 10 + 10}`, count: 0,
    }))
    filtered.forEach(r => {
      const idx = Math.min(Math.floor((r.low_volatility_score ?? 0) / 10), 9)
      bins[idx].count++
    })
    return bins
  }, [filtered])

  /* Promo vs non-promo average sales (simple split) */
  const promoDist = useMemo(() => {
    let promoSum = 0, promoN = 0, baseSum = 0, baseN = 0
    filtered.forEach(r => {
      const sales = r.observed_units ?? 0
      const promoDep = 1 - (r.promo_independence_score ?? 50) / 100
      const isPromo = promoDep > 0.5
      if (isPromo) { promoSum += sales; promoN++ }
      else         { baseSum  += sales; baseN++ }
    })
    return [
      { group: 'During Promotions',    avg: promoN ? +(promoSum / promoN).toFixed(1) : 0 },
      { group: 'Without Promotions',   avg: baseN  ? +(baseSum  / baseN ).toFixed(1) : 0 },
    ]
  }, [filtered])

  /* Escalation queue + stockout pattern classification */
  const escalationQueue = useMemo(() => {
    const escalated = filtered.filter(r => r.recommendation_class === 'Escalate')

    // Build lookup: for each (sku_id, city_id, week_label), count how many distinct
    // stores have a high stockout rate (> escalate threshold proxy = 0.80)
    const HIGH_STOCKOUT = 0.80
    const cityCounts = {}  // key → Set of store_ids
    escalated.forEach(r => {
      if ((r.stockout_rate ?? 0) > HIGH_STOCKOUT) {
        const key = `${r.sku_id}||${r.city_id}||${r.week_label}`
        if (!cityCounts[key]) cityCounts[key] = new Set()
        cityCounts[key].add(String(r.store_id))
      }
    })

    return escalated
      .sort((a, b) => (b.stockout_rate ?? 0) - (a.stockout_rate ?? 0))
      .slice(0, 100)
      .map(r => {
        const key = `${r.sku_id}||${r.city_id}||${r.week_label}`
        const storeCount = cityCounts[key]?.size ?? 0
        const pattern = storeCount >= CITYWIDE_STORE_MIN
          ? 'City-wide (possible vendor/DC issue)'
          : 'Store-isolated (possible ops issue)'
        const patternClass = storeCount >= CITYWIDE_STORE_MIN
          ? 'text-orange-600 font-semibold'
          : 'text-slate-500'
        return { ...r, stockoutPattern: pattern, patternClass }
      })
  }, [filtered])

  if (loading) return <LoadingSpinner />
  if (error)   return <ErrorState message={error} />

  return (
    <div>
      <h1 className="page-title">Risk Diagnostics</h1>
      <p className="page-subtitle">Identify and prioritize supply, volatility, and demand uncertainty risks.</p>

      <FilterBar filters={filters} setFilters={setFilters} options={options} />

      {/* Chart row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="card">
          <p className="section-title">Top 15 SKUs by Stockout Rate</p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={stockoutBySku} layout="vertical"
              margin={{ top: 4, right: 24, left: 48, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" unit="%" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="sku" tick={{ fontSize: 11 }} width={56} />
              <Tooltip formatter={v => `${v}%`} />
              <Bar dataKey="rate" fill="#ef4444" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <p className="section-title">Stockout Rate by City</p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={stockoutByCity}
              margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="city" tick={{ fontSize: 11 }} />
              <YAxis unit="%" tick={{ fontSize: 11 }} />
              <Tooltip formatter={v => `${v}%`} />
              <Bar dataKey="rate" radius={[4, 4, 0, 0]}>
                {stockoutByCity.map((d, i) => (
                  <Cell key={i} fill={d.rate > 30 ? '#ef4444' : d.rate > 15 ? '#eab308' : '#22c55e'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Chart row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <div className="card col-span-1">
          <p className="section-title">Recovered Demand by SKU (Top 15)</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={recoveredBySku} layout="vertical"
              margin={{ top: 4, right: 24, left: 48, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="sku" tick={{ fontSize: 11 }} width={56} />
              <Tooltip />
              <Bar dataKey="val" fill="#f97316" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card col-span-1">
          <p className="section-title">Promotion Dependency: Avg Sales</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={promoDist} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="group" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="avg" radius={[4, 4, 0, 0]}>
                <Cell fill="#eab308" />
                <Cell fill="#22c55e" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card col-span-1">
          <p className="section-title">Volatility Score Distribution</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={volDist} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="range" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="count" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <p className="text-xs text-slate-400 mt-2">Higher = lower volatility (better)</p>
        </div>
      </div>

      {/* Escalation queue */}
      <div className="card p-0 overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-red-50 flex items-center gap-2">
          <span className="text-red-600 font-bold text-sm">🚨 Escalation Queue</span>
          <span className="text-xs text-red-400">({escalationQueue.length} items)</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-border">
              <tr>
                {['SKU', 'Store', 'City', 'Week', 'Stockout %', 'Hidden Demand', 'Stockout Pattern', 'Reason', 'Suggested Action'].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {escalationQueue.map((row, i) => (
                <tr key={i} className="hover:bg-red-50/40">
                  <td className="px-3 py-2.5 font-mono text-xs">{row.sku_id}</td>
                  <td className="px-3 py-2.5">{row.store_id}</td>
                  <td className="px-3 py-2.5">{getCityName(row.city_id)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{row.week_label}</td>
                  <td className="px-3 py-2.5 text-red-600 font-semibold tabular-nums">
                    {((row.stockout_rate ?? 0) * 100).toFixed(1)}%
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">{row.recovered_units?.toFixed(0) ?? '—'}</td>
                  <td className={`px-3 py-2.5 text-xs max-w-[180px] ${row.patternClass}`}>
                    {row.stockoutPattern}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-500">
                    {row.reason_code?.replace(/_/g, ' ') ?? '—'}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-600 max-w-xs">
                    {SUGGESTED_ACTIONS[row.reason_code] ?? 'Review with merchant team.'}
                  </td>
                </tr>
              ))}
              {!escalationQueue.length && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-slate-400 text-sm">
                    No escalations in current filter selection ✓
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
