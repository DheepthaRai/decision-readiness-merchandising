import { useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell, PieChart, Pie, Legend,
} from 'recharts'
import { useConstrainedRecs, useConstraintSummary } from '../hooks/useData'
import { CLASS_COLORS } from '../utils/constants'
import KpiCard from '../components/KpiCard'
import { LoadingSpinner, ErrorState } from '../components/LoadingState'

const AXIS_LABEL = { fontSize: 11, fill: '#64748b' }
const fmt = (n, dec = 0) => n == null ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: dec })

const CLASSES = ['Ready to Execute', 'Merchant Review', 'Localize', 'Escalate']

export default function Optimizer() {
  const { data: rows, loading: rLoading, error: rError } = useConstrainedRecs()
  const { data: summary, loading: sLoading, error: sError } = useConstraintSummary()

  const loading = rLoading || sLoading
  const error = rError || sError

  // ── Filter controls ────────────────────────────────────────────────────────
  const cities = useMemo(() => {
    const s = new Set(rows.map(r => r.city ?? `City ${r.city_id}`))
    return ['All', ...Array.from(s).sort()]
  }, [rows])

  const [cityFilter, setCityFilter] = useState('All')
  const [classFilter, setClassFilter] = useState('All')
  const [maxUnits,  setMaxUnits]  = useState('')
  const [maxBudget, setMaxBudget] = useState('')

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (cityFilter  !== 'All' && (r.city ?? `City ${r.city_id}`) !== cityFilter) return false
      if (classFilter !== 'All' && r.recommendation_class !== classFilter) return false
      if (maxUnits  && Number(r.recommended_stock_qty ?? 0) > Number(maxUnits))  return false
      if (maxBudget && Number(r.estimated_cost_proxy  ?? 0) > Number(maxBudget)) return false
      return true
    })
  }, [rows, cityFilter, classFilter, maxUnits, maxBudget])

  const selected   = useMemo(() => filtered.filter(r => String(r.selected) === 'True' || r.selected === true || r.selected === 1), [filtered])
  const unselected = useMemo(() => filtered.filter(r => !selected.includes(r)), [filtered, selected])

  // KPIs
  const kpis = useMemo(() => {
    const totalUnits   = selected.reduce((s, r) => s + Number(r.recommended_stock_qty ?? 0), 0)
    const totalBudget  = selected.reduce((s, r) => s + Number(r.estimated_cost_proxy ?? 0), 0)
    const demandCovered= selected.reduce((s, r) => s + Number(r.forecasted_true_demand ?? 0), 0)
    const byClass = (c) => selected.filter(r => r.recommendation_class === c).length
    return { count: selected.length, totalUnits, totalBudget, demandCovered,
             ready: byClass('Ready to Execute'), localize: byClass('Localize') }
  }, [selected])

  // Chart: selected vs not by class
  const byClassChart = useMemo(() => {
    return CLASSES.map(cls => ({
      cls,
      selected:   selected.filter(r => r.recommendation_class === cls).length,
      unselected: unselected.filter(r => r.recommendation_class === cls).length,
    }))
  }, [selected, unselected])

  // Chart: demand by city (selected)
  const demandByCity = useMemo(() => {
    const agg = {}
    selected.forEach(r => {
      const city = r.city ?? `City ${r.city_id}`
      agg[city] = (agg[city] ?? 0) + Number(r.forecasted_true_demand ?? 0)
    })
    return Object.entries(agg)
      .map(([city, demand]) => ({ city, demand: Math.round(demand) }))
      .sort((a, b) => b.demand - a.demand)
      .slice(0, 12)
  }, [selected])

  // Chart: priority value distribution (binned)
  const priorityHist = useMemo(() => {
    const vals = filtered.map(r => Number(r.priority_value_per_unit ?? 0))
    const max = Math.max(...vals, 1)
    const bins = 10
    const width = max / bins
    const buckets = Array.from({ length: bins }, (_, i) => ({
      range: `${(i * width).toFixed(1)}–${((i + 1) * width).toFixed(1)}`,
      count: 0,
    }))
    vals.forEach(v => {
      const idx = Math.min(Math.floor(v / width), bins - 1)
      buckets[idx].count++
    })
    return buckets
  }, [filtered])

  // Chart: units by city
  const unitsByCity = useMemo(() => {
    const agg = {}
    selected.forEach(r => {
      const city = r.city ?? `City ${r.city_id}`
      agg[city] = (agg[city] ?? 0) + Number(r.recommended_stock_qty ?? 0)
    })
    return Object.entries(agg)
      .map(([city, units]) => ({ city, units: Math.round(units) }))
      .sort((a, b) => b.units - a.units)
      .slice(0, 12)
  }, [selected])

  const tableRows = useMemo(() =>
    filtered.slice(0, 300).map(r => ({
      product_id:  r.product_id ?? r.sku_id,
      store_id:    r.store_id,
      city:        r.city ?? `City ${r.city_id}`,
      forecast:    Number(r.forecasted_true_demand ?? 0).toFixed(1),
      rec_qty:     Number(r.recommended_stock_qty ?? 0).toFixed(0),
      priority:    Number(r.priority_value_per_unit ?? 0).toFixed(2),
      selected:    String(r.selected) === 'True' || r.selected === true || r.selected === 1,
      reason:      r.constraint_reason ?? '—',
      cls:         r.recommendation_class ?? '—',
      action:      r.inventory_action ?? '—',
    })),
    [filtered]
  )

  if (loading) return <LoadingSpinner />
  if (error)   return <ErrorState message={error} />

  const s = summary ?? {}

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-800">Inventory & Constraint Optimizer</h2>
        <p className="text-sm text-slate-500 mt-1">
          Greedy allocation ranked by priority value per unit · budget &amp; capacity constraints
        </p>
      </div>

      {/* Controls */}
      <div className="card">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Filters &amp; Constraints</h3>
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs text-slate-500 mb-1">City</label>
            <select
              className="border border-border rounded-lg px-3 py-1.5 text-sm text-slate-700 bg-white"
              value={cityFilter}
              onChange={e => setCityFilter(e.target.value)}
            >
              {cities.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Readiness Class</label>
            <select
              className="border border-border rounded-lg px-3 py-1.5 text-sm text-slate-700 bg-white"
              value={classFilter}
              onChange={e => setClassFilter(e.target.value)}
            >
              <option>All</option>
              {CLASSES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Max Units / SKU (filter)</label>
            <input
              type="number" min="0" placeholder="no limit"
              className="border border-border rounded-lg px-3 py-1.5 text-sm w-32"
              value={maxUnits}
              onChange={e => setMaxUnits(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Max Budget / SKU (filter)</label>
            <input
              type="number" min="0" placeholder="no limit"
              className="border border-border rounded-lg px-3 py-1.5 text-sm w-32"
              value={maxBudget}
              onChange={e => setMaxBudget(e.target.value)}
            />
          </div>
          <button
            className="text-xs text-slate-400 hover:text-slate-600 underline"
            onClick={() => { setCityFilter('All'); setClassFilter('All'); setMaxUnits(''); setMaxBudget('') }}
          >
            Reset
          </button>
        </div>
        <p className="text-xs text-slate-400 mt-2">
          Filters narrow the view — the optimizer ran offline during pipeline. "Selected" reflects the pipeline's constraint run.
        </p>
      </div>

      {/* Global summary banner */}
      {s.total_selected_skus != null && (
        <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl text-sm text-indigo-800">
          Pipeline run selected <strong>{fmt(s.total_selected_skus)}</strong> SKU-store pairs
          · <strong>{fmt(s.total_units_selected)}</strong> units
          · <strong>{fmt(s.total_demand_covered, 1)}</strong> units demand covered
          · est. budget <strong>${fmt(s.total_budget_used, 2)}</strong>
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiCard label="Selected (filtered)" value={fmt(kpis.count)}        color="text-indigo-600" />
        <KpiCard label="Total Units"          value={fmt(kpis.totalUnits)}   color="text-slate-800" sub="recommended qty" />
        <KpiCard label="Demand Covered"       value={fmt(kpis.demandCovered, 0)} color="text-emerald-600" sub="units forecasted" />
        <KpiCard label="Est. Budget"          value={`$${fmt(kpis.totalBudget, 0)}`} color="text-slate-800" sub="proxy @ $1/unit" />
        <KpiCard label="Ready Selected"       value={fmt(kpis.ready)}        color="text-emerald-600" />
        <KpiCard label="Localize Selected"    value={fmt(kpis.localize)}     color="text-purple-600" />
      </div>

      {/* Charts row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Selected vs not by class */}
        <div className="card">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Selected vs Not Selected — by Class</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={byClassChart} margin={{ top: 5, right: 20, bottom: 30, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="cls" tick={{ fontSize: 10 }}>
                <Label value="Readiness Class" position="insideBottom" offset={-18} style={AXIS_LABEL} />
              </XAxis>
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend verticalAlign="top" />
              <Bar dataKey="selected"   name="Selected"     fill="#6366f1" radius={[3,3,0,0]} stackId="a" />
              <Bar dataKey="unselected" name="Not Selected" fill="#e2e8f0" radius={[3,3,0,0]} stackId="a" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Demand by city */}
        <div className="card">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Forecasted Demand by City (selected)</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={demandByCity} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 80 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="city" tick={{ fontSize: 11 }} width={76} />
              <Tooltip formatter={(v) => [fmt(v), 'demand units']} />
              <Bar dataKey="demand" fill="#0ea5e9" radius={[0,3,3,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Priority distribution */}
        <div className="card">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Priority Value per Unit Distribution</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={priorityHist} margin={{ top: 5, right: 20, bottom: 30, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="range" tick={{ fontSize: 9 }} interval={1}>
                <Label value="Priority Value / Unit" position="insideBottom" offset={-18} style={AXIS_LABEL} />
              </XAxis>
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => [v, '# SKU-stores']} />
              <Bar dataKey="count" fill="#f59e0b" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Units by city */}
        <div className="card">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Recommended Units by City (selected)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={unitsByCity} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 80 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="city" tick={{ fontSize: 11 }} width={76} />
              <Tooltip formatter={(v) => [fmt(v), 'units']} />
              <Bar dataKey="units" fill="#10b981" radius={[0,3,3,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-x-auto">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">
          Allocation Detail — first 300 rows of filtered view
        </h3>
        <table className="w-full text-xs text-left">
          <thead>
            <tr className="border-b border-border text-slate-400 uppercase tracking-wider">
              {['Product', 'Store', 'City', 'Forecast', 'Rec Qty', 'Priority/Unit', 'Selected', 'Reason', 'Class', 'Action'].map(h => (
                <th key={h} className="pb-2 pr-4 font-semibold whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableRows.map((r, i) => (
              <tr key={i} className={`border-b border-slate-50 hover:bg-slate-50 ${r.selected ? '' : 'opacity-50'}`}>
                <td className="py-1.5 pr-4 font-mono">{r.product_id}</td>
                <td className="py-1.5 pr-4 font-mono">{r.store_id}</td>
                <td className="py-1.5 pr-4">{r.city}</td>
                <td className="py-1.5 pr-4 tabular-nums">{r.forecast}</td>
                <td className="py-1.5 pr-4 tabular-nums font-medium">{r.rec_qty}</td>
                <td className="py-1.5 pr-4 tabular-nums">{r.priority}</td>
                <td className="py-1.5 pr-4">
                  <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${r.selected ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                    {r.selected ? 'Yes' : 'No'}
                  </span>
                </td>
                <td className="py-1.5 pr-4 max-w-[160px] truncate" title={r.reason}>{r.reason}</td>
                <td className="py-1.5 pr-4">
                  <span
                    className="inline-block px-1.5 py-0.5 rounded text-white text-xs"
                    style={{ background: CLASS_COLORS[r.cls] ?? '#94a3b8' }}
                  >{r.cls}</span>
                </td>
                <td className="py-1.5 pr-4 max-w-[140px] truncate text-slate-600" title={r.action}>{r.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
