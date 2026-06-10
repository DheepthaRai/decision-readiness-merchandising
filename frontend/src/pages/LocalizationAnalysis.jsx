import { useState, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell,
} from 'recharts'
import { useRecommendations } from '../hooks/useData'
import { LoadingSpinner, ErrorState } from '../components/LoadingState'
import { getCityName } from '../utils/cityMap'

function hhiLabel(hhi) {
  if (hhi >= 0.7) return { label: 'Localize to select stores', color: 'text-escalate' }
  if (hhi >= 0.35) return { label: 'Localize to key cities', color: 'text-localize' }
  if (hhi >= 0.15) return { label: 'Broad distribution with monitoring', color: 'text-review' }
  return { label: 'Carry broadly — demand well distributed', color: 'text-ready' }
}

function HHIGauge({ hhi }) {
  const { label, color } = hhiLabel(hhi)
  const pct = Math.min(hhi * 100, 100)
  const barColor = hhi >= 0.7 ? '#ef4444' : hhi >= 0.35 ? '#3b82f6' : hhi >= 0.15 ? '#eab308' : '#22c55e'

  return (
    <div className="bg-white border border-border rounded-xl p-5">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
        Geographic Concentration (HHI)
      </p>
      <div className="flex items-center gap-3 mb-2">
        <div className="flex-1 bg-slate-100 rounded-full h-3">
          <div
            className="h-3 rounded-full transition-all"
            style={{ width: `${pct}%`, backgroundColor: barColor }}
          />
        </div>
        <span className="text-lg font-bold tabular-nums">{hhi.toFixed(3)}</span>
      </div>
      <p className={`text-sm font-semibold ${color}`}>{label}</p>
      <p className="text-xs text-slate-400 mt-1">
        HHI of 1.0 = all demand in one location · 0.0 = perfectly spread
      </p>
    </div>
  )
}

export default function LocalizationAnalysis() {
  const { data, loading, error } = useRecommendations()
  const [selectedSku, setSelectedSku] = useState('')
  const [selectedCity, setSelectedCity] = useState('')

  const skus = useMemo(() => [...new Set(data.map(r => String(r.sku_id ?? '')))].sort(), [data])

  const skuRows = useMemo(() =>
    selectedSku ? data.filter(r => String(r.sku_id) === selectedSku) : data,
  [data, selectedSku])

  /* Demand by city for selected SKU */
  const cityDemand = useMemo(() => {
    const agg = {}
    skuRows.forEach(r => {
      const c = String(r.city_id)
      agg[c] = (agg[c] ?? 0) + (r.estimated_true_demand ?? 0)
    })
    return Object.entries(agg)
      .map(([city, demand]) => ({ city: getCityName(city), cityId: city, demand: Math.round(demand) }))
      .sort((a, b) => b.demand - a.demand)
  }, [skuRows])

  /* HHI for selected SKU */
  const hhi = useMemo(() => {
    const total = cityDemand.reduce((s, r) => s + r.demand, 0)
    if (!total) return 0
    return cityDemand.reduce((s, r) => s + (r.demand / total) ** 2, 0)
  }, [cityDemand])

  /* Store ranking within selected city */
  const cities = useMemo(() => [...new Set(data.map(r => String(r.city_id ?? '')))].sort(), [data])

  const storeRanking = useMemo(() => {
    const base = selectedSku ? data.filter(r => String(r.sku_id) === selectedSku) : data
    const city = selectedCity || (cities[0] ?? '')
    return base
      .filter(r => String(r.city_id) === city)
      .reduce((acc, r) => {
        const s = String(r.store_id)
        if (!acc[s]) acc[s] = { store_id: s, demand: 0, stockout_rate: 0, count: 0 }
        acc[s].demand += r.estimated_true_demand ?? 0
        acc[s].stockout_rate += r.stockout_rate ?? 0
        acc[s].count++
        return acc
      }, {})
  }, [data, selectedSku, selectedCity, cities])

  const storeRows = Object.values(storeRanking)
    .map(s => ({ ...s, stockout_rate: s.count ? s.stockout_rate / s.count : 0 }))
    .sort((a, b) => b.demand - a.demand)

  if (loading) return <LoadingSpinner />
  if (error)   return <ErrorState message={error} />

  return (
    <div>
      <h1 className="page-title">Localization Analysis</h1>
      <p className="page-subtitle">Understand where demand is concentrated and how to right-size distribution.</p>

      {/* Selectors */}
      <div className="flex flex-wrap gap-4 mb-6">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">SKU</label>
          <select className="filter-select w-48"
            value={selectedSku} onChange={e => setSelectedSku(e.target.value)}>
            <option value="">All SKUs</option>
            {skus.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">City (for store ranking)</label>
          <select className="filter-select w-56"
            value={selectedCity} onChange={e => setSelectedCity(e.target.value)}>
            {cities.map(c => <option key={c} value={c}>{getCityName(c)}</option>)}
          </select>
        </div>
      </div>

      {/* HHI gauge */}
      <div className="mb-6">
        <HHIGauge hhi={hhi} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="card">
          <p className="section-title">
            {selectedSku ? `Demand by City — SKU ${selectedSku}` : 'Estimated True Demand by City (all SKUs)'}
          </p>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={cityDemand.slice(0, 20)}
              margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="city" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="demand" fill="#3b82f6" radius={[4, 4, 0, 0]}>
                {cityDemand.slice(0, 20).map((d, i) => (
                  <Cell key={i} fill={i === 0 ? '#2563eb' : '#93c5fd'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <p className="section-title">
            Store Ranking in {getCityName(selectedCity || cities[0] || '')}
            {selectedSku ? ` · SKU ${selectedSku}` : ''}
          </p>
          <div className="overflow-auto max-h-72">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  {['Rank', 'Store', 'Est. Demand', 'Avg Stockout %'].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-slate-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {storeRows.map((s, i) => (
                  <tr key={s.store_id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-400 text-xs">#{i + 1}</td>
                    <td className="px-3 py-2 font-medium">{s.store_id}</td>
                    <td className="px-3 py-2 tabular-nums">{Math.round(s.demand).toLocaleString()}</td>
                    <td className="px-3 py-2 tabular-nums">{(s.stockout_rate * 100).toFixed(1)}%</td>
                  </tr>
                ))}
                {!storeRows.length && (
                  <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-400 text-sm">No data for selection</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Localization recommendation text */}
      {selectedSku && (
        <div className="card">
          <p className="section-title">Localization Recommendation for SKU {selectedSku}</p>
          <div className={`text-sm font-semibold ${hhiLabel(hhi).color} mb-1`}>
            {hhiLabel(hhi).label}
          </div>
          <p className="text-sm text-slate-600">
            {hhi >= 0.7
              ? 'This product has highly concentrated demand. Broad distribution would result in significant waste and stockouts in low-demand locations. Consider carrying only in the top 1–2 cities or stores.'
              : hhi >= 0.35
              ? 'Demand is unevenly spread across geographies. A targeted rollout to the top cities will capture the majority of demand while limiting exposure in underperforming locations.'
              : hhi >= 0.15
              ? 'Demand distribution is moderately spread. A broad rollout is viable but regular monitoring of lower-demand locations is recommended.'
              : 'Demand is evenly distributed across cities and stores. This product is a good candidate for broad distribution without location-specific restrictions.'}
          </p>
        </div>
      )}
    </div>
  )
}
