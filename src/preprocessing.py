"""
Preprocess raw FreshRetailNet-50K data.

Input:  data/raw/freshretailnet_raw.parquet
Output: data/interim/clean_daily_sales.csv

Key transformations
  - Explode 24-element hourly arrays into one row per SKU-store-date-hour
  - Parse dates, derive temporal features
  - Standardize IDs, ensure numeric types
  - Handle missing values, remove invalid rows
  - Deduplicate SKU-store-date-hour rows
"""
import pandas as pd
import numpy as np
from src.utils import load_config, get_path, get_logger

log = get_logger(__name__)


def load_raw(path=None) -> pd.DataFrame:
    p = path or get_path("data", "raw", "freshretailnet_raw.parquet")
    return pd.read_parquet(p)


def _explode_hourly(df: pd.DataFrame, cfg: dict) -> pd.DataFrame:
    """Convert daily rows with hourly arrays → one row per SKU-store-date-hour."""
    cols = cfg["columns"]
    id_cols = [
        cols["sku_id"], cols["store_id"], cols["city_id"], cols["date"],
        cols["discount"], cols["holiday_flag"], cols["activity_flag"],
        cols["precpt"], cols["avg_temperature"], cols["avg_humidity"],
        cols["avg_wind_level"], cols["mgmt_group"],
        cols["cat1"], cols["cat2"], cols["cat3"],
    ]
    # keep only columns that exist in the dataframe
    id_cols = [c for c in id_cols if c in df.columns]

    hours_sale_col = cols["hours_sale"]
    hours_stock_col = cols["hours_stock_status"]

    # build list of per-hour dataframes
    records = []
    for hour in range(24):
        tmp = df[id_cols].copy()
        tmp["hour"] = hour
        if hours_sale_col in df.columns:
            tmp["hourly_sales"] = df[hours_sale_col].apply(
                lambda x: x[hour] if (isinstance(x, (list, np.ndarray)) and len(x) > hour) else np.nan
            )
        else:
            tmp["hourly_sales"] = np.nan
        if hours_stock_col in df.columns:
            tmp["in_stock"] = df[hours_stock_col].apply(
                lambda x: int(x[hour]) if (isinstance(x, (list, np.ndarray)) and len(x) > hour) else np.nan
            )
        else:
            tmp["in_stock"] = np.nan
        records.append(tmp)

    hourly = pd.concat(records, ignore_index=True)
    log.info("Exploded to %d hourly rows", len(hourly))
    return hourly


def _parse_dates(df: pd.DataFrame, cfg: dict) -> pd.DataFrame:
    date_col = cfg["columns"]["date"]
    df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
    df["dow"] = df[date_col].dt.dayofweek          # 0=Mon
    df["month"] = df[date_col].dt.month
    df["week"] = df[date_col].dt.isocalendar().week.astype(int)
    df["year"] = df[date_col].dt.year
    df["week_label"] = df[date_col].dt.strftime("%Y-W%V")
    df["is_weekend"] = df["dow"].isin([5, 6]).astype(int)
    df["period"] = pd.cut(
        df["hour"],
        bins=[-1, 5, 11, 17, 23],
        labels=["night", "morning", "afternoon", "evening"],
    )
    return df


def _standardize_ids(df: pd.DataFrame, cfg: dict) -> pd.DataFrame:
    for key in ["sku_id", "store_id", "city_id"]:
        col = cfg["columns"][key]
        if col in df.columns:
            df[col] = df[col].astype(str).str.strip()
    return df


def _fix_numerics(df: pd.DataFrame, cfg: dict) -> pd.DataFrame:
    cols = cfg["columns"]
    df["hourly_sales"] = pd.to_numeric(df["hourly_sales"], errors="coerce").fillna(0).clip(lower=0)
    if cols["discount"] in df.columns:
        df[cols["discount"]] = pd.to_numeric(df[cols["discount"]], errors="coerce").clip(0, 1)
    df["in_stock"] = pd.to_numeric(df["in_stock"], errors="coerce").fillna(0).astype(int).clip(0, 1)
    df["stockout"] = (df["in_stock"] == 0).astype(int)
    return df


def _impute_weather(df: pd.DataFrame, cfg: dict) -> pd.DataFrame:
    """Fill missing weather by city-date average, then global average."""
    weather_cols = [
        cfg["columns"]["precpt"],
        cfg["columns"]["avg_temperature"],
        cfg["columns"]["avg_humidity"],
        cfg["columns"]["avg_wind_level"],
    ]
    city_col = cfg["columns"]["city_id"]
    date_col = cfg["columns"]["date"]

    for col in weather_cols:
        if col not in df.columns:
            continue
        df[col] = pd.to_numeric(df[col], errors="coerce")
        city_day_avg = df.groupby([city_col, date_col])[col].transform("mean")
        global_avg = df[col].mean()
        df[col] = df[col].fillna(city_day_avg).fillna(global_avg)
    return df


def _remove_invalid(df: pd.DataFrame, cfg: dict) -> pd.DataFrame:
    date_col = cfg["columns"]["date"]
    before = len(df)
    df = df.dropna(subset=[date_col])
    df = df[df["hourly_sales"] >= 0]
    log.info("Removed %d invalid rows", before - len(df))
    return df


def _deduplicate(df: pd.DataFrame, cfg: dict) -> pd.DataFrame:
    cols = cfg["columns"]
    key = [cols["sku_id"], cols["store_id"], cols["date"], "hour"]
    key = [c for c in key if c in df.columns]
    before = len(df)
    df = df.drop_duplicates(subset=key, keep="last")
    log.info("Deduplication removed %d rows", before - len(df))
    return df


def run(raw_df: pd.DataFrame | None = None) -> pd.DataFrame:
    cfg = load_config()
    df = raw_df if raw_df is not None else load_raw()

    log.info("Starting preprocessing on %d rows", len(df))
    df = _explode_hourly(df, cfg)
    df = _parse_dates(df, cfg)
    df = _standardize_ids(df, cfg)
    df = _fix_numerics(df, cfg)
    df = _impute_weather(df, cfg)
    df = _remove_invalid(df, cfg)
    df = _deduplicate(df, cfg)

    out_dir = get_path("data", "interim")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "clean_hourly_sales.parquet"
    df.to_parquet(out_path, index=False)
    log.info("Clean hourly data saved → %s  (%d rows)", out_path, len(df))
    return df


if __name__ == "__main__":
    run()
