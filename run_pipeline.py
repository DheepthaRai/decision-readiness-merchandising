"""
End-to-end pipeline runner.

Usage:
    python run_pipeline.py              # train split (~4.5M rows)
    python run_pipeline.py --split eval # eval split (~350K rows, faster)
    python run_pipeline.py --split eval --copy-to-frontend
"""
import argparse
import shutil
import sys
from pathlib import Path

# Make src importable when run from project root
sys.path.insert(0, str(Path(__file__).parent))

from src.utils import get_logger, get_path

log = get_logger("pipeline")


def copy_to_frontend():
    dest = get_path("frontend", "public", "data")
    dest.mkdir(parents=True, exist_ok=True)
    src_dir = get_path("outputs")
    copied = 0
    for csv in src_dir.glob("*.csv"):
        shutil.copy(csv, dest / csv.name)
        log.info("Copied %s → frontend/public/data/", csv.name)
        copied += 1
    log.info("Copied %d CSV(s) to frontend/public/data/", copied)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--split", default=None, help="Dataset split override (train / eval)")
    parser.add_argument("--skip-load", action="store_true", help="Skip data loading (use existing raw)")
    parser.add_argument("--copy-to-frontend", action="store_true",
                        help="Copy outputs/*.csv → frontend/public/data/ after pipeline")
    args = parser.parse_args()

    # ── 1. Load ──────────────────────────────────────────────────────────────
    if not args.skip_load:
        log.info("=== Step 1/6: Data Loading ===")
        from src import data_loader
        if args.split:
            raw_df = data_loader.load_dataset(split=args.split)
            # save raw
            from src.utils import get_path
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

    log.info("Pipeline complete. %d recommendations written.", len(recs))

    if args.copy_to_frontend:
        copy_to_frontend()

    log.info("Next step: cd frontend && npm run dev")


if __name__ == "__main__":
    main()
