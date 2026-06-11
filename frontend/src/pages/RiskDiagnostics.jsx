import { useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell, Label,
} from 'recharts'
import { useRecommendations } from '../hooks/useData'
import { useFilters } from '../hooks/useFilters'
import { CITYWIDE_STORE_MIN } from '../utils/constants'
import { getCityName } from '../utils/cityMap'
import FilterBar from '../components/FilterBar'
import ClassBadge from '../components/ClassBadge'
import { LoadingSpinner, ErrorState } from '../components/LoadingState'

const AXIS_LABEL = { fontSize: 11, fill: '#64748b' }

const fmtNum = (v) => Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })

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
      if (!agg[r.sku_id]) agg[r.sku_id] = { sku: String(r.sku_id), recovered: 0 }
      agg[r.sku_id].recovered += r.recovered_units ?? 0
    })
    return Object.values(agg)
      .map(s => ({ sku: s.sku, recovered: Math.round(s.recovered) }))
      .sort((a, b) => b.recovered - a.recovered).slice(0, 15)
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

  /* Promo vs non-promo average sales */
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
      { group: 'During Promotions',  avg: promoN ? +(promoSum / promoN).toFixed(1) : 0 },
      { group: 'Without Promotions', avg: baseN  ? +(baseSum  / baseN ).toFixed(1) : 0 },
    ]
  }, [filtered])

  /* Escalation queue */
  const escalationQueue = useMemo(() => {
    const escalated = filtered.filter(r => r.recommendation_class === 'Escalate')
    const HIGH_STOCKOUT = 0.80
    const cityCounts = {}
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
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={stockoutBySku} layout="vertical"
              margin={{ top: 4, right: 32, left: 48, bottom: 36 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" tick={{ fontSize: 11 }} domain={[0, 100]}>
                <Label value="Avg. Stockout Rate (%)" offset={-24} position="insideBottom" style={AXIS_LABEL} />
              </XAxis>
              <YAxis type="category" dataKey="sku" tick={{ fontSize: 11 }} width={44}>
                <Label value="SKU ID" angle={-90} position="insideLeft" offset={-32} style={AXIS_LABEL} />
              </YAxis>
              <Tooltip
                labelFormatter={(sku) => `SKU ${sku}`}
                formatter={(v) => [`${v}%`, 'Avg. Stockout Rate']}
              />
              <Bar dataKey="rate" fill="#ef4444" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <p className="section-title">Stockout Rate by City</p>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={stockoutByCity}
              margin={{ top: 4, right: 16, left: 52, bottom: 52 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="city" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" interval={0}>
                <Label value="City (proxy)" offset={-40} position="insideBottom" style={AXIS_LABEL} />
              </XAxis>
              <YAxis tick={{ fontSize: 11 }}>
                <Label value="Avg. Stockout Rate (%)" angle={-90} position="insideLeft" offset={-38} style={AXIS_LABEL} />
              </YAxis>
              <Tooltip
                labelFormatter={(city) => city}
                formatter={(v) => [`${v}%`, 'Avg. Stockout Rate']}
              />
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
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={recoveredBySku} layout="vertical"
              margin={{ top: 4, right: 24, left: 48, bottom: 36 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" tick={{ fontSize: 11 }}>
                <Label value="Recovered Units (est.)" offset={-24} position="insideBottom" style={AXIS_LABEL} />
              </XAxis>
              <YAxis type="category" dataKey="sku" tick={{ fontSize: 11 }} width={44}>
                <Label value="SKU ID" angle={-90} position="insideLeft" offset={-32} style={AXIS_LABEL} />
              </YAxis>
              <Tooltip
                labelFormatter={(sku) => `SKU ${sku}`}
                formatter={(v) => [fmtNum(v), 'Recovered Units (est.)']}
              />
              <Bar dataKey="recovered" fill="#f97316" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card col-span-1">
          <p className="section-title">Promotion Dependency: Avg Sales</p>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={promoDist} margin={{ top: 4, right: 16, left: 52, bottom: 52 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="group" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" interval={0}>
                <Label value="Sales Period" offset={-40} position="insideBottom" style={AXIS_LABEL} />
              </XAxis>
              <YAxis tick={{ fontSize: 11 }}>
                <Label value="Avg. Units Sold per Row" angle={-90} position="insideLeft" offset={-38} style={AXIS_LABEL} />
              </YAxis>
              <Tooltip
                formatter={(v) => [fmtNum(v), 'Avg. Units Sold']}
              />
              <Bar dataKey="avg" radius={[4, 4, 0, 0]}>
                <Cell fill="#eab308" />
                <Cell fill="#22c55e" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card col-span-1">
          <p className="section-title">Volatility Score Distribution</p>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={volDist} margin={{ top: 4, right: 16, left: 52, bottom: 36 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="range" tick={{ fontSize: 10 }}>
                <Label value="Low Volatility Score (0–100)" offset={-24} position="insideBottom" style={AXIS_LABEL} />
              </XAxis>
              <YAxis tick={{ fontSize: 11 }}>
                <Label value="SKU-Store-Weeks" angle={-90} position="insideLeft" offset={-38} style={AXIS_LABEL} />
              </YAxis>
              <Tooltip formatter={(v) => [v.toLocaleString(), 'SKU-Store-Weeks']} />
              <Bar dataKey="count" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <p className="text-xs text-slate-400 mt-2">Higher score = lower volatility (more stable demand)</p>
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
