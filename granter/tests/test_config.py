"""Tests for config loader and validation."""

import pytest
from src.common.config import load_config, _validate, _deep_merge


class TestConfigValidation:
    def test_scoring_weights_must_sum_to_one(self):
        config = {
            "org_profile": {"grant_range_min": 5000, "grant_range_max": 250000},
            "scoring": {"a": 0.5, "b": 0.3},
            "sources": {},
        }
        with pytest.raises(ValueError, match="sum to 1.0"):
            _validate(config)

    def test_scoring_weights_valid(self):
        config = {
            "org_profile": {"grant_range_min": 5000, "grant_range_max": 250000},
            "scoring": {
                "sector_match": 0.30,
                "geographic_match": 0.25,
                "amount_fit": 0.20,
                "deadline_proximity": 0.15,
                "source_reliability": 0.10,
            },
            "sources": {},
        }
        _validate(config)  # Should not raise

    def test_grant_range_min_exceeds_max_raises(self):
        config = {
            "org_profile": {"grant_range_min": 500000, "grant_range_max": 100},
            "scoring": {"a": 1.0},
            "sources": {},
        }
        with pytest.raises(ValueError, match="grant_range_min"):
            _validate(config)

    def test_negative_daily_budget_raises(self):
        config = {
            "org_profile": {"grant_range_min": 5000, "grant_range_max": 250000},
            "scoring": {"a": 1.0},
            "sources": {"test_source": {"daily_budget": 0}},
        }
        with pytest.raises(ValueError, match="daily_budget"):
            _validate(config)


class TestDeepMerge:
    def test_simple_merge(self):
        base = {"a": 1, "b": 2}
        override = {"b": 3, "c": 4}
        result = _deep_merge(base, override)
        assert result == {"a": 1, "b": 3, "c": 4}

    def test_nested_merge(self):
        base = {"x": {"a": 1, "b": 2}}
        override = {"x": {"b": 3}}
        result = _deep_merge(base, override)
        assert result == {"x": {"a": 1, "b": 3}}

    def test_load_defaults(self):
        config = load_config("/nonexistent/path.yaml")
        assert "org_profile" in config
        assert "scoring" in config
        assert "sources" in config
