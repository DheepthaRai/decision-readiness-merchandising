/**
 * Action Queue — /actions
 *
 * Three prioritised tables that surface the most time-sensitive decisions:
 *   1. Top 10 to replenish immediately (Ready to Execute, high confidence, low stockout risk)
 *   2. Top 10 escalations needing merchant review (Escalate, highest hidden demand)
 *   3. Top 5 localisation opportunities (Localize, ranked by demand delta: top city vs average)
 */
import { useMemo } from 'react'
import { useRecommendations } from '../hooks/useData'
import { REASON_PLAIN, AVG_UNIT_VALUE } from '../utils/constants'
import { getCityName } from '../utils/cityMap'
import ClassBadge from '../components/ClassBadge'
import { LoadingSpinner, ErrorState } from '../components/LoadingState'

// ── helpers ──────────────────────────────────────────────────────────────────

function fmt(n, decimals = 0) {
  if (n == null || isNaN(n)) return '—'
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: decimals })
}

function fmtUsd(n) {
  if (n == null || isNaN(n)) return '—'
  return '$' + Number(n).toLocaleString(undefined, {
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  })
}

function SectionHeader({ emoji, title, subtitle }) {
  return (
    <div className="flex items-start gap-3 mb-4">
      <span className="text-2xl leading-none mt-0.5">{emoji}</span>
      <div>
        <h2 className="text-base font-bold text-slate-800">{title}</h2>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  )
}

function Th({ children, right }) {
  return (
    <th className={`px-3 py-2.5 text-xs font-semibold text-slate-500 whitespace-nowrap
                    ${right ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  )
}

function Td({ children, right, mono, muted, bold }) {
  return (
    <td className={`px-3 py-2.5 text-sm
                    ${right ? 'text-right tabular-nums' : ''}
                    ${mono  ? 'font-mono text-xs' : ''}
                    ${muted ? 'text-slate-400 text-xs' : ''}
                    ${bold  ? 'font-semibold' : ''}`}>
      {children}
    </td>
  )
}

// ── sub-tables ────────────────────────────────────────────────────────────────

function ReplenishTable({ rows }) {
  return (
    <div className="card p-0 overflow-hidden mb-8">
      <SectionHeader
        emoji="🟢"
        title="Replenish Immediately — Top 10"
        subtitle="Ready to Execute SKU-stores with highest Sales Confidence Score. These are leaving money on the table — act this week."
      />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-border">
            <tr>
              <Th>#</Th>
              <Th>SKU</Th>
              <Th>Store</Th>
              <Th>City</Th>
              <Th>Week</Th>
              <Th right>Confidence Score</Th>
              <Th right>Supply Reliability</Th>
              <Th right>Weekly Units at Risk</Th>
              <Th right>Est. Revenue at Risk</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row, i) => {
              const unitsAtRisk = Math.max(0, (row.estimated_true_demand ?? 0) - (row.observed_units ?? 0))
              const revenueAtRisk = unitsAtRisk * AVG_UNIT_VALUE
              return (
                <tr key={i} className="hover:bg-green-50/40 transition-colors">
                  <Td muted>#{i + 1}</Td>
                  <Td mono>{row.sku_id}</Td>
                  <Td>{row.store_id}</Td>
                  <Td>{getCityName(row.city_id)}</Td>
                  <Td muted>{row.week_label}</Td>
                  <Td right bold>
                    <span className="text-ready-dark">{row.readiness_score?.toFixed(1)}</span>
                  </Td>
                  <Td right>{row.low_stockout_risk_score?.toFixed(0)}</Td>
                  <Td right>{fmt(unitsAtRisk, 1)}</Td>
                  <Td right bold>
                    <span className="text-ready-dark">{fmtUsd(revenueAtRisk)}</span>
                  </Td>
                </tr>
              )
            })}
            {!rows.length && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-slate-400 text-sm">
                  No "Ready to Execute" rows in current data
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function EscalationTable({ rows }) {
  return (
    <div className="card p-0 overflow-hidden mb-8">
      <SectionHeader
        emoji="🔴"
        title="Escalations Needing Merchant Review — Top 10"
        subtitle="Escalated SKU-stores with the highest estimated hidden demand. These have significant censored sales that require supply chain investigation."
      />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-border">
            <tr>
              <Th>#</Th>
              <Th>SKU</Th>
              <Th>Store</Th>
              <Th>City</Th>
              <Th>Week</Th>
              <Th right>Stockout Rate</Th>
              <Th right>Hidden Demand (units)</Th>
              <Th right>Est. Lost Revenue</Th>
              <Th>Plain-English Reason</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row, i) => {
              const lostRevenue = (row.recovered_units ?? 0) * AVG_UNIT_VALUE
              return (
                <tr key={i} className="hover:bg-red-50/40 transition-colors">
                  <Td muted>#{i + 1}</Td>
                  <Td mono>{row.sku_id}</Td>
                  <Td>{row.store_id}</Td>
                  <Td>{getCityName(row.city_id)}</Td>
                  <Td muted>{row.week_label}</Td>
                  <Td right bold>
                    <span className="text-escalate">
                      {((row.stockout_rate ?? 0) * 100).toFixed(1)}%
                    </span>
                  </Td>
                  <Td right>{fmt(row.recovered_units, 1)}</Td>
                  <Td right bold>
                    <span className="text-escalate">{fmtUsd(lostRevenue)}</span>
                  </Td>
                  <Td>
                    <span className="text-xs text-slate-600 leading-snug">
                      {REASON_PLAIN[row.reason_code] ?? row.reason_code?.replace(/_/g, ' ') ?? '—'}
                    </span>
                  </Td>
                </tr>
              )
            })}
            {!rows.length && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-slate-400 text-sm">
                  No "Escalate" rows in current data
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function LocalizeTable({ rows }) {
  return (
    <div className="card p-0 overflow-hidden">
      <SectionHeader
        emoji="🔵"
        title="Localisation Opportunities — Top 5"
        subtitle="SKUs with the highest demand gap between their strongest city and the average. Rolling these out broadly would leave most locations understocked while overstocking the rest."
      />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-border">
            <tr>
              <Th>#</Th>
              <Th>SKU</Th>
              <Th>Top City</Th>
              <Th right>Demand in Top City</Th>
              <Th right>Avg Demand (other cities)</Th>
              <Th right>Demand Gap</Th>
              <Th right>Est. Revenue Opportunity</Th>
              <Th>Action</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-blue-50/40 transition-colors">
                <Td muted>#{i + 1}</Td>
                <Td mono>{row.sku_id}</Td>
                <Td bold>{getCityName(row.top_city)}</Td>
                <Td right>{fmt(row.top_city_demand, 1)}</Td>
                <Td right>{fmt(row.avg_other_demand, 1)}</Td>
                <Td right bold>
                  <span className="text-localize-dark">+{fmt(row.delta, 1)}</span>
                </Td>
                <Td right bold>
                  <span className="text-localize-dark">{fmtUsd(row.delta * AVG_UNIT_VALUE)}</span>
                </Td>
                <Td>
                  <span className="text-xs text-slate-600">
                    Prioritise restocking in {getCityName(row.top_city)}; reduce allocation elsewhere
                  </span>
                </Td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-slate-400 text-sm">
                  No "Localize" rows in current data
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function ActionQueue() {
  const { data, loading, error } = useRecommendations()

  // 1. Top 10 replenish: Ready to Execute, sorted by readiness_score desc,
  //    then by low_stockout_risk_score desc as a tiebreaker
  const replenishRows = useMemo(() => {
    return data
      .filter(r => r.recommendation_class === 'Ready to Execute')
      .sort((a, b) => {
        const scoreDiff = (b.readiness_score ?? 0) - (a.readiness_score ?? 0)
        if (Math.abs(scoreDiff) > 0.1) return scoreDiff
        return (b.low_stockout_risk_score ?? 0) - (a.low_stockout_risk_score ?? 0)
      })
      .slice(0, 10)
  }, [data])

  // 2. Top 10 escalations: Escalate class, sorted by recovered_units desc
  const escalationRows = useMemo(() => {
    return data
      .filter(r => r.recommendation_class === 'Escalate')
      .sort((a, b) => (b.recovered_units ?? 0) - (a.recovered_units ?? 0))
      .slice(0, 10)
  }, [data])

  // 3. Top 5 localize: compute demand delta (top city vs avg of other cities) per SKU
  const localizeRows = useMemo(() => {
    // Aggregate estimated_true_demand by (sku_id, city_id) across Localize rows
    const localizeData = data.filter(r => r.recommendation_class === 'Localize')

    const skuCity = {}  // { sku_id: { city_id: demand } }
    localizeData.forEach(r => {
      const sku  = String(r.sku_id)
      const city = String(r.city_id)
      if (!skuCity[sku]) skuCity[sku] = {}
      skuCity[sku][city] = (skuCity[sku][city] ?? 0) + (r.estimated_true_demand ?? 0)
    })

    const result = Object.entries(skuCity).map(([sku_id, cityMap]) => {
      const entries = Object.entries(cityMap).sort((a, b) => b[1] - a[1])
      if (entries.length < 2) return null  // need at least 2 cities for a delta
      const [top_city, top_city_demand] = entries[0]
      const other = entries.slice(1)
      const avg_other_demand = other.reduce((s, [, d]) => s + d, 0) / other.length
      const delta = top_city_demand - avg_other_demand
      return { sku_id, top_city, top_city_demand, avg_other_demand, delta }
    })
    .filter(Boolean)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 5)

    return result
  }, [data])

  // Summary banner stats
  const totalAtRisk = useMemo(() => {
    return replenishRows.reduce((s, r) =>
      s + Math.max(0, (r.estimated_true_demand ?? 0) - (r.observed_units ?? 0)), 0)
  }, [replenishRows])

  const totalHiddenDemand = useMemo(() => {
    return escalationRows.reduce((s, r) => s + (r.recovered_units ?? 0), 0)
  }, [escalationRows])

  if (loading) return <LoadingSpinner />
  if (error)   return <ErrorState message={error} />

  return (
    <div>
      <h1 className="page-title">Action Queue</h1>
      <p className="page-subtitle">
        Prioritised actions for this week — sorted by business impact, not score alone.
      </p>

      {/* Summary banner */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="kpi-card border-l-4 border-ready">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
            Revenue at Risk (Replenish)
          </p>
          <p className="text-2xl font-bold text-ready-dark mt-1">
            {fmtUsd(totalAtRisk * AVG_UNIT_VALUE)}
          </p>
          <p className="text-xs text-slate-400">across top 10 ready SKU-stores</p>
        </div>
        <div className="kpi-card border-l-4 border-escalate">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
            Hidden Demand (Escalations)
          </p>
          <p className="text-2xl font-bold text-escalate mt-1">
            {fmtUsd(totalHiddenDemand * AVG_UNIT_VALUE)}
          </p>
          <p className="text-xs text-slate-400">estimated lost revenue this week</p>
        </div>
        <div className="kpi-card border-l-4 border-localize">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
            Localisation Opportunities
          </p>
          <p className="text-2xl font-bold text-localize-dark mt-1">{localizeRows.length}</p>
          <p className="text-xs text-slate-400">SKUs where targeted distribution unlocks demand</p>
        </div>
      </div>

      <ReplenishTable rows={replenishRows} />
      <EscalationTable rows={escalationRows} />
      <LocalizeTable rows={localizeRows} />

      <p className="text-xs text-slate-400 mt-4 text-center">
        Revenue figures use an assumed avg. unit value of ${AVG_UNIT_VALUE.toFixed(2)} (configurable in config.yaml → business.avg_unit_value).
        All figures are estimates — actual results depend on replenishment lead time and demand realisation.
      </p>
    </div>
  )
}
