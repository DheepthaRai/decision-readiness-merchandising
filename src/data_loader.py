"""
Load FreshRetailNet-50K from Hugging Face, profile the schema, and save raw extract.

Usage:
    python -m src.data_loader
"""
import pandas as pd
import numpy as np
from pathlib import Path
from src.utils import load_config, get_path, get_logger

log = get_logger(__name__)


def load_dataset(split: str | None = None) -> pd.DataFrame:
    cfg = load_config()
    repo_id = cfg["dataset"]["repo_id"]
    split = split or cfg["dataset"]["split"]
    cache_dir = get_path(cfg["dataset"]["cache_dir"])
    cache_dir.mkdir(parents=True, exist_ok=True)

    log.info("Loading %s split='%s' from Hugging Face …", repo_id, split)
    from datasets import load_dataset as hf_load
    ds = hf_load(repo_id, split=split, cache_dir=str(cache_dir))
    df = ds.to_pandas()
    log.info("Loaded %d rows × %d columns", len(df), len(df.columns))
    return df


def profile_schema(df: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for col in df.columns:
        series = df[col]
        missing_pct = series.isna().mean() * 100

        # sequence columns: sample the first non-null element
        sample = series.dropna().iloc[0] if series.notna().any() else None
        if isinstance(sample, (list, np.ndarray)):
            dtype_str = f"list[{type(sample[0]).__name__}] len={len(sample)}"
            unique_count = "N/A"
            sample_val = str(sample[:4]) + "…"
        else:
            dtype_str = str(series.dtype)
            unique_count = series.nunique()
            sample_val = str(series.dropna().iloc[:3].tolist()) if series.notna().any() else "—"

        rows.append(
            {
                "column": col,
                "dtype": dtype_str,
                "missing_pct": round(missing_pct, 2),
                "unique_count": unique_count,
                "sample_values": sample_val,
            }
        )
    return pd.DataFrame(rows)


def run():
    cfg = load_config()
    df = load_dataset()

    # ── schema profile ──────────────────────────────────────────────────────
    profile = profile_schema(df)
    out_dir = get_path("outputs")
    out_dir.mkdir(parents=True, exist_ok=True)
    profile_path = out_dir / "schema_profile.csv"
    profile.to_csv(profile_path, index=False)
    log.info("Schema profile saved → %s", profile_path)
    print("\n" + profile.to_string(index=False))

    # ── raw parquet extract ─────────────────────────────────────────────────
    raw_dir = get_path("data", "raw")
    raw_dir.mkdir(parents=True, exist_ok=True)
    raw_path = raw_dir / "freshretailnet_raw.parquet"
    df.to_parquet(raw_path, index=False)
    log.info("Raw data saved → %s  (%d rows)", raw_path, len(df))

    return df


if __name__ == "__main__":
    run()
