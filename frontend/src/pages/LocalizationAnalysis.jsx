import { useState, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell, Label,
} from 'recharts'
import { useRecommendations } from '../hooks/useData'
import { LoadingSpinner, ErrorState } from '../components/LoadingState'
import { getCityName } from '../utils/cityMap'

const AXIS_LABEL = { fontSize: 11, fill: '#64748b' }

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
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
        Geographic Concentration (HHI)
      </p>
      <p className="text-xs text-slate-400 mb-3">
        Computed on <span className="font-medium">demand per store</span> per city — normalised for store count so Shanghai's 290 stores don't dominate every SKU.
        Select a SKU above to see its specific concentration.
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
        HHI 1.0 = all per-store demand in one city · 0.0 = perfectly even
      </p>
    </div>
  )
}

export default function LocalizationAnalysis() {
  const { data, loading, error } = useRecommendations()
  const [selectedSku, setSelectedSku] = useState('')
  const [selectedCity, setSelectedCity] = useState('')

  const skus = useMemo(() => {
    const ids = [...new Set(data.map(r => r.sku_id).filter(v => v != null))]
    return ids.sort((a, b) => Number(a) - Number(b)).map(String)
  }, [data])

  const skuRows = useMemo(() =>
    // eslint-disable-next-line eqeqeq
    selectedSku ? data.filter(r => r.sku_id == selectedSku) : data,
  [data, selectedSku])

  // Store count per city across the FULL dataset (not just the SKU slice),
  // used to normalise demand so city size doesn't inflate HHI.
  const storesPerCity = useMemo(() => {
    const map = {}
    data.forEach(r => {
      const c = String(r.city_id)
      if (!map[c]) map[c] = new Set()
      map[c].add(String(r.store_id))
    })
    return Object.fromEntries(Object.entries(map).map(([c, s]) => [c, s.size]))
  }, [data])

  // Total demand per city for the selected SKU (or all SKUs)
  const cityDemandRaw = useMemo(() => {
    const agg = {}
    skuRows.forEach(r => {
      const c = String(r.city_id)
      agg[c] = (agg[c] ?? 0) + (r.estimated_true_demand ?? 0)
    })
    return agg
  }, [skuRows])

  // Per-store demand: total demand ÷ stores in that city
  // This is what we use for HHI and the bar chart
  const cityDemand = useMemo(() => {
    return Object.entries(cityDemandRaw)
      .map(([cityId, total]) => {
        const stores = storesPerCity[cityId] ?? 1
        return {
          city: getCityName(cityId),
          cityId,
          demandPerStore: Math.round(total / stores),
          totalDemand: Math.round(total),
          stores,
        }
      })
      .sort((a, b) => b.demandPerStore - a.demandPerStore)
  }, [cityDemandRaw, storesPerCity])

  // HHI on per-store demand — measures genuine SKU-level geographic concentration
  const hhi = useMemo(() => {
    const total = cityDemand.reduce((s, r) => s + r.demandPerStore, 0)
    if (!total) return 0
    return cityDemand.reduce((s, r) => s + (r.demandPerStore / total) ** 2, 0)
  }, [cityDemand])

  const cities = useMemo(() => {
    const ids = [...new Set(data.map(r => r.city_id).filter(v => v != null))]
    return ids.sort((a, b) => Number(a) - Number(b)).map(String)
  }, [data])

  const storeRanking = useMemo(() => {
    // eslint-disable-next-line eqeqeq
    const base = selectedSku ? data.filter(r => r.sku_id == selectedSku) : data
    const city = selectedCity || (cities[0] ?? '')
    return base
      // eslint-disable-next-line eqeqeq
      .filter(r => r.city_id == city)
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
          <label className="block text-xs font-medium text-slate-500 mb-1">SKU — controls HHI and demand chart</label>
          <select className="filter-select w-48"
            value={selectedSku} onChange={e => setSelectedSku(e.target.value)}>
            <option value="">All SKUs</option>
            {skus.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">City — controls store ranking table only</label>
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
            {selectedSku ? `Demand per Store by City — SKU ${selectedSku}` : 'Avg Demand per Store by City (all SKUs)'}
          </p>
          <p className="text-xs text-slate-400 mb-3">
            Normalised by store count — shows whether cities over- or under-perform relative to their market size
          </p>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={cityDemand.slice(0, 20)}
              margin={{ top: 4, right: 16, left: 56, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="city" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" interval={0}>
                <Label value="City (proxy)" offset={-48} position="insideBottom" style={AXIS_LABEL} />
              </XAxis>
              <YAxis tick={{ fontSize: 11 }}>
                <Label value="Est. Demand per Store (units)" angle={-90} position="insideLeft" offset={-42} style={AXIS_LABEL} />
              </YAxis>
              <Tooltip
                formatter={(v, name, props) => [
                  `${v.toLocaleString()} units/store  (${props.payload.stores} stores, ${props.payload.totalDemand.toLocaleString()} total)`,
                  'Demand per Store',
                ]}
              />
              <Bar dataKey="demandPerStore" fill="#3b82f6" radius={[4, 4, 0, 0]}>
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
          <p className="text-xs text-slate-400 mb-3">
            Use the City dropdown above to change which city is shown here
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
                    <td className="px-3 py-2 font-medium">Store {s.store_id}</td>
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
              ? 'This product has highly concentrated demand per store. Broad distribution would result in significant waste and stockouts in low-demand locations. Consider carrying only in the top 1–2 cities or stores.'
              : hhi >= 0.35
              ? 'Demand per store is unevenly spread. A targeted rollout to the top cities will capture the majority of demand while limiting exposure in underperforming locations.'
              : hhi >= 0.15
              ? 'Demand per store is moderately spread. A broad rollout is viable but regular monitoring of lower-demand locations is recommended.'
              : 'Demand per store is evenly distributed across cities. This product is a good candidate for broad distribution without location-specific restrictions.'}
          </p>
        </div>
      )}
    </div>
  )
}
