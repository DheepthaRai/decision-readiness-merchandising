/**
 * Re-compute readiness scores and recommendation classes in the browser
 * using custom weights / thresholds (Simulator page).
 *
 * We do a simple percentile-rank within the provided dataset slice,
 * then apply the weighted formula and threshold rules.
 */

function pctRank(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return values.map(v => {
    const rank = sorted.filter(x => x <= v).length
    return (rank / sorted.length) * 100
  })
}

export function recomputeScores(rows, weights, thresholds) {
  if (!rows.length) return []

  const get = (key) => rows.map(r => r[key] ?? 0)

  const velocity    = pctRank(get('sales_velocity_raw') ?? get('velocity_score'))
  const consistency = pctRank(get('demand_consistency_raw') ?? get('consistency_score'))
  const localization= pctRank(get('localization_fit_raw') ?? get('localization_score'))
  const recovered   = pctRank(get('recovered_demand_opportunity_raw') ?? get('recovered_demand_score'))
  const promoIndep  = pctRank(get('promotion_dependency_raw').map(v => 1 - (v ?? 0)))
  const lowVol      = pctRank(get('volatility_risk_raw').map(v => 1 - Math.min(v ?? 0, 1)))
  const lowStock    = pctRank(get('stockout_rate').map(v => 1 - (v ?? 0)))

  return rows.map((row, i) => {
    const score =
      weights.velocity       * velocity[i]
      + weights.consistency  * consistency[i]
      + weights.localization * localization[i]
      + weights.recovered    * recovered[i]
      + weights.promoIndep   * promoIndep[i]
      + weights.lowVol       * lowVol[i]
      + weights.lowStock     * lowStock[i]

    const cls = classify(row, score, thresholds,
      100 - lowVol[i], 100 - promoIndep[i])

    return {
      ...row,
      readiness_score: Math.round(score * 10) / 10,
      recommendation_class: cls,
    }
  })
}

function classify(row, score, t, volRisk, promoDep) {
  const stockout = row.stockout_rate ?? 0
  const hhi      = row.hhi ?? 0
  const recovered= row.recovered_demand_opportunity_raw ?? 0
  const activeDays = row.active_days ?? 7

  if (stockout >= t.escalateStockout)   return 'Escalate'
  if (recovered >= t.escalateRecovered) return 'Escalate'
  if (activeDays < 3)                   return 'Escalate'
  if (hhi >= t.localizeHHI && score >= t.reviewMin) return 'Localize'
  if (hhi >= t.localizeHHI)             return 'Localize'
  if (
    score >= t.readyMin
    && stockout < t.readyMaxStockout
    && volRisk < t.readyMaxVolPct
    && promoDep < t.readyMaxPromoPct
  ) return 'Ready to Execute'
  if (score >= t.reviewMin) return 'Merchant Review'
  return 'Merchant Review'
}
