import { useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Cell, CartesianGrid, Label,
} from 'recharts'
import { useRecommendations } from '../hooks/useData'
import { useFilters } from '../hooks/useFilters'
import { CLASS_COLORS, AVG_UNIT_VALUE } from '../utils/constants'
import { getCityName } from '../utils/cityMap'
import KpiCard from '../components/KpiCard'
import FilterBar from '../components/FilterBar'
import { LoadingSpinner, ErrorState } from '../components/LoadingState'

// Shared axis label style
const AXIS_LABEL = { fontSize: 11, fill: '#64748b' }

export default function Overview() {
  const { data, loading, error } = useRecommendations()
  const { filters, setFilters, options, filtered } = useFilters(data)

  const kpis = useMemo(() => {
    if (!filtered.length) return {}
    const total   = filtered.length
    const byClass = (c) => filtered.filter(r => r.recommendation_class === c).length
    const n_ready   = byClass('Ready to Execute')
    const n_review  = byClass('Merchant Review')
    const n_local   = byClass('Localize')
    const n_esc     = byClass('Escalate')
    const lostDemandUnits = filtered.reduce((s, r) =>
      s + Math.max(0, (r.estimated_true_demand ?? 0) - (r.observed_units ?? 0)), 0)
    const totalDemandValue   = filtered.reduce((s, r) => s + (r.estimated_true_demand ?? 0), 0) * AVG_UNIT_VALUE
    const recoverableValue   = lostDemandUnits * AVG_UNIT_VALUE
    const observedValue      = filtered.reduce((s, r) => s + (r.observed_units ?? 0), 0) * AVG_UNIT_VALUE
    return { total, n_ready, n_review, n_local, n_esc,
             lostDemandUnits, totalDemandValue, recoverableValue, observedValue }
  }, [filtered])

  const classDist = useMemo(() => {
    const counts = {}
    filtered.forEach(r => {
      counts[r.recommendation_class] = (counts[r.recommendation_class] ?? 0) + 1
    })
    return Object.entries(counts).map(([name, count]) => ({ name, count }))
  }, [filtered])

  const scoreHist = useMemo(() => {
    const bins = Array.from({ length: 20 }, (_, i) => ({
      range: `${i * 5}–${i * 5 + 5}`,
      count: 0,
    }))
    filtered.forEach(r => {
      const idx = Math.min(Math.floor((r.readiness_score ?? 0) / 5), 19)
      bins[idx].count++
    })
    return bins
  }, [filtered])

  const topSkuRecovered = useMemo(() => {
    const agg = {}
    filtered.forEach(r => {
      agg[r.sku_id] = (agg[r.sku_id] ?? 0) + (r.recovered_units ?? 0)
    })
    return Object.entries(agg)
      .map(([sku, val]) => ({ sku, recovered: Math.round(val) }))
      .sort((a, b) => b.recovered - a.recovered)
      .slice(0, 10)
  }, [filtered])

  const topCitySales = useMemo(() => {
    const agg = {}
    filtered.forEach(r => {
      agg[r.city_id] = (agg[r.city_id] ?? 0) + (r.estimated_true_demand ?? 0)
    })
    return Object.entries(agg)
      .map(([cityId, val]) => ({ city: getCityName(cityId), demand: Math.round(val) }))
      .sort((a, b) => b.demand - a.demand)
      .slice(0, 10)
  }, [filtered])

  if (loading) return <LoadingSpinner />
  if (error)   return <ErrorState message={error} />

  const pct  = (n) => kpis.total ? `${Math.round(n / kpis.total * 100)}%` : '—'
  const usd  = (v) => v != null ? '$' + v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'

  return (
    <div>
      <h1 className="page-title">Executive Overview</h1>
      <p className="page-subtitle">
        Merchandising decision readiness · FreshRetailNet-50K ·{' '}
        <span className="italic">Scores are decision-support, not auto-decisions</span>
      </p>

      <FilterBar filters={filters} setFilters={setFilters} options={options} />

      {/* Dollar-value KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <KpiCard
          label="Total Estimated Demand Value"
          value={usd(kpis.totalDemandValue)}
          sub={`@ $${AVG_UNIT_VALUE.toFixed(2)} avg unit value`}
        />
        <KpiCard
          label="Observed Revenue"
          value={usd(kpis.observedValue)}
          sub="based on reported sales"
        />
        <KpiCard
          label="Recoverable Demand Value"
          value={usd(kpis.recoverableValue)}
          color="text-escalate"
          sub="estimated revenue lost to stockouts"
        />
      </div>

      {/* Class mix KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        <KpiCard label="Total SKU-Store-Weeks" value={kpis.total?.toLocaleString() ?? '—'} />
        <KpiCard label="Ready to Execute"  value={pct(kpis.n_ready)}   color="text-ready"    sub={kpis.n_ready?.toLocaleString()} />
        <KpiCard label="Merchant Review"   value={pct(kpis.n_review)}  color="text-review"   sub={kpis.n_review?.toLocaleString()} />
        <KpiCard label="Localize"          value={pct(kpis.n_local)}   color="text-localize" sub={kpis.n_local?.toLocaleString()} />
        <KpiCard label="Escalate"          value={pct(kpis.n_esc)}     color="text-escalate" sub={kpis.n_esc?.toLocaleString()} />
      </div>

      {/* Chart row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="card">
          <p className="section-title">Recommendations by Class</p>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={classDist} margin={{ top: 8, right: 16, left: 56, bottom: 36 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }}>
                <Label value="Recommendation Class" offset={-24} position="insideBottom" style={AXIS_LABEL} />
              </XAxis>
              <YAxis tick={{ fontSize: 11 }}>
                <Label value="SKU-Store-Weeks" angle={-90} position="insideLeft" offset={-40} style={AXIS_LABEL} />
              </YAxis>
              <Tooltip formatter={(v) => [v.toLocaleString(), 'SKU-Store-Weeks']} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {classDist.map(d => (
                  <Cell key={d.name} fill={CLASS_COLORS[d.name] ?? '#94a3b8'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <p className="section-title">Sales Confidence Score Distribution</p>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={scoreHist} margin={{ top: 8, right: 16, left: 56, bottom: 36 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="range" tick={{ fontSize: 10 }} interval={1}>
                <Label value="Score Range (0–100)" offset={-24} position="insideBottom" style={AXIS_LABEL} />
              </XAxis>
              <YAxis tick={{ fontSize: 11 }}>
                <Label value="SKU-Store-Weeks" angle={-90} position="insideLeft" offset={-40} style={AXIS_LABEL} />
              </YAxis>
              <Tooltip formatter={(v) => [v.toLocaleString(), 'SKU-Store-Weeks']} />
              <Bar dataKey="count" fill="#6366f1" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Chart row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <p className="section-title">Top 10 SKUs by Recovered Demand Opportunity</p>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={topSkuRecovered} layout="vertical"
              margin={{ top: 8, right: 40, left: 48, bottom: 36 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" tick={{ fontSize: 11 }}>
                <Label value="Recovered Units (estimated)" offset={-24} position="insideBottom" style={AXIS_LABEL} />
              </XAxis>
              <YAxis type="category" dataKey="sku" tick={{ fontSize: 11 }} width={48}>
                <Label value="SKU ID" angle={-90} position="insideLeft" offset={-32} style={AXIS_LABEL} />
              </YAxis>
              <Tooltip formatter={(v) => [v.toLocaleString(), 'Recovered Units']} />
              <Bar dataKey="recovered" fill="#ef4444" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <p className="section-title">Top Cities by Estimated True Demand</p>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={topCitySales} margin={{ top: 8, right: 16, left: 56, bottom: 56 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="city" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0}>
                <Label value="City (proxy)" offset={-44} position="insideBottom" style={AXIS_LABEL} />
              </XAxis>
              <YAxis tick={{ fontSize: 11 }}>
                <Label value="Estimated Units" angle={-90} position="insideLeft" offset={-40} style={AXIS_LABEL} />
              </YAxis>
              <Tooltip formatter={(v) => [v.toLocaleString(), 'Estimated Units']} />
              <Bar dataKey="demand" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
