export const CLASS_COLORS = {
  'Ready to Execute': '#22c55e',
  'Merchant Review':  '#eab308',
  'Localize':         '#3b82f6',
  'Escalate':         '#ef4444',
}

export const CLASS_BADGE = {
  'Ready to Execute': 'badge-ready',
  'Merchant Review':  'badge-review',
  'Localize':         'badge-localize',
  'Escalate':         'badge-escalate',
}

export const CLASS_PLAIN = {
  'Ready to Execute': 'This product is performing well and is ready for full rollout.',
  'Merchant Review':  'This product needs a closer look before proceeding — see flags below.',
  'Localize':         'Demand is strong but concentrated in specific locations. Consider targeted distribution.',
  'Escalate':         'Significant supply issues detected. Immediate attention required.',
}

export const REASON_PLAIN = {
  READY_STRONG_CONSISTENT_DEMAND: 'Strong, consistent sales with low stockout and low promotional reliance.',
  REVIEW_HIGH_SALES_VOLATILITY:   'Sales fluctuate significantly week to week — forecast risk is elevated.',
  REVIEW_HIGH_PROMO_DEPENDENCY:   'Most sales occur during promotions. Baseline demand is unclear.',
  REVIEW_BORDERLINE_SCORE:        'Overall readiness score is moderate — further review recommended.',
  REVIEW_LOW_SCORE:               'Readiness score is below threshold for confident execution.',
  LOCALIZE_CONCENTRATED_DEMAND:   'Sales are heavily concentrated in a subset of cities or stores.',
  LOCALIZE_GEOGRAPHIC_CONCENTRATION: 'Geographic demand spread is narrow — broad rollout not advised.',
  ESCALATE_STOCKOUT_CENSORED_DEMAND: 'Stockout rate exceeds 30%. Reported sales understate true demand.',
  ESCALATE_HIGH_CENSORED_DEMAND:  'Large share of estimated demand was lost to stockouts.',
  ESCALATE_INSUFFICIENT_DATA:     'Too few days of sales history to score reliably.',
}

export const DATA_BASE = import.meta.env.BASE_URL + 'data/'

// ── Merchant-friendly score label map ────────────────────────────────────────
// Maps raw CSV column names → display labels shown to merchandising users.
// Never rename the actual data keys — only what's shown in the UI.
export const SCORE_LABELS = {
  readiness_score:            'Sales Confidence Score',
  velocity_score:             'Sales Velocity',
  consistency_score:          'Demand Stability',
  localization_score:         'Store Fit',
  recovered_demand_score:     'Hidden Demand Signal',
  promo_independence_score:   'Promo Reliance',   // lower = more reliant
  low_volatility_score:       'Demand Volatility', // lower = more volatile
  low_stockout_risk_score:    'Supply Reliability',
}

// Simulator weight slider labels (map weight keys → friendly names)
export const WEIGHT_LABELS_FRIENDLY = {
  velocity:     'Sales Velocity',
  consistency:  'Demand Stability',
  localization: 'Store Fit',
  recovered:    'Hidden Demand Signal',
  promoIndep:   'Promo Reliance (Independence)',
  lowVol:       'Low Demand Volatility',
  lowStock:     'Supply Reliability',
}

// ── Business value proxy ─────────────────────────────────────────────────────
// Default average unit selling price for fresh retail (USD).
// Matches the avg_unit_value in config.yaml — update both together.
export const AVG_UNIT_VALUE = 3.50

// ── Stockout pattern thresholds ───────────────────────────────────────────────
// If >= this many stores in the same city share a high stockout for one SKU/week,
// the pattern is classified as "City-wide" (possible vendor / DC issue).
export const CITYWIDE_STORE_MIN = 3
