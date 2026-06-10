"""
Compute weighted readiness score 0–100.

All 7 component scores are first percentile-ranked (0–100) within the weekly
snapshot so that scores are relative to peers. The final score is the weighted
sum of the 7 percentile scores, giving a single 0–100 readiness number.

Input:  data/processed/weekly_sku_store.parquet
        data/processed/weekly_sku_store_recovered_demand.parquet
Output: data/processed/scored_weekly.parquet
"""
import pandas as pd
import numpy as np
from scipy.stats import rankdata
from src.utils import load_config, get_path, get_logger

log = get_logger(__name__)


def percentile_rank(series: pd.Series) -> pd.Series:
    """Return 0–100 percentile rank, higher = better raw value."""
    ranks = rankdata(series.fillna(0), method="average")
    return pd.Series(ranks / len(ranks) * 100, index=series.index)


def run(weekly_df: pd.DataFrame | None = None, recovery_df: pd.DataFrame | None = None) -> pd.DataFrame:
    cfg = load_config()
    w = cfg["scoring"]["weights"]

    if weekly_df is None:
        weekly_df = pd.read_parquet(get_path("data", "processed", "weekly_sku_store.parquet"))
    if recovery_df is None:
        recovery_df = pd.read_parquet(
            get_path("data", "processed", "weekly_sku_store_recovered_demand.parquet")
        )

    cols = cfg["columns"]
    sku, store, city = cols["sku_id"], cols["store_id"], cols["city_id"]
    join_keys = [sku, store, city, "week_label"]

    # merge recovery data in
    df = weekly_df.merge(
        recovery_df[[*join_keys, "observed_units", "recovered_units",
                     "estimated_true_demand", "recovered_demand_opportunity_raw"]],
        on=join_keys,
        how="left",
        suffixes=("", "_rec"),
    )
    # use recovery value if available
    df["recovered_demand_opportunity_raw"] = df.get(
        "recovered_demand_opportunity_raw",
        df.get("recovered_demand_opportunity_raw_rec", 0),
    )

    log.info("Scoring %d SKU-store-week rows …", len(df))

    # ── percentile ranks ────────────────────────────────────────────────────
    # Higher velocity  → better
    df["velocity_score"] = percentile_rank(df["sales_velocity_raw"])
    # Higher consistency → better
    df["consistency_score"] = percentile_rank(df["demand_consistency_raw"])
    # Higher localization fit (low HHI) → better
    df["localization_score"] = percentile_rank(df["localization_fit_raw"])
    # Higher recovered demand opportunity → better (means more upside to capture)
    df["recovered_demand_score"] = percentile_rank(df["recovered_demand_opportunity_raw"])
    # Lower promo dependency → better (invert)
    df["promo_independence_score"] = percentile_rank(1 - df["promotion_dependency_raw"])
    # Lower volatility → better (invert)
    df["low_volatility_score"] = percentile_rank(1 - df["volatility_risk_raw"].clip(0, 1))
    # Lower stockout risk → better (invert)
    df["low_stockout_risk_score"] = percentile_rank(1 - df["stockout_risk_raw"])

    # ── weighted readiness score ────────────────────────────────────────────
    df["readiness_score"] = (
        w["velocity"]          * df["velocity_score"]
        + w["consistency"]     * df["consistency_score"]
        + w["localization"]    * df["localization_score"]
        + w["recovered_demand"] * df["recovered_demand_score"]
        + w["promo_independence"] * df["promo_independence_score"]
        + w["low_volatility"]  * df["low_volatility_score"]
        + w["low_stockout_risk"] * df["low_stockout_risk_score"]
    ).round(2)

    out_path = get_path("data", "processed", "scored_weekly.parquet")
    df.to_parquet(out_path, index=False)
    log.info("Scored data saved → %s", out_path)
    return df


if __name__ == "__main__":
    run()
