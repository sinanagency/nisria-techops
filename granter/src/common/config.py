"""YAML config loader with defaults, deep merge, and validation."""

from __future__ import annotations

import os
import logging
from pathlib import Path

import yaml
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

DEFAULT_CONFIG: dict = {
    "org_profile": {
        "name": "Nisria Foundation",
        "mission": "Empowering women, youth, and vulnerable communities in Kenya through education, nutrition, vocational training, and sustainable social enterprise.",
        "ein": "",
        "search_keywords": [
            "women empowerment Kenya",
            "youth vocational training East Africa",
            "nutrition feeding program",
            "orphan care rescue home",
            "community development Kenya",
            "fashion upcycle social enterprise",
        ],
        "sectors": ["education", "health", "nutrition", "women", "empowerment", "youth", "vocational", "community"],
        "countries": ["KE", "US"],
        "regions": ["East Africa", "Sub-Saharan Africa"],
        "grant_range_min": 5000,
        "grant_range_max": 250000,
        "org_type": "Nonprofit",
        "annual_budget": 0,
    },
    "sources": {
        "grants_gov": {"enabled": True, "cache_ttl_hours": 6},
        "sam_gov": {"enabled": True, "api_key": "", "cache_ttl_hours": 48, "daily_budget": 800},
        "usaspending": {"enabled": True, "cache_ttl_hours": 12, "daily_budget": 500},
        "worldbank": {"enabled": True, "cache_ttl_hours": 24},
        "propublica": {"enabled": True, "cache_ttl_hours": 168},
        "iati": {"enabled": True, "cache_ttl_hours": 24, "daily_budget": 200},
    },
    "scoring": {
        "sector_match": 0.30,
        "geographic_match": 0.25,
        "amount_fit": 0.20,
        "deadline_proximity": 0.15,
        "source_reliability": 0.10,
    },
    "server": {
        "host": "0.0.0.0",
        "port": 8000,
    },
}


def _deep_merge(base: dict, override: dict) -> dict:
    """Recursively merge override into base, returning a new dict."""
    result = base.copy()
    for key, value in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def _validate(config: dict) -> None:
    """Validate config values, raise ValueError on problems."""
    # Scoring weights must sum to 1.0
    scoring = config.get("scoring", {})
    if scoring:
        total = sum(scoring.values())
        if abs(total - 1.0) > 0.01:
            raise ValueError(f"Scoring weights must sum to 1.0, got {total:.4f}")

    # Grant range
    org = config.get("org_profile", {})
    if org.get("grant_range_min", 0) > org.get("grant_range_max", float("inf")):
        raise ValueError("grant_range_min cannot exceed grant_range_max")

    # Source daily budgets must be positive if set
    for source_name, source_cfg in config.get("sources", {}).items():
        if isinstance(source_cfg, dict):
            budget = source_cfg.get("daily_budget")
            if budget is not None and budget <= 0:
                raise ValueError(f"daily_budget for {source_name} must be positive, got {budget}")


def load_config(path: str | None = None) -> dict:
    """Load config from YAML file, merge with defaults, validate."""
    if path is None:
        path = os.environ.get("CONFIG_PATH", "config/config.yaml")

    config = DEFAULT_CONFIG.copy()

    config_path = Path(path)
    if config_path.exists():
        try:
            with open(config_path) as f:
                user_config = yaml.safe_load(f) or {}
            config = _deep_merge(DEFAULT_CONFIG, user_config)
            logger.info(f"Loaded config from {config_path}")
        except Exception as exc:
            logger.warning(f"Failed to load config from {config_path}: {exc}, using defaults")
    else:
        logger.info(f"No config file at {config_path}, using defaults")

    _validate(config)
    return config
