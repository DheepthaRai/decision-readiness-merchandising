import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell, Legend, Label,
} from 'recharts'

const AXIS_LABEL = { fontSize: 11, fill: '#64748b' }
import { useRecommendations } from '../hooks/useData'
import { recomputeScores } from '../utils/scoring'
import { exportCSV } from '../utils/csv'
import { CLASS_COLORS, WEIGHT_LABELS_FRIENDLY } from '../utils/constants'
import ClassBadge from '../components/ClassBadge'
import { LoadingSpinner, ErrorState } from '../components/LoadingState'

const DEFAULT_WEIGHTS = {
  velocity:     0.25,
  consistency:  0.20,
  localization: 0.15,
  recovered:    0.15,
  promoIndep:   0.10,
  lowVol:       0.10,
  lowStock:     0.05,
}

const DEFAULT_THRESHOLDS = {
  readyMin:          62,    // ~75th pct of readiness scores in dataset
  readyMaxStockout:  0.90,  // above dataset median of 0.85
  readyMaxVolPct:    75,
  readyMaxPromoPct:  75,
  reviewMin:         38,    // ~25th pct
  localizeHHI:       0.75,  // concentrated demand (top ~30%)
  escalateStockout:  0.97,  // extreme tail (>95th pct)
  escalateRecovered: 0.90,
}

function WeightSlider({ name, value, onChange, total }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-600 w-44 shrink-0">{WEIGHT_LABELS_FRIENDLY[name]}</span>
      <input
        type="range" min={0} max={1} step={0.01}
        value={value}
        onChange={e => onChange(name, parseFloat(e.target.value))}
        className="flex-1 accent-slate-700"
      />
      <span className="text-xs tabular-nums font-semibold w-10 text-right">
        {(value * 100).toFixed(0)}%
      </span>
    </div>
  )
}

function ThresholdControl({ label, name, value, onChange, min, max, step, format }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-600 w-52 shrink-0">{label}</span>
      <input
        type="range" min={min} max={max} step={step ?? 0.01}
        value={value}
        onChange={e => onChange(name, parseFloat(e.target.value))}
        className="flex-1 accent-slate-700"
      />
      <span className="text-xs tabular-nums font-semibold w-14 text-right">
        {format ? format(value) : value}
      </span>
    </div>
  )
}

function classDist(rows) {
  const counts = {}
  rows.forEach(r => {
    counts[r.recommendation_class] = (counts[r.recommendation_class] ?? 0) + 1
  })
  return Object.entries(counts).map(([name, count]) => ({ name, count }))
}

// Deterministic sample: pick every Nth row so the sample is spread across
// the full dataset rather than just the first N rows.
const SAMPLE_SIZE = 5000

function sampleRows(rows, n) {
  if (rows.length <= n) return rows
  const step = rows.length / n
  return Array.from({ length: n }, (_, i) => rows[Math.floor(i * step)])
}

// Simple debounce hook — returns a debounced copy of the value.
function useDebounced(value, delay = 300) {
  const [debounced, setDebounced] = useState(value)
  const timer = useRef(null)
  useEffect(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer.current)
  }, [value, delay])
  return debounced
}

export default function Simulator() {
  const { data, loading, error } = useRecommendations()
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS)
  const [thresholds, setThresholds] = useState(DEFAULT_THRESHOLDS)
  const [showTable, setShowTable] = useState(false)

  // Debounce slider values so recomputation only fires after user stops dragging
  const debouncedWeights    = useDebounced(weights, 250)
  const debouncedThresholds = useDebounced(thresholds, 250)

  const weightTotal = Object.values(weights).reduce((s, v) => s + v, 0)
  const isValid = Math.abs(weightTotal - 1) < 0.01

  const updateWeight = useCallback((name, val) => {
    setWeights(w => ({ ...w, [name]: val }))
  }, [])

  const updateThreshold = useCallback((name, val) => {
    setThresholds(t => ({ ...t, [name]: val }))
  }, [])

  // Sample once when data loads — stable reference, no re-sampling on slider changes
  const sample = useMemo(() => sampleRows(data, SAMPLE_SIZE), [data])

  const recomputed = useMemo(() => {
    if (!sample.length) return []
    return recomputeScores(sample, debouncedWeights, debouncedThresholds)
  }, [sample, debouncedWeights, debouncedThresholds])

  // Original dist also uses the sample so the comparison is apples-to-apples
  const originalDist = useMemo(() => classDist(sample), [sample])
  const newDist      = useMemo(() => classDist(recomputed), [recomputed])

  /* Merge for grouped bar chart */
  const comparison = useMemo(() => {
    const classes = ['Ready to Execute', 'Merchant Review', 'Localize', 'Escalate']
    const origMap = Object.fromEntries(originalDist.map(d => [d.name, d.count]))
    const newMap  = Object.fromEntries(newDist.map(d => [d.name, d.count]))
    return classes.map(c => ({
      name: c,
      Original: origMap[c] ?? 0,
      Recomputed: newMap[c] ?? 0,
    }))
  }, [originalDist, newDist])

  if (loading) return <LoadingSpinner />
  if (error)   return <ErrorState message={error} />

  return (
    <div>
      <h1 className="page-title">Recommendation Simulator</h1>
      <p className="page-subtitle">
        Adjust scoring weights and thresholds to see how the recommendation mix changes.
        Runs on a {SAMPLE_SIZE.toLocaleString()}-row sample for responsiveness — changes here do not affect the saved pipeline output.
      </p>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
        {/* Weights */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <p className="section-title mb-0">Scoring Weights</p>
            <span className={`text-xs font-semibold px-2 py-1 rounded-full
              ${isValid ? 'bg-ready-light text-ready-dark' : 'bg-escalate-light text-escalate-dark'}`}>
              Total: {(weightTotal * 100).toFixed(0)}% {isValid ? '✓' : '— must equal 100%'}
            </span>
          </div>
          <div className="space-y-3">
            {Object.keys(DEFAULT_WEIGHTS).map(k => (
              <WeightSlider key={k} name={k} value={weights[k]} onChange={updateWeight} total={weightTotal} />
            ))}
          </div>
          <button
            className="btn-ghost mt-4 text-xs"
            onClick={() => setWeights(DEFAULT_WEIGHTS)}
          >
            Reset to defaults
          </button>
        </div>

        {/* Thresholds */}
        <div className="card">
          <p className="section-title">Classification Thresholds</p>
          <div className="space-y-3">
            <ThresholdControl label="Ready to Execute — min score"
              name="readyMin" value={thresholds.readyMin} onChange={updateThreshold}
              min={50} max={95} step={1} format={v => v} />
            <ThresholdControl label="Ready to Execute — max stockout rate"
              name="readyMaxStockout" value={thresholds.readyMaxStockout} onChange={updateThreshold}
              min={0.05} max={0.50} step={0.01} format={v => `${(v*100).toFixed(0)}%`} />
            <ThresholdControl label="Ready — max volatility percentile"
              name="readyMaxVolPct" value={thresholds.readyMaxVolPct} onChange={updateThreshold}
              min={30} max={95} step={1} format={v => v} />
            <ThresholdControl label="Ready — max promo dependency percentile"
              name="readyMaxPromoPct" value={thresholds.readyMaxPromoPct} onChange={updateThreshold}
              min={30} max={95} step={1} format={v => v} />
            <ThresholdControl label="Merchant Review — min score"
              name="reviewMin" value={thresholds.reviewMin} onChange={updateThreshold}
              min={20} max={74} step={1} format={v => v} />
            <ThresholdControl label="Localize — min HHI"
              name="localizeHHI" value={thresholds.localizeHHI} onChange={updateThreshold}
              min={0.10} max={0.80} step={0.01} format={v => v.toFixed(2)} />
            <ThresholdControl label="Escalate — min stockout rate"
              name="escalateStockout" value={thresholds.escalateStockout} onChange={updateThreshold}
              min={0.10} max={0.80} step={0.01} format={v => `${(v*100).toFixed(0)}%`} />
          </div>
          <button
            className="btn-ghost mt-4 text-xs"
            onClick={() => setThresholds(DEFAULT_THRESHOLDS)}
          >
            Reset to defaults
          </button>
        </div>
      </div>

      {/* Before / After comparison */}
      <div className="card mb-6">
        <p className="section-title">Before vs. After Class Distribution</p>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={comparison} margin={{ top: 4, right: 16, left: 56, bottom: 36 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }}>
              <Label value="Recommendation Class" offset={-24} position="insideBottom" style={AXIS_LABEL} />
            </XAxis>
            <YAxis tick={{ fontSize: 11 }}>
              <Label value="SKU-Store-Weeks (sample)" angle={-90} position="insideLeft" offset={-42} style={AXIS_LABEL} />
            </YAxis>
            <Tooltip formatter={(v, name) => [v.toLocaleString(), name]} />
            <Legend verticalAlign="top" />
            <Bar dataKey="Original"   fill="#94a3b8" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Recomputed" radius={[4, 4, 0, 0]}>
              {comparison.map(d => (
                <Cell key={d.name} fill={CLASS_COLORS[d.name] ?? '#6366f1'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Export + table */}
      <div className="flex items-center gap-3 mb-4">
        <button
          className="btn-primary"
          onClick={() => exportCSV(recomputed, 'simulated_recommendations_sample.csv')}
        >
          ⬇ Export Recomputed Recommendations CSV
        </button>
        <button
          className="btn-ghost"
          onClick={() => setShowTable(t => !t)}
        >
          {showTable ? 'Hide' : 'Show'} Recomputed Table
        </button>
      </div>

      {showTable && (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto max-h-[500px]">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-border sticky top-0">
                <tr>
                  {['SKU', 'Store', 'City', 'Week', 'Score', 'Class', 'Orig. Class'].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recomputed.slice(0, 500).map((row, i) => {
                  const orig = data[i]?.recommendation_class
                  const changed = orig !== row.recommendation_class
                  return (
                    <tr key={i} className={changed ? 'bg-yellow-50' : 'hover:bg-slate-50'}>
                      <td className="px-3 py-2 font-mono text-xs">{row.sku_id}</td>
                      <td className="px-3 py-2">{row.store_id}</td>
                      <td className="px-3 py-2">{row.city_id}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{row.week_label}</td>
                      <td className="px-3 py-2 font-semibold tabular-nums">{row.readiness_score?.toFixed(1)}</td>
                      <td className="px-3 py-2"><ClassBadge cls={row.recommendation_class} /></td>
                      <td className="px-3 py-2 text-slate-400 text-xs">{orig}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-400 px-4 py-2 border-t border-border">
            Showing first 500 rows · highlighted rows changed class
          </p>
        </div>
      )}
    </div>
  )
}
