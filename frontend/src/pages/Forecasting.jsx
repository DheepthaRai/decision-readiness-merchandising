import { useMemo } from 'react'
import {
  ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, BarChart, Bar, Cell, ReferenceLine, Label,
} from 'recharts'
import { useForecastResults, useForecastMetrics } from '../hooks/useData'
import { CLASS_COLORS } from '../utils/constants'
import KpiCard from '../components/KpiCard'
import { LoadingSpinner, ErrorState } from '../components/LoadingState'

const AXIS_LABEL = { fontSize: 11, fill: '#64748b' }
const fmtN = (v) => (v == null ? '—' : Number(v).toFixed(2))
const fmtPct = (v) => (v == null ? '—' : `${Number(v).toFixed(1)}%`)

// Bucket errors into histogram bins
function buildErrorHist(rows, binWidth = 2) {
  const errs = rows.map(r => Number(r.abs_error ?? 0))
  const max = Math.ceil(Math.max(...errs) / binWidth) * binWidth
  const bins = []
  for (let lo = 0; lo <= Math.min(max, 40); lo += binWidth) {
    bins.push({ range: `${lo}–${lo + binWidth}`, count: 0 })
  }
  errs.forEach(e => {
    const idx = Math.min(Math.floor(e / binWidth), bins.length - 1)
    if (idx >= 0) bins[idx].count++
  })
  return bins
}

export default function Forecasting() {
  const { data: rows, loading: rLoading, error: rError } = useForecastResults()
  const { data: metrics, loading: mLoading, error: mError } = useForecastMetrics()

  const loading = rLoading || mLoading
  const error = rError || mError

  // Scatter: sample up to 800 rows for perf
  const scatterData = useMemo(() => {
    if (!rows.length) return []
    const step = Math.max(1, Math.floor(rows.length / 800))
    return rows
      .filter((_, i) => i % step === 0)
      .map(r => ({
        actual: Number(r.actual_true_demand ?? 0),
        pred:   Number(r.forecasted_true_demand ?? 0),
        cls:    r.recommendation_class ?? 'Unknown',
      }))
  }, [rows])

  const maxVal = useMemo(() => {
    if (!scatterData.length) return 100
    return Math.ceil(Math.max(...scatterData.map(d => Math.max(d.actual, d.pred))) / 10) * 10
  }, [scatterData])

  const errorHist = useMemo(() => buildErrorHist(rows), [rows])

  const errorByCity = useMemo(() => {
    const agg = {}
    rows.forEach(r => {
      const city = r.city ?? `City ${r.city_id}`
      if (!agg[city]) agg[city] = { city, total: 0, count: 0 }
      agg[city].total += Number(r.abs_error ?? 0)
      agg[city].count++
    })
    return Object.values(agg)
      .map(d => ({ city: d.city, mae: +(d.total / d.count).toFixed(2) }))
      .sort((a, b) => b.mae - a.mae)
      .slice(0, 12)
  }, [rows])

  const errorByClass = useMemo(() => {
    const agg = {}
    rows.forEach(r => {
      const cls = r.recommendation_class ?? 'Unknown'
      if (!agg[cls]) agg[cls] = { cls, total: 0, count: 0 }
      agg[cls].total += Number(r.abs_error ?? 0)
      agg[cls].count++
    })
    return Object.values(agg).map(d => ({
      cls: d.cls,
      mae: +(d.total / d.count).toFixed(2),
    }))
  }, [rows])

  const baselineBar = useMemo(() => {
    if (!metrics) return []
    return [
      { label: 'Naive (Last Week)', mae: metrics.naive_mae ?? null },
      { label: 'Rolling 3-Wk Avg', mae: metrics.rolling_mae ?? null },
      { label: 'LightGBM (ML)', mae: metrics.mae ?? null },
    ].filter(d => d.mae != null)
  }, [metrics])

  const tableRows = useMemo(() =>
    rows.slice(0, 200).map(r => ({
      product_id:  r.product_id ?? r.sku_id,
      store_id:    r.store_id,
      city:        r.city ?? `City ${r.city_id}`,
      week:        r.week,
      actual:      Number(r.actual_true_demand ?? 0).toFixed(1),
      forecast:    Number(r.forecasted_true_demand ?? 0).toFixed(1),
      naive:       r.naive_forecast != null ? Number(r.naive_forecast).toFixed(1) : '—',
      rolling:     r.rolling_forecast != null ? Number(r.rolling_forecast).toFixed(1) : '—',
      abs_error:   Number(r.abs_error ?? 0).toFixed(2),
      cls:         r.recommendation_class ?? '—',
    })),
    [rows]
  )

  if (loading) return <LoadingSpinner />
  if (error)   return <ErrorState message={error} />

  const m = metrics ?? {}
  const improvement = m.naive_mae && m.mae
    ? (((m.naive_mae - m.mae) / m.naive_mae) * 100).toFixed(1)
    : null

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-800">True Demand Forecasting</h2>
        <p className="text-sm text-slate-500 mt-1">
          Next-week estimated true demand (stockout-corrected) · LightGBM · time-based split
        </p>
        {m.note_data_limitation && (
          <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
            ⚠️ {m.note_data_limitation}
          </div>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiCard label="ML MAE"              value={fmtN(m.mae)}       color="text-indigo-600" sub="units / SKU-week" />
        <KpiCard label="ML RMSE"             value={fmtN(m.rmse)}      color="text-slate-800"  sub="units" />
        <KpiCard label="Naive Baseline MAE"  value={fmtN(m.naive_mae)} color="text-slate-500"  sub="last-week carry-fwd" />
        <KpiCard label="Rolling Baseline MAE" value={fmtN(m.rolling_mae)} color="text-slate-500" sub="3-wk average" />
        <KpiCard label="Improvement vs Naive" value={improvement != null ? `${improvement}%` : '—'} color={improvement > 0 ? 'text-emerald-600' : 'text-red-500'} sub="lower MAE is better" />
        <KpiCard label="Mean Bias"           value={fmtN(m.bias)}      color={Math.abs(m.bias ?? 0) < 1 ? 'text-emerald-600' : 'text-amber-600'} sub="avg over-/under-forecast" />
      </div>

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Actual vs Forecasted scatter */}
        <div className="card">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Actual vs Forecasted Demand</h3>
          <ResponsiveContainer width="100%" height={280}>
            <ScatterChart margin={{ top: 10, right: 20, bottom: 30, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis type="number" dataKey="actual" domain={[0, maxVal]} tick={{ fontSize: 11 }}>
                <Label value="Actual Units" position="insideBottom" offset={-15} style={AXIS_LABEL} />
              </XAxis>
              <YAxis type="number" dataKey="pred" domain={[0, maxVal]} tick={{ fontSize: 11 }}>
                <Label value="Forecasted" angle={-90} position="insideLeft" style={AXIS_LABEL} />
              </YAxis>
              <Tooltip
                cursor={{ strokeDasharray: '3 3' }}
                content={({ payload }) => {
                  if (!payload?.length) return null
                  const d = payload[0].payload
                  return (
                    <div className="bg-white border border-border rounded p-2 text-xs shadow">
                      <div>Actual: {d.actual.toFixed(1)}</div>
                      <div>Forecast: {d.pred.toFixed(1)}</div>
                      <div>Class: {d.cls}</div>
                    </div>
                  )
                }}
              />
              <ReferenceLine segment={[{x:0,y:0},{x:maxVal,y:maxVal}]} stroke="#94a3b8" strokeDasharray="4 4" />
              {Object.entries(CLASS_COLORS).map(([cls, color]) => (
                <Scatter
                  key={cls}
                  name={cls}
                  data={scatterData.filter(d => d.cls === cls)}
                  fill={color}
                  opacity={0.55}
                  r={3}
                />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
          <p className="text-xs text-slate-400 mt-2 text-center">Dashed line = perfect forecast. Each dot = one SKU-store-week.</p>
        </div>

        {/* Error distribution */}
        <div className="card">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Absolute Error Distribution</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={errorHist} margin={{ top: 10, right: 20, bottom: 30, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="range" tick={{ fontSize: 9 }} interval={1}>
                <Label value="Abs Error (units)" position="insideBottom" offset={-15} style={AXIS_LABEL} />
              </XAxis>
              <YAxis tick={{ fontSize: 11 }}>
                <Label value="# SKU-weeks" angle={-90} position="insideLeft" style={AXIS_LABEL} />
              </YAxis>
              <Tooltip formatter={(v) => [v, 'count']} />
              <Bar dataKey="count" fill="#6366f1" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* MAE by city */}
        <div className="card">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">MAE by City</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={errorByCity} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 80 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="city" tick={{ fontSize: 11 }} width={76} />
              <Tooltip formatter={(v) => [v.toFixed(2), 'MAE']} />
              <Bar dataKey="mae" fill="#0ea5e9" radius={[0,3,3,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* MAE by class vs baselines */}
        <div className="card">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Baseline vs ML (MAE by Model)</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={baselineBar} margin={{ top: 10, right: 20, bottom: 5, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }}>
                <Label value="MAE (units)" angle={-90} position="insideLeft" style={AXIS_LABEL} />
              </YAxis>
              <Tooltip formatter={(v) => [v.toFixed(2), 'MAE']} />
              <Bar dataKey="mae" radius={[3,3,0,0]}>
                {baselineBar.map((d, i) => (
                  <Cell key={i} fill={i === baselineBar.length - 1 ? '#6366f1' : '#94a3b8'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          <h3 className="text-sm font-semibold text-slate-700 mt-6 mb-3">MAE by Readiness Class</h3>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={errorByClass} margin={{ top: 5, right: 20, bottom: 5, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="cls" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => [v.toFixed(2), 'MAE']} />
              <Bar dataKey="mae" radius={[3,3,0,0]}>
                {errorByClass.map((d, i) => (
                  <Cell key={i} fill={CLASS_COLORS[d.cls] ?? '#94a3b8'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-x-auto">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">
          Forecast Detail — first 200 rows
        </h3>
        <table className="w-full text-xs text-left">
          <thead>
            <tr className="border-b border-border text-slate-400 uppercase tracking-wider">
              {['Product', 'Store', 'City', 'Week', 'Actual', 'Forecast', 'Naive', 'Rolling', 'Abs Err', 'Class'].map(h => (
                <th key={h} className="pb-2 pr-4 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableRows.map((r, i) => (
              <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="py-1.5 pr-4 font-mono">{r.product_id}</td>
                <td className="py-1.5 pr-4 font-mono">{r.store_id}</td>
                <td className="py-1.5 pr-4">{r.city}</td>
                <td className="py-1.5 pr-4">{r.week}</td>
                <td className="py-1.5 pr-4 tabular-nums">{r.actual}</td>
                <td className="py-1.5 pr-4 tabular-nums font-medium text-indigo-700">{r.forecast}</td>
                <td className="py-1.5 pr-4 tabular-nums text-slate-400">{r.naive}</td>
                <td className="py-1.5 pr-4 tabular-nums text-slate-400">{r.rolling}</td>
                <td className="py-1.5 pr-4 tabular-nums">{r.abs_error}</td>
                <td className="py-1.5 pr-4">
                  <span
                    className="inline-block px-1.5 py-0.5 rounded text-white text-xs"
                    style={{ background: CLASS_COLORS[r.cls] ?? '#94a3b8' }}
                  >{r.cls}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
