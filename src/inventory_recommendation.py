"""
V2 — src/inventory_recommendation.py
======================================
Convert forecasted true demand into suggested inventory quantities
and stocking priority actions.

This is a PROTOTYPE, not a production-grade inventory optimizer.
The dataset has no real inventory costs, shelf capacity, lead times,
service-level targets, or spoilage records. All parameters are
transparent proxies configurable in config.yaml under `inventory:`.

Assumptions used (all configurable):
  service_level_z:      1.28   → ~90th percentile service level (Normal dist)
  minimum_stock_qty:    1      → always stock at least 1 unit if selected
  safety_stock_method:  forecast_error_std → σ of per-SKU-store forecast errors
  high_demand_percentile: 70   → top 30% of forecasted demand = "high demand"

Safety stock fallback hierarchy:
  1. SKU-store historical forecast error std
  2. City-level forecast error std
  3. Global forecast error std
  4. Global demand std (last resort)

Inventory action logic (priority order — first match wins):
  Stock / Prioritize         if high forecasted demand AND Ready to Execute
  Localize Stocking          if Localize class
  Review Before Stocking     if Merchant Review class
  Investigate Before Stocking if Escalate class
  Low Priority               otherwise

Output:
  outputs/inventory_recommendations.csv
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from src.utils import get_path, get_logger, load_config

log = get_logger(__name__)

CLASS_READY    = "Ready to Execute"
CLASS_LOCALIZE = "Localize"
CLASS_REVIEW   = "Merchant Review"
CLASS_ESCALATE = "Escalate"


# ── safety stock ─────────────────────────────────────────────────────────────

def _compute_safety_stock(
    df: pd.DataFrame,
    z: float,
    method: str = "forecast_error_std",
) -> pd.Series:
    """
    Compute safety stock = z * σ_error per SKU-store, with fallback hierarchy.

    If forecast_results are available, we use the forecast_error column.
    Otherwise we fall back to historical demand std.
    """
    if method == "forecast_error_std" and "absolute_error" in df.columns:
        # Use per-SKU-store forecast error std
        ss = (
            df.groupby(["sku_id", "store_id"])["absolute_error"]
            .transform("std")
            .fillna(np.nan)
        )
        # Fallback 1: city-level error std
        city_std = (
            df.groupby("city")["absolute_error"]
            .transform("std")
            .fillna(np.nan)
        )
        # Fallback 2: global error std
        global_std = df["absolute_error"].std()
        if np.isnan(global_std):
            global_std = df["forecasted_true_demand"].std()

        ss = ss.fillna(city_std).fillna(global_std).fillna(0)
        log.info(
            "Safety stock: using forecast_error_std method. "
            "SKU-store coverage: %.1f%%",
            100 * ss.notna().mean(),
        )
    else:
        # Fallback: use demand std as proxy
        demand_std = df.groupby(["sku_id", "store_id"])["forecasted_true_demand"].transform("std")
        global_std = df["forecasted_true_demand"].std()
        ss = demand_std.fillna(global_std).fillna(0)
        log.info("Safety stock: using demand std fallback (no forecast error available)")

    return (z * ss).clip(lower=0)


# ── inventory action ─────────────────────────────────────────────────────────

def _assign_inventory_action(
    row: pd.Series,
    high_demand_threshold: float,
) -> str:
    cls   = row.get("recommendation_class", "")
    fcast = row.get("forecasted_true_demand", 0) or 0

    if cls == CLASS_ESCALATE:
        return "Investigate Before Stocking"
    if cls == CLASS_LOCALIZE:
        return "Localize Stocking"
    if cls == CLASS_REVIEW:
        return "Review Before Stocking"
    if cls == CLASS_READY and fcast >= high_demand_threshold:
        return "Stock / Prioritize"
    return "Low Priority"


# ── priority score ────────────────────────────────────────────────────────────

READINESS_MULTIPLIER = {
    CLASS_READY:    1.00,
    CLASS_LOCALIZE: 0.90,
    CLASS_REVIEW:   0.60,
    CLASS_ESCALATE: 0.30,
}


def _priority_score(df: pd.DataFrame) -> pd.Series:
    """
    stock_priority_score = forecasted_true_demand × readiness_multiplier
    Gives a simple ranking signal for downstream constraint optimization.
    """
    multiplier = df["recommendation_class"].map(READINESS_MULTIPLIER).fillna(0.5)
    return (df["forecasted_true_demand"] * multiplier).round(4)


# ── main ─────────────────────────────────────────────────────────────────────

def run(
    forecast_df: pd.DataFrame | None = None,
) -> pd.DataFrame:
    cfg = load_config()
    inv = cfg.get("inventory", {})

    z            = float(inv.get("service_level_z", 1.28))
    min_qty      = int(inv.get("minimum_stock_qty", 1))
    max_qty      = inv.get("max_stock_qty", None)
    method       = inv.get("safety_stock_method", "forecast_error_std")
    high_pct     = float(inv.get("high_demand_percentile", 70))

    # ── load forecast results ──────────────────────────────────────────────
    if forecast_df is None:
        path = get_path("outputs", "forecast_results.csv")
        if not path.exists():
            raise FileNotFoundError(
                "forecast_results.csv not found. Run forecasting first: "
                "python run_pipeline.py --split eval --forecast"
            )
        forecast_df = pd.read_csv(path)
    log.info("Building inventory recommendations for %d rows", len(forecast_df))

    df = forecast_df.copy()

    # ── ensure required columns ────────────────────────────────────────────
    for col in ["forecasted_true_demand", "recommendation_class", "readiness_score"]:
        if col not in df.columns:
            log.warning("Column %s missing — filling with 0/unknown", col)
            df[col] = 0 if col != "recommendation_class" else "Merchant Review"

    df["forecasted_true_demand"] = df["forecasted_true_demand"].clip(lower=0).fillna(0)

    # ── safety stock ───────────────────────────────────────────────────────
    df["safety_stock"] = _compute_safety_stock(df, z, method)

    # ── recommended stock quantity ─────────────────────────────────────────
    raw_qty = df["forecasted_true_demand"] + df["safety_stock"]
    df["recommended_stock_qty"] = np.ceil(raw_qty).clip(lower=min_qty)
    if max_qty is not None:
        df["recommended_stock_qty"] = df["recommended_stock_qty"].clip(upper=max_qty)
    df["recommended_stock_qty"] = df["recommended_stock_qty"].astype(int)

    # ── high-demand threshold ──────────────────────────────────────────────
    high_threshold = df["forecasted_true_demand"].quantile(high_pct / 100)
    log.info(
        "High-demand threshold (%.0fth percentile): %.2f units",
        high_pct, high_threshold,
    )

    # ── inventory action ───────────────────────────────────────────────────
    df["inventory_action"] = df.apply(
        _assign_inventory_action, axis=1, high_demand_threshold=high_threshold
    )

    # ── priority score ─────────────────────────────────────────────────────
    df["stock_priority_score"] = _priority_score(df)

    # ── build output ───────────────────────────────────────────────────────
    output_cols = [
        "sku_id", "store_id", "city", "week_label",
        "forecasted_true_demand",
        "recommended_stock_qty",
        "safety_stock",
        "readiness_score",
        "recommendation_class",
        "inventory_action",
        "stock_priority_score",
    ]
    output_cols = [c for c in output_cols if c in df.columns]
    out = df[output_cols].round(4)

    out_path = get_path("outputs", "inventory_recommendations.csv")
    get_path("outputs").mkdir(parents=True, exist_ok=True)
    out.to_csv(out_path, index=False)
    log.info(
        "Saved inventory_recommendations.csv (%d rows). Action distribution:\n%s",
        len(out),
        out["inventory_action"].value_counts().to_string(),
    )
    return out


if __name__ == "__main__":
    run()
