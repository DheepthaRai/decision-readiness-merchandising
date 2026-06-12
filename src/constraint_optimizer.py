"""
V2 — src/constraint_optimizer.py
==================================
Simulate a constrained merchandising decision.

Business question:
  If a retailer has limited budget or shelf space, which SKU-store
  recommendations should be prioritized?

This is a SIMULATED optimizer using transparent proxy assumptions.
The dataset has no real costs, margins, shelf capacity, lead times,
service-level targets, or spoilage records.

Priority value formula:
  priority_value = forecasted_true_demand
                   × readiness_multiplier[recommendation_class]
                   × risk_adjustment

  risk_adjustment = 1
                    − 0.25 × normalized_stockout_rate
                    − 0.20 × normalized_promo_dependency
                    − 0.20 × normalized_volatility
  Clipped to [0.10, 1.00].

  Note: promo_independence_score and low_volatility_score in the CSV are
  INVERTED signals (higher = less risky). We normalize their inverse here
  to get dependency/volatility risk fractions.

Readiness multipliers:
  Ready to Execute: 1.00
  Localize:         0.90
  Merchant Review:  0.60
  Escalate:         0.30

Optimizer:
  Greedy sort by priority_value_per_unit (= priority_value / recommended_stock_qty),
  then select rows until any constraint is reached.

Constraints supported:
  max_total_units   — cap total units selected
  max_total_budget  — cap units × unit_cost_proxy
  max_skus_per_store — cap how many SKUs per store are selected
  city_filter       — list of city names to include (None = all)
  class_filter      — list of recommendation classes to include (None = all)

Outputs:
  outputs/constrained_recommendations.csv
  outputs/constraint_summary.json
"""

from __future__ import annotations

import json
import numpy as np
import pandas as pd
from src.utils import get_path, get_logger, load_config

log = get_logger(__name__)

CLASS_READY    = "Ready to Execute"
CLASS_LOCALIZE = "Localize"
CLASS_REVIEW   = "Merchant Review"
CLASS_ESCALATE = "Escalate"

READINESS_MULTIPLIER = {
    CLASS_READY:    1.00,
    CLASS_LOCALIZE: 0.90,
    CLASS_REVIEW:   0.60,
    CLASS_ESCALATE: 0.30,
}


# ── risk adjustment ───────────────────────────────────────────────────────────

def _risk_adjustment(df: pd.DataFrame) -> pd.Series:
    """
    risk_adjustment = 1 - 0.25*stockout_norm - 0.20*promo_dep_norm - 0.20*vol_norm
    Clipped to [0.10, 1.00].

    stockout_rate:           already 0-1 (higher = worse)
    promo_independence_score: 0-100 (higher = less dependent) → invert & normalize
    low_volatility_score:    0-100 (higher = less volatile)   → invert & normalize
    """
    # Normalize stockout_rate (already 0-1)
    stockout_norm = df.get("stockout_rate", pd.Series(0, index=df.index)).clip(0, 1).fillna(0)

    # Promo dependency: invert promo_independence_score (0-100 → 0-1 dependency)
    if "promo_independence_score" in df.columns:
        promo_dep_norm = (1 - df["promo_independence_score"] / 100).clip(0, 1).fillna(0)
        promo_components = 0.20
    else:
        promo_dep_norm = pd.Series(0, index=df.index)
        promo_components = 0.0
        log.debug("promo_independence_score missing — skipping promo component")

    # Volatility risk: invert low_volatility_score (0-100 → 0-1 risk)
    if "low_volatility_score" in df.columns:
        vol_norm = (1 - df["low_volatility_score"] / 100).clip(0, 1).fillna(0)
        vol_components = 0.20
    else:
        vol_norm = pd.Series(0, index=df.index)
        vol_components = 0.0
        log.debug("low_volatility_score missing — skipping volatility component")

    risk_adj = (
        1.0
        - 0.25 * stockout_norm
        - promo_components * promo_dep_norm
        - vol_components * vol_norm
    ).clip(0.10, 1.00)

    return risk_adj


# ── priority value ─────────────────────────────────────────────────────────────

def compute_priority(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()

    multiplier  = df["recommendation_class"].map(READINESS_MULTIPLIER).fillna(0.5)
    risk_adj    = _risk_adjustment(df)

    df["risk_adjustment"] = risk_adj.round(4)
    df["priority_value"]  = (
        df["forecasted_true_demand"] * multiplier * risk_adj
    ).clip(lower=0).round(4)

    # Avoid divide-by-zero on recommended_stock_qty
    qty = df["recommended_stock_qty"].replace(0, np.nan).fillna(1)
    df["priority_value_per_unit"] = (df["priority_value"] / qty).round(6)

    return df


# ── greedy optimizer ──────────────────────────────────────────────────────────

def greedy_optimize(
    df: pd.DataFrame,
    max_total_units:   int | None = None,
    max_total_budget:  float | None = None,
    max_skus_per_store: int | None = None,
    city_filter:       list[str] | None = None,
    class_filter:      list[str] | None = None,
    unit_cost_proxy:   float = 1.0,
) -> pd.DataFrame:
    """
    Greedy selection by priority_value_per_unit (descending).
    Returns df with added columns: selected_under_constraint, constraint_reason.
    """
    df = df.copy()
    df["selected_under_constraint"] = False
    df["constraint_reason"] = ""

    # Apply filters
    mask = pd.Series(True, index=df.index)
    if city_filter:
        mask &= df["city"].isin(city_filter)
    if class_filter:
        mask &= df["recommendation_class"].isin(class_filter)

    candidates = df[mask].sort_values("priority_value_per_unit", ascending=False)
    excluded   = df[~mask].copy()
    excluded["constraint_reason"] = "filtered_out"

    units_used    = 0
    budget_used   = 0.0
    skus_per_store: dict[str, int] = {}

    for idx in candidates.index:
        row = candidates.loc[idx]
        qty  = int(row.get("recommended_stock_qty", 1) or 1)
        cost = qty * unit_cost_proxy

        # Check constraints
        if max_total_units is not None and units_used + qty > max_total_units:
            df.at[idx, "constraint_reason"] = "max_total_units_exceeded"
            continue
        if max_total_budget is not None and budget_used + cost > max_total_budget:
            df.at[idx, "constraint_reason"] = "max_total_budget_exceeded"
            continue
        store_key = str(row.get("store_id", ""))
        if max_skus_per_store is not None:
            if skus_per_store.get(store_key, 0) >= max_skus_per_store:
                df.at[idx, "constraint_reason"] = "max_skus_per_store_exceeded"
                continue

        # Select
        df.at[idx, "selected_under_constraint"] = True
        df.at[idx, "constraint_reason"] = "selected"
        units_used   += qty
        budget_used  += cost
        skus_per_store[store_key] = skus_per_store.get(store_key, 0) + 1

    log.info(
        "Greedy optimizer: %d / %d selected | units=%d | budget=%.2f",
        df["selected_under_constraint"].sum(), len(candidates),
        units_used, budget_used,
    )
    return df, units_used, budget_used


# ── summary ───────────────────────────────────────────────────────────────────

def build_summary(df: pd.DataFrame, total_units: int, total_budget: float) -> dict:
    sel  = df[df["selected_under_constraint"]]
    unsel = df[~df["selected_under_constraint"]]

    class_counts = sel["recommendation_class"].value_counts().to_dict()
    return {
        "total_candidates":         int(len(df)),
        "selected_count":           int(len(sel)),
        "total_recommended_units":  int(total_units),
        "total_budget_used":        round(total_budget, 2),
        "estimated_demand_covered": round(float(sel["forecasted_true_demand"].sum()), 2),
        "ready_selected_count":     int(class_counts.get(CLASS_READY,    0)),
        "localize_selected_count":  int(class_counts.get(CLASS_LOCALIZE, 0)),
        "review_selected_count":    int(class_counts.get(CLASS_REVIEW,   0)),
        "escalate_selected_count":  int(class_counts.get(CLASS_ESCALATE, 0)),
        "optimizer": "greedy_priority_per_unit",
        "note": (
            "Simulated optimizer using proxy cost and shelf-space assumptions. "
            "unit_cost_proxy and shelf_space_units_proxy are configurable in config.yaml. "
            "Do not use for production procurement decisions."
        ),
    }


# ── main ─────────────────────────────────────────────────────────────────────

def run(
    inventory_df: pd.DataFrame | None = None,
    max_total_units:    int | None = None,
    max_total_budget:   float | None = None,
    max_skus_per_store: int | None = None,
    city_filter:        list[str] | None = None,
    class_filter:       list[str] | None = None,
) -> tuple[pd.DataFrame, dict]:
    cfg = load_config()
    inv = cfg.get("inventory", {})
    unit_cost_proxy = float(inv.get("unit_cost_proxy", 1.0))

    # ── load inventory recommendations ─────────────────────────────────────
    if inventory_df is None:
        path = get_path("outputs", "inventory_recommendations.csv")
        if not path.exists():
            raise FileNotFoundError(
                "inventory_recommendations.csv not found. "
                "Run inventory step first: python run_pipeline.py --split eval --forecast --recommend-inventory"
            )
        inventory_df = pd.read_csv(path)

    log.info("Running constraint optimizer on %d rows", len(inventory_df))

    # ── add columns from recs CSV if missing ──────────────────────────────
    needed = ["stockout_rate", "promo_independence_score", "low_volatility_score"]
    missing = [c for c in needed if c not in inventory_df.columns]
    if missing:
        recs_path = get_path("outputs", "product_store_recommendations.csv")
        if recs_path.exists():
            recs_extra = pd.read_csv(recs_path, usecols=["sku_id", "store_id", "week_label"] + missing)
            inventory_df = inventory_df.merge(recs_extra, on=["sku_id", "store_id", "week_label"], how="left")
            log.info("Joined risk columns from product_store_recommendations.csv")

    # ── compute priority value ─────────────────────────────────────────────
    df = compute_priority(inventory_df)

    # ── run greedy optimizer ───────────────────────────────────────────────
    df, total_units, total_budget = greedy_optimize(
        df,
        max_total_units    = max_total_units,
        max_total_budget   = max_total_budget,
        max_skus_per_store = max_skus_per_store,
        city_filter        = city_filter,
        class_filter       = class_filter,
        unit_cost_proxy    = unit_cost_proxy,
    )

    # ── estimated value ────────────────────────────────────────────────────
    avg_unit_val = float(cfg.get("business", {}).get("avg_unit_value", 3.5))
    df["estimated_value"] = (df["forecasted_true_demand"] * avg_unit_val).round(2)

    # ── build output ───────────────────────────────────────────────────────
    output_cols = [
        "sku_id", "store_id", "city", "week_label",
        "forecasted_true_demand", "recommended_stock_qty",
        "estimated_value",
        "priority_value", "priority_value_per_unit",
        "selected_under_constraint", "constraint_reason",
        "readiness_score", "recommendation_class",
        "inventory_action",
    ]
    output_cols = [c for c in output_cols if c in df.columns]
    out = df[output_cols].round({"priority_value": 4, "priority_value_per_unit": 6, "estimated_value": 2})

    out_dir = get_path("outputs")
    out_dir.mkdir(parents=True, exist_ok=True)

    out.to_csv(out_dir / "constrained_recommendations.csv", index=False)
    log.info("Saved constrained_recommendations.csv (%d rows)", len(out))

    summary = build_summary(df, total_units, total_budget)
    with open(out_dir / "constraint_summary.json", "w") as f:
        json.dump(summary, f, indent=2)
    log.info(
        "Saved constraint_summary.json — %d selected / %d total",
        summary["selected_count"], summary["total_candidates"],
    )

    return out, summary


if __name__ == "__main__":
    run()
