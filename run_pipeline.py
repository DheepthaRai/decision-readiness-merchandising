"""
End-to-end pipeline runner.

Version 1 (default):
    python run_pipeline.py              # train split (~4.5M rows)
    python run_pipeline.py --split eval # eval split (~350K rows, faster)
    python run_pipeline.py --split eval --copy-to-frontend

Version 2 (predictive/prescriptive layer):
    python run_pipeline.py --split eval --forecast
    python run_pipeline.py --split eval --forecast --recommend-inventory
    python run_pipeline.py --split eval --forecast --recommend-inventory --optimize
    python run_pipeline.py --split eval --v2      # shortcut for all V2 steps
    python run_pipeline.py --split eval --all     # V1 + V2 + copy-to-frontend
"""
import argparse
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from src.utils import get_logger, get_path

log = get_logger("pipeline")

DASHBOARD_FILES = [
    # V1
    "product_store_recommendations.csv",
    "schema_profile.csv",
    # V2
    "forecast_results_sample.csv",
    "forecast_metrics.json",
    "inventory_recommendations.csv",
    "constrained_recommendations.csv",
    "constraint_summary.json",
]


def copy_to_frontend():
    dest = get_path("frontend", "public", "data")
    dest.mkdir(parents=True, exist_ok=True)
    src_dir = get_path("outputs")
    copied = 0
    for name in DASHBOARD_FILES:
        src = src_dir / name
        if src.exists():
            shutil.copy(src, dest / name)
            log.info("Copied %s → frontend/public/data/", name)
            copied += 1
        else:
            log.debug("Skipping %s (not yet generated)", name)
    log.info("Copied %d file(s) to frontend/public/data/", copied)


def run_v1(args):
    # ── 1. Load ──────────────────────────────────────────────────────────────
    if not args.skip_load:
        log.info("=== Step 1/6: Data Loading ===")
        from src import data_loader
        if args.split:
            raw_df = data_loader.load_dataset(split=args.split)
            raw_df.to_parquet(get_path("data", "raw", "freshretailnet_raw.parquet"), index=False)
            from src.data_loader import profile_schema
            profile = profile_schema(raw_df)
            profile.to_csv(get_path("outputs", "schema_profile.csv"), index=False)
        else:
            raw_df = data_loader.run()
    else:
        raw_df = None

    # ── 2. Preprocess ────────────────────────────────────────────────────────
    log.info("=== Step 2/6: Preprocessing ===")
    from src import preprocessing
    hourly_df = preprocessing.run(raw_df)

    # ── 3. Feature engineering ───────────────────────────────────────────────
    log.info("=== Step 3/6: Feature Engineering ===")
    from src import feature_engineering
    daily_df, weekly_df = feature_engineering.run(hourly_df)

    # ── 4. Demand recovery ────────────────────────────────────────────────────
    log.info("=== Step 4/6: Demand Recovery ===")
    from src import demand_recovery
    recovery_df = demand_recovery.run(hourly_df)

    # ── 5. Scoring ────────────────────────────────────────────────────────────
    log.info("=== Step 5/6: Readiness Scoring ===")
    from src import readiness_scoring
    scored_df = readiness_scoring.run(weekly_df, recovery_df)

    # ── 6. Classify ───────────────────────────────────────────────────────────
    log.info("=== Step 6/6: Recommendation Classification ===")
    from src import recommendation_rules
    recs = recommendation_rules.run(scored_df)

    log.info("V1 pipeline complete. %d recommendations written.", len(recs))
    return recs


def run_v2(recs_df=None):
    """Run all V2 steps: forecast → inventory → optimize."""
    get_path("outputs").mkdir(parents=True, exist_ok=True)

    # ── V2-1: Forecast ────────────────────────────────────────────────────────
    log.info("=== V2 Step 1/3: Demand Forecasting ===")
    from src import forecasting
    forecast_df, metrics = forecasting.run(recs_df)
    if forecast_df is None or len(forecast_df) == 0:
        log.warning("Forecasting produced no output — skipping inventory and optimizer steps.")
        return

    # ── V2-2: Inventory recommendations ───────────────────────────────────────
    log.info("=== V2 Step 2/3: Inventory Recommendations ===")
    from src import inventory_recommendation
    inventory_df = inventory_recommendation.run(forecast_df)

    # ── V2-3: Constraint optimizer ────────────────────────────────────────────
    log.info("=== V2 Step 3/3: Constraint Optimizer ===")
    from src import constraint_optimizer
    constrained_df, summary = constraint_optimizer.run(inventory_df)

    log.info("V2 pipeline complete.")
    return forecast_df, inventory_df, constrained_df


def main():
    parser = argparse.ArgumentParser(
        description="Decision Readiness Scoring pipeline (V1 + optional V2 predictive layer)"
    )
    parser.add_argument("--split",              default=None,   help="Dataset split: train or eval")
    parser.add_argument("--skip-load",          action="store_true", help="Skip data loading (reuse existing)")
    parser.add_argument("--copy-to-frontend",   action="store_true", help="Copy outputs to frontend/public/data/")

    # V2 flags
    parser.add_argument("--forecast",           action="store_true", help="Run V2 demand forecasting")
    parser.add_argument("--recommend-inventory", action="store_true", help="Run V2 inventory recommendations")
    parser.add_argument("--optimize",           action="store_true", help="Run V2 constraint optimizer")
    parser.add_argument("--v2",                 action="store_true", help="Shortcut: run all V2 steps")
    parser.add_argument("--all",                action="store_true", help="Run V1 + V2 + copy-to-frontend")

    args = parser.parse_args()

    # --all implies everything
    if args.all:
        args.v2 = True
        args.copy_to_frontend = True

    # --v2 implies all V2 steps
    if args.v2:
        args.forecast = True
        args.recommend_inventory = True
        args.optimize = True

    # --optimize implies --recommend-inventory (needs inventory output)
    if args.optimize:
        args.recommend_inventory = True
    # --recommend-inventory implies --forecast (needs forecast output)
    if args.recommend_inventory:
        args.forecast = True

    # Ensure output dirs exist
    get_path("outputs").mkdir(parents=True, exist_ok=True)
    get_path("data", "interim").mkdir(parents=True, exist_ok=True)
    get_path("data", "processed").mkdir(parents=True, exist_ok=True)

    # ── Run V1 ────────────────────────────────────────────────────────────────
    recs_df = run_v1(args)

    # ── Run V2 steps as selected ──────────────────────────────────────────────
    if args.forecast and not args.recommend_inventory and not args.optimize:
        # forecast only
        log.info("=== V2 Step: Demand Forecasting ===")
        from src import forecasting
        forecasting.run(recs_df)

    elif args.forecast and args.recommend_inventory and not args.optimize:
        # forecast + inventory
        log.info("=== V2 Step 1/2: Demand Forecasting ===")
        from src import forecasting
        forecast_df, _ = forecasting.run(recs_df)
        if forecast_df is not None and len(forecast_df) > 0:
            log.info("=== V2 Step 2/2: Inventory Recommendations ===")
            from src import inventory_recommendation
            inventory_recommendation.run(forecast_df)

    elif args.optimize:
        # all three
        run_v2(recs_df)

    if args.copy_to_frontend:
        copy_to_frontend()

    log.info("Pipeline done. Next step: cd frontend && npm run dev")


if __name__ == "__main__":
    main()
