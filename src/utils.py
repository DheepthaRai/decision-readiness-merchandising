"""Shared utilities: config loading, path helpers, logging."""
import yaml
import logging
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]


def load_config() -> dict:
    with open(PROJECT_ROOT / "config.yaml") as f:
        return yaml.safe_load(f)


def get_path(*parts: str) -> Path:
    return PROJECT_ROOT.joinpath(*parts)


def get_logger(name: str) -> logging.Logger:
    logging.basicConfig(
        format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
        datefmt="%H:%M:%S",
        level=logging.INFO,
    )
    return logging.getLogger(name)
