"""
Estimate latent (censored) demand for stockout hours using fallback hierarchy:
  1. SKU-store-hour average (non-stockout hours only)
  2. SKU-store DOW average
  3. City average for that SKU-hour
  4. Global SKU average

Adds columns: observed_units, recovered_units, estimated_true_demand
Updates weekly_sku_store with recovered_demand_opportunity_raw.

Input:  data/interim/clean_hourly_sales.parquet
Output: data/processed/weekly_sku_store_recovered_demand.parquet
"""
import pandas as pd
import numpy as np
from src.utils import load_config, get_path, get_logger

log = get_logger(__name__)


def _build_fallbacks(df: pd.DataFrame, cfg: dict) -> pd.DataFrame:
    cols = cfg["columns"]
    sku, store, city, date = cols["sku_id"], cols["store_id"], cols["city_id"], cols["date"]

    in_stock = df[df["stockout"] == 0].copy()

    # Fallback 1: SKU-store-hour mean on in-stock hours
    f1 = (
        in_stock.groupby([sku, store, "hour"])["hourly_sales"]
        .mean()
        .rename("f1_sku_store_hour")
    )
    # Fallback 2: SKU-store DOW mean
    f2 = (
        in_stock.groupby([sku, store, "dow"])["hourly_sales"]
        .mean()
        .rename("f2_sku_store_dow")
    )
    # Fallback 3: city-SKU-hour mean
    f3 = (
        in_stock.groupby([city, sku, "hour"])["hourly_sales"]
        .mean()
        .rename("f3_city_sku_hour")
    )
    # Fallback 4: global SKU mean
    f4 = (
        in_stock.groupby([sku])["hourly_sales"]
        .mean()
        .rename("f4_global_sku")
    )

    df = df.join(f1, on=[sku, store, "hour"])
    df = df.join(f2, on=[sku, store, "dow"])
    df = df.join(f3, on=[city, sku, "hour"])
    df = df.join(f4, on=[sku])
    return df


def _impute(df: pd.DataFrame) -> pd.DataFrame:
    """Fill stockout hours with best available fallback."""
    df["expected_demand"] = (
        df["f1_sku_store_hour"]
        .fillna(df["f2_sku_store_dow"])
        .fillna(df["f3_city_sku_hour"])
        .fillna(df["f4_global_sku"])
        .fillna(0)
    )
    df["observed_units"] = df["hourly_sales"]
    # recovered units = demand added back for stockout hours
    df["recovered_units"] = np.where(df["stockout"] == 1, df["expected_demand"], 0.0)
    df["estimated_true_demand"] = df["observed_units"] + df["recovered_units"]
    return df


def _weekly_summary(df: pd.DataFrame, cfg: dict) -> pd.DataFrame:
    cols = cfg["columns"]
    sku, store, city = cols["sku_id"], cols["store_id"], cols["city_id"]

    weekly = (
        df.groupby([sku, store, city, "week_label"], as_index=False)
        .agg(
            observed_units=("observed_units", "sum"),
            recovered_units=("recovered_units", "sum"),
            estimated_true_demand=("estimated_true_demand", "sum"),
            stockout_rate=("stockout", "mean"),
        )
    )
    weekly["recovered_demand_opportunity_raw"] = (
        weekly["recovered_units"] / weekly["estimated_true_demand"].replace(0, np.nan)
    ).fillna(0).clip(0, 1)
    return weekly


def run(hourly_df: pd.DataFrame | None = None) -> pd.DataFrame:
    cfg = load_config()
    if hourly_df is None:
        hourly_df = pd.read_parquet(get_path("data", "interim", "clean_hourly_sales.parquet"))

    log.info("Building demand recovery fallbacks on %d rows …", len(hourly_df))
    df = _build_fallbacks(hourly_df, cfg)
    df = _impute(df)

    log.info("Summarizing to weekly SKU-store …")
    weekly = _weekly_summary(df, cfg)

    out_path = get_path("data", "processed", "weekly_sku_store_recovered_demand.parquet")
    weekly.to_parquet(out_path, index=False)
    log.info("Saved → %s  (%d rows)", out_path, len(weekly))
    return weekly


if __name__ == "__main__":
    run()
