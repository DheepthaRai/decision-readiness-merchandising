import { useState, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Label,
} from 'recharts'

const AXIS_LABEL = { fontSize: 11, fill: '#64748b' }
import { useRecommendations } from '../hooks/useData'
import { useFilters } from '../hooks/useFilters'
import { CLASS_PLAIN, REASON_PLAIN, SCORE_LABELS } from '../utils/constants'
import { getCityName } from '../utils/cityMap'
import ClassBadge from '../components/ClassBadge'
import FilterBar from '../components/FilterBar'
import { LoadingSpinner, ErrorState } from '../components/LoadingState'

const SORT_KEYS = [
  { key: 'readiness_score',       label: SCORE_LABELS.readiness_score },
  { key: 'stockout_rate',         label: 'Stockout Rate' },
  { key: 'observed_units',        label: 'Observed Sales' },
  { key: 'estimated_true_demand', label: 'Est. True Demand' },
]

function ScoreBar({ value, color = '#6366f1' }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 bg-slate-100 rounded-full h-1.5">
        <div className="h-1.5 rounded-full" style={{ width: `${value ?? 0}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs text-slate-600 tabular-nums">{value?.toFixed(1) ?? '—'}</span>
    </div>
  )
}

function DetailPanel({ row }) {
  const featureScores = [
    { name: SCORE_LABELS.velocity_score,            value: row.velocity_score },
    { name: SCORE_LABELS.consistency_score,         value: row.consistency_score },
    { name: SCORE_LABELS.localization_score,        value: row.localization_score },
    { name: SCORE_LABELS.recovered_demand_score,    value: row.recovered_demand_score },
    { name: SCORE_LABELS.promo_independence_score,  value: row.promo_independence_score },
    { name: SCORE_LABELS.low_volatility_score,      value: row.low_volatility_score },
    { name: SCORE_LABELS.low_stockout_risk_score,   value: row.low_stockout_risk_score },
  ]

  const demandData = [
    { name: 'Observed Sales',     value: Math.round(row.observed_units ?? 0) },
    { name: 'Recovered (Stockout)', value: Math.round(row.recovered_units ?? 0) },
    { name: 'Est. True Demand',   value: Math.round(row.estimated_true_demand ?? 0) },
  ]

  return (
    <div className="bg-slate-50 border-t border-border p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-800">
            SKU {row.sku_id} · Store {row.store_id} · {getCityName(row.city_id)}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">Week: {row.week_label}</p>
        </div>
        <ClassBadge cls={row.recommendation_class} />
      </div>

      {/* Plain-English explanation */}
      <div className="bg-white border border-border rounded-lg p-4">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">What this means</p>
        <p className="text-sm text-slate-700">
          {CLASS_PLAIN[row.recommendation_class] ?? '—'}
        </p>
        <p className="text-xs text-slate-500 mt-2">
          <span className="font-medium">Reason: </span>
          {REASON_PLAIN[row.reason_code] ?? row.reason_code ?? '—'}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Feature scores */}
        <div>
          <p className="section-title">Score Breakdown (0–100, higher = better)</p>
          <div className="space-y-2">
            {featureScores.map(f => (
              <div key={f.name} className="flex items-center justify-between">
                <span className="text-xs text-slate-600 w-36">{f.name}</span>
                <ScoreBar value={f.value} />
              </div>
            ))}
          </div>
        </div>

        {/* Demand waterfall */}
        <div>
          <p className="section-title">Observed vs. Estimated Demand</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={demandData} margin={{ top: 4, right: 16, left: 52, bottom: 36 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-15} textAnchor="end" interval={0}>
                <Label value="Demand Measure" offset={-24} position="insideBottom" style={AXIS_LABEL} />
              </XAxis>
              <YAxis tick={{ fontSize: 11 }}>
                <Label value="Units" angle={-90} position="insideLeft" offset={-38} style={AXIS_LABEL} />
              </YAxis>
              <Tooltip formatter={(v) => [v.toLocaleString(), 'Units']} />
              <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-3 gap-3 text-sm">
        {[
          ['Readiness Score',   row.readiness_score?.toFixed(1)],
          ['Stockout Rate',     `${((row.stockout_rate ?? 0) * 100).toFixed(1)}%`],
          ['Observed Units',    row.observed_units?.toLocaleString()],
          ['Est. True Demand',  row.estimated_true_demand?.toLocaleString()],
          ['Recovered Demand',  row.recovered_units?.toFixed(0)],
        ].map(([label, val]) => (
          <div key={label} className="bg-white border border-border rounded-lg p-3">
            <p className="text-xs text-slate-500">{label}</p>
            <p className="font-semibold text-slate-800">{val ?? '—'}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function ProductReadiness() {
  const { data, loading, error } = useRecommendations()
  const { filters, setFilters, options, filtered } = useFilters(data)
  const [sortKey, setSortKey]   = useState('readiness_score')
  const [sortDir, setSortDir]   = useState('desc')
  const [expandedRow, setExpandedRow] = useState(null)
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 50

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = a[sortKey] ?? 0
      const bv = b[sortKey] ?? 0
      return sortDir === 'desc' ? bv - av : av - bv
    })
  }, [filtered, sortKey, sortDir])

  const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE)

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  if (loading) return <LoadingSpinner />
  if (error)   return <ErrorState message={error} />

  const SortBtn = ({ k, label }) => (
    <button
      className={`text-left text-xs font-semibold uppercase tracking-wide px-2 py-1 rounded
                  ${sortKey === k ? 'text-slate-800 bg-slate-100' : 'text-slate-500 hover:text-slate-700'}`}
      onClick={() => toggleSort(k)}
    >
      {label} {sortKey === k ? (sortDir === 'desc' ? '↓' : '↑') : ''}
    </button>
  )

  return (
    <div>
      <h1 className="page-title">Product Readiness Explorer</h1>
      <p className="page-subtitle">Click any row to see a full detail breakdown.</p>

      <FilterBar filters={filters} setFilters={setFilters} options={options} />

      <div className="card overflow-hidden p-0">
        {/* Sort controls */}
        <div className="flex gap-2 px-4 py-3 border-b border-border bg-slate-50">
          <span className="text-xs text-slate-500 self-center mr-1">Sort by:</span>
          {SORT_KEYS.map(s => <SortBtn key={s.key} k={s.key} label={s.label} />)}
          <span className="ml-auto text-xs text-slate-400 self-center">
            {sorted.length.toLocaleString()} rows
          </span>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-border">
              <tr>
                {['SKU', 'Store', 'City', 'Week',
                  SCORE_LABELS.readiness_score, 'Class', 'Reason',
                  'Observed', 'Est. Demand', 'Stockout %',
                  SCORE_LABELS.promo_independence_score, SCORE_LABELS.low_volatility_score,
                ].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pageRows.map((row, i) => {
                const key = `${row.sku_id}-${row.store_id}-${row.week_label}-${i}`
                const isExp = expandedRow === key
                return (
                  <>
                    <tr
                      key={key}
                      className={`cursor-pointer transition-colors ${isExp ? 'bg-slate-50' : 'hover:bg-slate-50'}`}
                      onClick={() => setExpandedRow(isExp ? null : key)}
                    >
                      <td className="px-3 py-2.5 font-mono text-xs">{row.sku_id}</td>
                      <td className="px-3 py-2.5 text-slate-600">{row.store_id}</td>
                      <td className="px-3 py-2.5 text-slate-600">{getCityName(row.city_id)}</td>
                      <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{row.week_label}</td>
                      <td className="px-3 py-2.5 font-semibold">{row.readiness_score?.toFixed(1) ?? '—'}</td>
                      <td className="px-3 py-2.5"><ClassBadge cls={row.recommendation_class} /></td>
                      <td className="px-3 py-2.5 text-xs text-slate-500 max-w-[180px] truncate" title={row.reason_code}>
                        {row.reason_code?.replace(/_/g, ' ') ?? '—'}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">{row.observed_units?.toLocaleString() ?? '—'}</td>
                      <td className="px-3 py-2.5 tabular-nums">{row.estimated_true_demand?.toLocaleString() ?? '—'}</td>
                      <td className="px-3 py-2.5 tabular-nums">{((row.stockout_rate ?? 0) * 100).toFixed(1)}%</td>
                      <td className="px-3 py-2.5 tabular-nums">{row.promo_independence_score?.toFixed(0) ?? '—'}</td>
                      <td className="px-3 py-2.5 tabular-nums">{row.low_volatility_score?.toFixed(0) ?? '—'}</td>
                    </tr>
                    {isExp && (
                      <tr key={key + '-detail'}>
                        <td colSpan={12} className="p-0">
                          <DetailPanel row={row} />
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-slate-50">
            <button className="btn-ghost text-xs" disabled={page === 0}
              onClick={() => setPage(p => p - 1)}>← Previous</button>
            <span className="text-xs text-slate-500">
              Page {page + 1} of {totalPages}
            </span>
            <button className="btn-ghost text-xs" disabled={page >= totalPages - 1}
              onClick={() => setPage(p => p + 1)}>Next →</button>
          </div>
        )}
      </div>
    </div>
  )
}
