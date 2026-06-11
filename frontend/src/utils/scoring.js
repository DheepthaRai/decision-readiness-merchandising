/**
 * Re-compute readiness scores and recommendation classes in the browser
 * using custom weights / thresholds (Simulator page).
 */

/**
 * O(n log n) percentile rank.
 * Returns an array where each element is the percentile (0–100) of the
 * corresponding input value within the array.
 */
function pctRank(values) {
  const n = values.length
  if (n === 0) return []
  // Pair each value with its original index, sort ascending
  const indexed = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0])
  const ranks = new Array(n)
  indexed.forEach(([, origIdx], sortedIdx) => {
    ranks[origIdx] = ((sortedIdx + 1) / n) * 100
  })
  return ranks
}

/**
 * Recompute scores for a slice of rows using custom weights and thresholds.
 * Operates on whatever rows are passed in — callers should sample large datasets
 * before calling this (see Simulator.jsx).
 */
export function recomputeScores(rows, weights, thresholds) {
  if (!rows.length) return []

  const get = (key) => rows.map(r => r[key] ?? 0)

  const velocity     = pctRank(get('sales_velocity_raw'))
  const consistency  = pctRank(get('demand_consistency_raw'))
  const localization = pctRank(get('localization_fit_raw'))
  const recovered    = pctRank(get('recovered_demand_opportunity_raw'))
  const promoIndep   = pctRank(get('promotion_dependency_raw').map(v => 1 - (v ?? 0)))
  const lowVol       = pctRank(get('volatility_risk_raw').map(v => 1 - Math.min(v ?? 0, 1)))
  const lowStock     = pctRank(get('stockout_rate').map(v => 1 - (v ?? 0)))

  return rows.map((row, i) => {
    const score =
        weights.velocity       * velocity[i]
      + weights.consistency    * consistency[i]
      + weights.localization   * localization[i]
      + weights.recovered      * recovered[i]
      + weights.promoIndep     * promoIndep[i]
      + weights.lowVol         * lowVol[i]
      + weights.lowStock       * lowStock[i]

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
  const stockout   = row.stockout_rate ?? 0
  const hhi        = row.hhi ?? 0
  const recovered  = row.recovered_demand_opportunity_raw ?? 0
  const activeDays = row.active_days ?? 7

  if (stockout >= t.escalateStockout)   return 'Escalate'
  if (recovered >= t.escalateRecovered) return 'Escalate'
  if (activeDays < 3)                   return 'Escalate'
  if (hhi >= t.localizeHHI)             return 'Localize'
  if (
    score >= t.readyMin
    && stockout < t.readyMaxStockout
    && volRisk  < t.readyMaxVolPct
    && promoDep < t.readyMaxPromoPct
  ) return 'Ready to Execute'
  if (score >= t.reviewMin) return 'Merchant Review'
  return 'Merchant Review'
}
