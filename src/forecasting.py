"""
V2 — src/forecasting.py
=======================
Forecast next-week estimated true demand by SKU-store.

Why forecast true demand (not observed sales)?
  Observed sales are censored by stockouts: when a product is out of stock,
  the sales record shows zero rather than the actual latent demand. Forecasting
  on that censored signal would train a model to predict supply failures, not
  consumer demand. We use estimated_true_demand (stockout-imputed) as the
  target so the model learns underlying demand patterns.

Architecture:
  1. Naive baseline        — forecast = lag_1 true demand
  2. Rolling baseline      — forecast = rolling 3-week average true demand
  3. Main model            — LightGBM (falls back to HistGradientBoosting)
  Time split: train on earlier weeks, test on the latest week(s).
  With only 2 weeks (eval split), train=W1, test=W2.

Column mapping from product_store_recommendations.csv:
  sku_id                  ← product_id (renamed by recommendation_rules.py)
  promo_independence_score ← inverted promo dependency (lower = more dependent)
  low_volatility_score     ← inverted volatility (lower = more volatile)
  low_stockout_risk_score  ← inverted stockout risk (lower = worse reliability)
  recovered_units          ← recovered demand units

Outputs:
  outputs/forecast_results.csv
  outputs/forecast_results_sample.csv   (≤ SAMPLE_ROWS rows for dashboard)
  outputs/forecast_metrics.json
"""

from __future__ import annotations

import json
import warnings
import numpy as np
import pandas as pd
from pathlib import Path

from src.utils import get_path, get_logger, load_config

log = get_logger(__name__)
warnings.filterwarnings("ignore", category=UserWarning)

SAMPLE_ROWS = 5_000   # dashboard file size cap
GROUP_COLS  = ["sku_id", "store_id"]
WEEK_COL    = "week_label"
TARGET_COL  = "next_week_estimated_true_demand"


# ── city name helper ─────────────────────────────────────────────────────────

def _city_name(cfg: dict, city_id) -> str:
    """Return proxy city name from config, or 'City {id}' fallback."""
    cmap = cfg.get("city_proxy_map", {})
    entry = cmap.get(int(city_id), {})
    return entry.get("name", f"City {city_id}")


# ── data loading ─────────────────────────────────────────────────────────────

def load_recommendations(path: Path | None = None) -> pd.DataFrame:
    p = path or get_path("outputs", "product_store_recommendations.csv")
    df = pd.read_csv(p)
    # parse week to sortable integer (2024-W26 → 202426)
    df["week_sort"] = df[WEEK_COL].str.replace("-W", "").astype(int)
    return df


# ── feature engineering ──────────────────────────────────────────────────────

def build_features(df: pd.DataFrame, cfg: dict) -> pd.DataFrame:
    """
    Build forecasting features per SKU-store, ordered by week.

    Lag and rolling features that require more weeks than available are
    left as NaN and then filled with the SKU-store mean (or 0 for std).
    This is documented because the eval split has only 2 weeks, making
    3-week rolling features unavailable for most rows.
    """
    df = df.sort_values(GROUP_COLS + ["week_sort"]).copy()

    grp = df.groupby(GROUP_COLS)

    # ── lags ──────────────────────────────────────────────────────────────────
    df["lag_1_true_demand"]      = grp["estimated_true_demand"].shift(1)
    df["lag_2_true_demand"]      = grp["estimated_true_demand"].shift(2)

    # ── rolling stats (3-week window, computed on rows before current) ────────
    rolling = grp["estimated_true_demand"].transform(
        lambda s: s.shift(1).rolling(3, min_periods=1).mean()
    )
    df["rolling_3wk_avg_true_demand"] = rolling

    rolling_std = grp["estimated_true_demand"].transform(
        lambda s: s.shift(1).rolling(3, min_periods=2).std()
    )
    df["rolling_3wk_std_true_demand"] = rolling_std.fillna(0)

    # ── target: next-week true demand ─────────────────────────────────────────
    df[TARGET_COL] = grp["estimated_true_demand"].shift(-1)

    # ── week number ───────────────────────────────────────────────────────────
    df["week_number"] = df[WEEK_COL].str.extract(r"W(\d+)").astype(float)

    # ── city name ─────────────────────────────────────────────────────────────
    df["city"] = df["city_id"].apply(lambda c: _city_name(cfg, c))

    # ── fill remaining NaNs in lag features ──────────────────────────────────
    # Use the SKU-store historical mean for lag_1 when it is missing (first row),
    # which only happens on the very first observed week per SKU-store.
    sku_store_mean = df.groupby(GROUP_COLS)["estimated_true_demand"].transform("mean")
    df["lag_1_true_demand"] = df["lag_1_true_demand"].fillna(sku_store_mean)
    df["lag_2_true_demand"] = df["lag_2_true_demand"].fillna(sku_store_mean)

    return df


FEATURE_COLS = [
    "lag_1_true_demand",
    "lag_2_true_demand",
    "rolling_3wk_avg_true_demand",
    "rolling_3wk_std_true_demand",
    "observed_units",
    "recovered_units",
    "stockout_rate",
    "promo_independence_score",   # inverted: lower = more promo-dependent
    "low_volatility_score",       # inverted: lower = more volatile
    "low_stockout_risk_score",    # inverted: lower = more stockout risk
    "readiness_score",
    "week_number",
]

# Categorical columns handled natively by LightGBM
CAT_COLS = ["sku_id", "store_id", "city_id"]


# ── time-based train / test split ─────────────────────────────────────────────

def time_split(df: pd.DataFrame, test_frac: float = 0.2) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Split on sorted unique weeks.  Minimum: keep the latest 1 week for test.
    With only 2 weeks (eval split) this gives train=W1, test=W2.
    """
    weeks = sorted(df["week_sort"].unique())
    n_test = max(1, round(len(weeks) * test_frac))
    test_weeks  = set(weeks[-n_test:])
    train_weeks = set(weeks[:-n_test])

    train = df[df["week_sort"].isin(train_weeks)]
    test  = df[df["week_sort"].isin(test_weeks)]
    log.info(
        "Train weeks: %s (%d rows) | Test weeks: %s (%d rows)",
        sorted(train_weeks), len(train), sorted(test_weeks), len(test),
    )
    return train, test


# ── metrics ──────────────────────────────────────────────────────────────────

def _smape(actual: np.ndarray, pred: np.ndarray) -> float:
    denom = (np.abs(actual) + np.abs(pred)) / 2
    mask = denom > 0
    if mask.sum() == 0:
        return np.nan
    return float(np.mean(np.abs(actual[mask] - pred[mask]) / denom[mask]) * 100)


def compute_metrics(actual: np.ndarray, pred: np.ndarray, name: str) -> dict:
    err = pred - actual
    abs_err = np.abs(err)
    return {
        "model": name,
        "mae":   float(np.mean(abs_err)),
        "rmse":  float(np.sqrt(np.mean(err**2))),
        "smape": _smape(actual, pred),
        "bias":  float(np.mean(err)),
    }


# ── models ────────────────────────────────────────────────────────────────────

def _get_model():
    """Return LightGBM regressor, or HistGradientBoosting as fallback."""
    try:
        import lightgbm as lgb
        model = lgb.LGBMRegressor(
            n_estimators=300,
            learning_rate=0.05,
            num_leaves=31,
            min_child_samples=5,
            subsample=0.8,
            colsample_bytree=0.8,
            random_state=42,
            verbose=-1,
        )
        model_name = "LightGBM"
        log.info("Using LightGBM regressor")
    except ImportError:
        from sklearn.ensemble import HistGradientBoostingRegressor
        from sklearn.preprocessing import OrdinalEncoder
        model = HistGradientBoostingRegressor(
            max_iter=300,
            learning_rate=0.05,
            max_leaf_nodes=31,
            min_samples_leaf=5,
            random_state=42,
        )
        model_name = "HistGradientBoosting"
        log.info("LightGBM not installed — using HistGradientBoostingRegressor fallback")
    return model, model_name


def _prepare_X(df: pd.DataFrame, model_name: str, encoder=None) -> tuple[np.ndarray | pd.DataFrame, object | None]:
    """Prepare feature matrix. Returns (X, encoder_or_None)."""
    feature_cols = FEATURE_COLS + CAT_COLS

    if model_name == "LightGBM":
        X = df[feature_cols].copy()
        for c in CAT_COLS:
            X[c] = X[c].astype("category")
        return X, None
    else:
        # HistGradientBoosting needs ordinal encoding for categoricals
        from sklearn.preprocessing import OrdinalEncoder
        X_num = df[FEATURE_COLS].values
        X_cat = df[CAT_COLS].astype(str).values
        if encoder is None:
            encoder = OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=-1)
            X_cat = encoder.fit_transform(X_cat)
        else:
            X_cat = encoder.transform(X_cat)
        return np.hstack([X_num, X_cat]), encoder


def _fit_predict(model, model_name: str, train: pd.DataFrame, test: pd.DataFrame):
    """Fit model on train, predict on test. Returns (preds, encoder)."""
    y_train = train[TARGET_COL].values
    X_train, encoder = _prepare_X(train, model_name)
    X_test, _        = _prepare_X(test,  model_name, encoder=encoder)

    if model_name == "LightGBM":
        model.fit(X_train, y_train, categorical_feature=[c for c in CAT_COLS])
    else:
        model.fit(X_train, y_train)

    preds = model.predict(X_test)
    return np.clip(preds, 0, None), encoder


# ── main ─────────────────────────────────────────────────────────────────────

def run(recs_df: pd.DataFrame | None = None) -> tuple[pd.DataFrame, dict]:
    cfg = load_config()

    # ── load data ──────────────────────────────────────────────────────────
    if recs_df is None:
        recs_df = load_recommendations()
    log.info("Loaded %d recommendation rows", len(recs_df))

    # ── feature engineering ────────────────────────────────────────────────
    log.info("Building forecasting features …")
    df = build_features(recs_df, cfg)

    # ── drop rows with no target (last week per SKU-store has no next week)
    df_with_target = df.dropna(subset=[TARGET_COL]).copy()
    log.info(
        "%d rows have a next-week target (%.1f%% of total)",
        len(df_with_target), 100 * len(df_with_target) / len(df),
    )

    if len(df_with_target) == 0:
        log.warning("No rows with a valid target — only one week of data? Aborting forecast.")
        empty = pd.DataFrame()
        metrics = {"error": "Insufficient weekly history for forecasting"}
        return empty, metrics

    # ── train / test split ─────────────────────────────────────────────────
    train, test = time_split(df_with_target)
    if len(test) == 0:
        log.warning("Test set is empty after split — cannot evaluate.")
        empty = pd.DataFrame()
        return empty, {}

    # ── baselines ──────────────────────────────────────────────────────────
    naive_preds   = np.clip(test["lag_1_true_demand"].fillna(0).values, 0, None)
    rolling_preds = np.clip(test["rolling_3wk_avg_true_demand"].fillna(0).values, 0, None)

    # ── ML model ───────────────────────────────────────────────────────────
    model, model_name = _get_model()
    log.info("Fitting %s …", model_name)
    ml_preds, _ = _fit_predict(model, model_name, train, test)

    y_test = test[TARGET_COL].values

    # ── metrics ────────────────────────────────────────────────────────────
    naive_m   = compute_metrics(y_test, naive_preds,   "naive_baseline")
    rolling_m = compute_metrics(y_test, rolling_preds, "rolling_baseline")
    ml_m      = compute_metrics(y_test, ml_preds,      model_name)

    def _pct_improvement(baseline_mae, ml_mae):
        if baseline_mae == 0:
            return 0.0
        return float((baseline_mae - ml_mae) / baseline_mae * 100)

    # ── per-city MAE ───────────────────────────────────────────────────────
    test_copy = test.copy()
    test_copy["ml_pred"]      = ml_preds
    test_copy["naive_pred"]   = naive_preds
    test_copy["rolling_pred"] = rolling_preds
    test_copy["abs_err_ml"]   = np.abs(ml_preds - y_test)

    mae_by_city = (
        test_copy.groupby("city")["abs_err_ml"].mean()
        .round(3).to_dict()
    )
    mae_by_class = (
        test_copy.groupby("recommendation_class")["abs_err_ml"].mean()
        .round(3).to_dict()
    )

    train_weeks = sorted(train[WEEK_COL].unique())
    test_weeks  = sorted(test[WEEK_COL].unique())

    metrics = {
        "model_name":               model_name,
        "primary_kpi":              "MAE",
        "train_weeks":              train_weeks,
        "test_weeks":               test_weeks,
        "test_row_count":           int(len(test)),
        "naive_mae":                round(naive_m["mae"], 4),
        "rolling_mae":              round(rolling_m["mae"], 4),
        "ml_mae":                   round(ml_m["mae"], 4),
        "naive_rmse":               round(naive_m["rmse"], 4),
        "rolling_rmse":             round(rolling_m["rmse"], 4),
        "ml_rmse":                  round(ml_m["rmse"], 4),
        "ml_smape":                 round(ml_m["smape"], 4) if ml_m["smape"] is not None else None,
        "ml_bias":                  round(ml_m["bias"], 4),
        "improvement_vs_naive_pct": round(_pct_improvement(naive_m["mae"], ml_m["mae"]), 2),
        "improvement_vs_rolling_pct": round(_pct_improvement(rolling_m["mae"], ml_m["mae"]), 2),
        "mae_by_city":              mae_by_city,
        "mae_by_recommendation_class": mae_by_class,
        "note_data_limitation": (
            "The eval split contains only 2 weeks (W26, W27). "
            "lag_2 and rolling_3wk features are unavailable for most rows. "
            "This is a short-horizon prototype; do not interpret as production-grade accuracy."
        ),
    }

    log.info(
        "Forecast metrics — Naive MAE: %.2f | Rolling MAE: %.2f | %s MAE: %.2f | "
        "vs naive: %+.1f%%",
        naive_m["mae"], rolling_m["mae"], model_name, ml_m["mae"],
        _pct_improvement(naive_m["mae"], ml_m["mae"]),
    )

    # ── build output dataframe ─────────────────────────────────────────────
    results = test.copy()
    results["forecasted_true_demand"]    = ml_preds
    results["naive_forecast"]            = naive_preds
    results["rolling_forecast"]          = rolling_preds
    results["next_week_actual_true_demand"] = y_test
    results["forecast_error"]            = ml_preds - y_test
    results["absolute_error"]            = np.abs(ml_preds - y_test)
    results["model_name"]                = model_name

    output_cols = [
        "sku_id", "store_id", "city", "week_label",
        "estimated_true_demand", "next_week_actual_true_demand",
        "forecasted_true_demand", "naive_forecast", "rolling_forecast",
        "forecast_error", "absolute_error", "model_name",
        "readiness_score", "recommendation_class",
    ]
    # keep only columns that exist
    output_cols = [c for c in output_cols if c in results.columns]
    results_out = results[output_cols].copy()
    results_out = results_out.round(4)

    # ── save outputs ───────────────────────────────────────────────────────
    out_dir = get_path("outputs")
    out_dir.mkdir(parents=True, exist_ok=True)

    results_out.to_csv(out_dir / "forecast_results.csv", index=False)
    log.info("Saved forecast_results.csv (%d rows)", len(results_out))

    # dashboard sample (capped for GitHub Pages)
    sample = results_out.sample(min(SAMPLE_ROWS, len(results_out)), random_state=42)
    sample.to_csv(out_dir / "forecast_results_sample.csv", index=False)
    log.info("Saved forecast_results_sample.csv (%d rows)", len(sample))

    with open(out_dir / "forecast_metrics.json", "w") as f:
        json.dump(metrics, f, indent=2)
    log.info("Saved forecast_metrics.json")

    return results_out, metrics


if __name__ == "__main__":
    run()
