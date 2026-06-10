"""
Classify each SKU-store-week row into one of four recommendation classes
and attach a human-readable reason code.

Classes (priority order — first match wins):
  ESCALATE       – severe supply or data quality issues
  LOCALIZE       – strong demand but geographically concentrated
  MERCHANT_REVIEW – moderate scores or elevated risk flags
  READY_TO_EXECUTE – strong readiness with acceptable risk

Input:  data/processed/scored_weekly.parquet
Output: outputs/product_store_recommendations.csv
"""
import pandas as pd
import numpy as np
from src.utils import load_config, get_path, get_logger

log = get_logger(__name__)

CLASS_READY = "Ready to Execute"
CLASS_REVIEW = "Merchant Review"
CLASS_LOCALIZE = "Localize"
CLASS_ESCALATE = "Escalate"


def _classify_row(row: pd.Series, t: dict) -> tuple[str, str]:
    score = row["readiness_score"]
    stockout = row.get("stockout_rate", 0)
    volatility_pct = row.get("low_volatility_score", 50)  # low_volatility percentile; low pct = high vol
    promo_dep_pct = row.get("promo_independence_score", 50)  # low = high promo dep
    hhi = row.get("hhi", 0)
    recovered_frac = row.get("recovered_demand_opportunity_raw", 0)

    # ── ESCALATE ────────────────────────────────────────────────────────────
    if stockout >= t["escalate_min_stockout"]:
        return CLASS_ESCALATE, "ESCALATE_STOCKOUT_CENSORED_DEMAND"
    if recovered_frac >= t["escalate_min_recovered_pct"]:
        return CLASS_ESCALATE, "ESCALATE_HIGH_CENSORED_DEMAND"
    if row.get("active_days", 7) < t.get("min_active_days", 2):
        return CLASS_ESCALATE, "ESCALATE_INSUFFICIENT_DATA"

    # ── LOCALIZE ────────────────────────────────────────────────────────────
    if hhi >= t["localize_min_hhi"] and score >= t["review_min_score"]:
        return CLASS_LOCALIZE, "LOCALIZE_CONCENTRATED_DEMAND"
    if hhi >= t["localize_min_hhi"]:
        return CLASS_LOCALIZE, "LOCALIZE_GEOGRAPHIC_CONCENTRATION"

    # ── READY TO EXECUTE ────────────────────────────────────────────────────
    if (
        score >= t["ready_min_score"]
        and stockout < t["ready_max_stockout"]
        and (100 - volatility_pct) < t["ready_max_volatility_pct"]   # convert to risk percentile
        and (100 - promo_dep_pct) < t["ready_max_promo_dep_pct"]
    ):
        return CLASS_READY, "READY_STRONG_CONSISTENT_DEMAND"

    # ── MERCHANT REVIEW ─────────────────────────────────────────────────────
    if score >= t["review_min_score"]:
        if (100 - volatility_pct) >= t["ready_max_volatility_pct"]:
            return CLASS_REVIEW, "REVIEW_HIGH_SALES_VOLATILITY"
        if (100 - promo_dep_pct) >= t["ready_max_promo_dep_pct"]:
            return CLASS_REVIEW, "REVIEW_HIGH_PROMO_DEPENDENCY"
        return CLASS_REVIEW, "REVIEW_BORDERLINE_SCORE"

    return CLASS_REVIEW, "REVIEW_LOW_SCORE"


OUTPUT_COLS = [
    # identifiers
    "sku_id", "store_id", "city_id", "week_label",
    # demand columns
    "observed_units", "estimated_true_demand", "recovered_units",
    # key risk metrics
    "stockout_rate", "active_days", "hhi",
    # raw feature signals (needed by Simulator for live recompute)
    "sales_velocity_raw", "demand_consistency_raw", "stockout_risk_raw",
    "recovered_demand_opportunity_raw", "promotion_dependency_raw",
    "localization_fit_raw", "volatility_risk_raw",
    # percentile-ranked component scores
    "velocity_score", "consistency_score", "localization_score",
    "recovered_demand_score", "promo_independence_score",
    "low_volatility_score", "low_stockout_risk_score",
    # final score and classification
    "readiness_score", "recommendation_class", "reason_code",
]


def run(scored_df: pd.DataFrame | None = None) -> pd.DataFrame:
    cfg = load_config()
    t = cfg["thresholds"]
    cols = cfg["columns"]

    if scored_df is None:
        scored_df = pd.read_parquet(get_path("data", "processed", "scored_weekly.parquet"))

    # rename to standard output column names
    rename = {
        cols["sku_id"]: "sku_id",
        cols["store_id"]: "store_id",
        cols["city_id"]: "city_id",
    }
    df = scored_df.rename(columns=rename)

    log.info("Classifying %d rows …", len(df))
    results = df.apply(_classify_row, axis=1, args=(t,))
    df["recommendation_class"] = [r[0] for r in results]
    df["reason_code"] = [r[1] for r in results]

    # ensure output columns exist (fill missing with NaN)
    for c in OUTPUT_COLS:
        if c not in df.columns:
            df[c] = np.nan

    out = df[OUTPUT_COLS].copy()

    out_path = get_path("outputs", "product_store_recommendations.csv")
    get_path("outputs").mkdir(parents=True, exist_ok=True)
    out.to_csv(out_path, index=False)
    log.info("Recommendations saved → %s  (%d rows)", out_path, len(out))

    # summary
    dist = out["recommendation_class"].value_counts()
    log.info("Class distribution:\n%s", dist.to_string())
    return out


if __name__ == "__main__":
    run()
