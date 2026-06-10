"""
Feature engineering: aggregate hourly → daily/weekly SKU-store tables,
compute all 8 decision-readiness feature scores.

Input:  data/interim/clean_hourly_sales.parquet
Output: data/processed/daily_sku_store.parquet
        data/processed/weekly_sku_store.parquet
"""
import pandas as pd
import numpy as np
from src.utils import load_config, get_path, get_logger

log = get_logger(__name__)

OPS_HOURS = list(range(6, 23))  # 6–22 inclusive = 17 hours


def load_hourly(path=None) -> pd.DataFrame:
    p = path or get_path("data", "interim", "clean_hourly_sales.parquet")
    return pd.read_parquet(p)


# ── aggregation ──────────────────────────────────────────────────────────────

def _daily_agg(df: pd.DataFrame, cfg: dict) -> pd.DataFrame:
    cols = cfg["columns"]
    sku, store, city, date = cols["sku_id"], cols["store_id"], cols["city_id"], cols["date"]
    discount, holiday, activity = cols["discount"], cols["holiday_flag"], cols["activity_flag"]

    ops = df[df["hour"].isin(OPS_HOURS)]
    grp_cols = [sku, store, city, date, "week_label", "dow", "is_weekend"]
    extra = [c for c in [discount, holiday, activity] if c in df.columns]

    agg = (
        ops.groupby(grp_cols + extra, as_index=False)
        .agg(
            daily_sales=("hourly_sales", "sum"),
            stockout_hours=("stockout", "sum"),
            total_ops_hours=("stockout", "count"),
        )
    )
    agg["stockout_rate"] = agg["stockout_hours"] / agg["total_ops_hours"].clip(lower=1)
    return agg


def _weekly_agg(daily: pd.DataFrame, cfg: dict) -> pd.DataFrame:
    cols = cfg["columns"]
    sku, store, city = cols["sku_id"], cols["store_id"], cols["city_id"]
    discount, holiday, activity = cols["discount"], cols["holiday_flag"], cols["activity_flag"]

    grp = [sku, store, city, "week_label"]
    extra = [c for c in [discount, holiday, activity] if c in daily.columns]

    weekly = (
        daily.groupby(grp, as_index=False)
        .agg(
            total_sales=("daily_sales", "sum"),
            days_with_sales=("daily_sales", lambda x: (x > 0).sum()),
            active_days=("daily_sales", "count"),
            avg_daily_sales=("daily_sales", "mean"),
            std_daily_sales=("daily_sales", "std"),
            stockout_rate=("stockout_rate", "mean"),
            avg_discount=(discount, "mean") if discount in daily.columns else ("daily_sales", lambda _: np.nan),
            holiday_days=(holiday, "sum") if holiday in daily.columns else ("daily_sales", lambda _: 0),
            promo_days=(activity, "sum") if activity in daily.columns else ("daily_sales", lambda _: 0),
        )
    )
    weekly["std_daily_sales"] = weekly["std_daily_sales"].fillna(0)
    return weekly


# ── 8 feature scores (raw, before percentile normalization) ─────────────────

def _sales_velocity(weekly: pd.DataFrame) -> pd.Series:
    return weekly["avg_daily_sales"].clip(lower=0)


def _demand_consistency(weekly: pd.DataFrame) -> pd.Series:
    fill_rate = weekly["days_with_sales"] / weekly["active_days"].clip(lower=1)
    cv = weekly["std_daily_sales"] / weekly["avg_daily_sales"].replace(0, np.nan)
    cv = cv.fillna(1.0).clip(upper=2)
    return (fill_rate * (1 - cv / 2)).clip(0, 1)


def _stockout_risk(weekly: pd.DataFrame) -> pd.Series:
    """Higher = more stockout risk (inverted later for scoring)."""
    return weekly["stockout_rate"].clip(0, 1)


def _recovered_demand_opportunity(weekly: pd.DataFrame) -> pd.Series:
    """Placeholder — overwritten after demand_recovery step."""
    return pd.Series(np.zeros(len(weekly)), index=weekly.index)


def _promotion_dependency(weekly: pd.DataFrame) -> pd.Series:
    promo_frac = (weekly["promo_days"] / weekly["active_days"].clip(lower=1)).clip(0, 1)
    return promo_frac


def _localization_fit_hhi(weekly: pd.DataFrame, cfg: dict) -> pd.Series:
    """
    HHI of a SKU's sales across cities: high HHI = concentrated = localize signal.
    Score = 1 - HHI  (high = well-spread = good fit across all cities).
    """
    cols = cfg["columns"]
    sku, city = cols["sku_id"], cols["city_id"]
    city_sales = weekly.groupby([sku, city])["total_sales"].sum().reset_index()
    sku_totals = city_sales.groupby(sku)["total_sales"].sum()
    city_sales = city_sales.join(sku_totals.rename("sku_total"), on=sku)
    city_sales["share"] = city_sales["total_sales"] / city_sales["sku_total"].replace(0, np.nan)
    hhi = city_sales.groupby(sku)["share"].apply(lambda s: (s**2).sum()).rename("hhi")
    # merge back; rows for a SKU that sells in only 1 city get HHI=1
    weekly = weekly.copy()
    if sku in weekly.columns:
        weekly = weekly.join(hhi, on=sku)
    else:
        weekly["hhi"] = 1.0
    weekly["hhi"] = weekly["hhi"].fillna(1.0).clip(0, 1)
    return 1 - weekly["hhi"]


def _volatility_risk(weekly: pd.DataFrame) -> pd.Series:
    cv = weekly["std_daily_sales"] / weekly["avg_daily_sales"].replace(0, np.nan)
    return cv.fillna(1.0).clip(0, 2)


def _freshness_risk_proxy(weekly: pd.DataFrame) -> pd.Series:
    """
    Freshness risk: high stockout + high CV = perishable supply instability.
    This is a proxy since spoilage is unobserved.
    """
    cv = weekly["std_daily_sales"] / weekly["avg_daily_sales"].replace(0, np.nan)
    cv = cv.fillna(1.0).clip(0, 2)
    return ((weekly["stockout_rate"] + cv / 2) / 2).clip(0, 1)


# ── main ─────────────────────────────────────────────────────────────────────

def run(hourly_df: pd.DataFrame | None = None) -> tuple[pd.DataFrame, pd.DataFrame]:
    cfg = load_config()
    df = hourly_df if hourly_df is not None else load_hourly()

    log.info("Computing daily aggregates …")
    daily = _daily_agg(df, cfg)
    log.info("Daily table: %d rows", len(daily))

    log.info("Computing weekly aggregates …")
    weekly = _weekly_agg(daily, cfg)
    log.info("Weekly table: %d rows", len(weekly))

    log.info("Computing feature scores …")
    weekly["sales_velocity_raw"] = _sales_velocity(weekly)
    weekly["demand_consistency_raw"] = _demand_consistency(weekly)
    weekly["stockout_risk_raw"] = _stockout_risk(weekly)
    weekly["recovered_demand_opportunity_raw"] = _recovered_demand_opportunity(weekly)
    weekly["promotion_dependency_raw"] = _promotion_dependency(weekly)
    weekly["localization_fit_raw"] = _localization_fit_hhi(weekly, cfg)
    weekly["hhi"] = 1 - weekly["localization_fit_raw"]   # keep raw HHI for localize logic
    weekly["volatility_risk_raw"] = _volatility_risk(weekly)
    weekly["freshness_risk_raw"] = _freshness_risk_proxy(weekly)

    out = get_path("data", "processed")
    out.mkdir(parents=True, exist_ok=True)
    daily.to_parquet(out / "daily_sku_store.parquet", index=False)
    weekly.to_parquet(out / "weekly_sku_store.parquet", index=False)
    log.info("Saved daily + weekly tables to data/processed/")
    return daily, weekly


if __name__ == "__main__":
    run()
