"""Tests for the 5-signal relevance scoring model."""

import json
import pytest

from src.scoring.relevance import (
    _jaccard, _sector_score, _geographic_score, _amount_score,
    _deadline_score, _source_reliability_score, score_grant, score_all_grants,
)


class TestJaccard:
    def test_identical_sets(self):
        assert _jaccard({"a", "b"}, {"a", "b"}) == 1.0

    def test_disjoint_sets(self):
        assert _jaccard({"a"}, {"b"}) == 0.0

    def test_partial_overlap(self):
        assert _jaccard({"a", "b", "c"}, {"b", "c", "d"}) == pytest.approx(0.5)

    def test_empty_sets(self):
        assert _jaccard(set(), set()) == 0.0
        assert _jaccard({"a"}, set()) == 0.0


class TestSectorScore:
    def test_matching_sectors(self):
        score = _sector_score(["education", "health"], ["education", "health", "nutrition"])
        assert score > 0.5

    def test_no_overlap(self):
        assert _sector_score(["agriculture"], ["education", "health"]) == 0.0

    def test_case_insensitive(self):
        assert _sector_score(["Education"], ["education"]) == 1.0


class TestGeographicScore:
    def test_country_match(self):
        assert _geographic_score(["KE"], [], ["KE", "US"], []) == 1.0

    def test_region_match(self):
        assert _geographic_score([], ["East Africa"], [], ["East Africa"]) == 0.6

    def test_global_program(self):
        assert _geographic_score([], [], ["KE"], []) == 0.3

    def test_mismatch(self):
        assert _geographic_score(["BR"], ["South America"], ["KE"], ["East Africa"]) == 0.0


class TestAmountScore:
    def test_perfect_fit(self):
        # Grant $10k-$100k, org seeks $5k-$250k
        score = _amount_score(10000, 100000, 5000, 250000)
        assert score > 0.3

    def test_no_overlap(self):
        # Grant $1M-$5M, org seeks $5k-$250k
        assert _amount_score(1000000, 5000000, 5000, 250000) == 0.0

    def test_unknown_amount(self):
        assert _amount_score(None, None, 5000, 250000) == 0.5


class TestDeadlineScore:
    def test_empty_deadline(self):
        assert _deadline_score("") == 0.4

    def test_invalid_format(self):
        assert _deadline_score("not-a-date") == 0.4


class TestSourceReliability:
    def test_known_sources(self):
        assert _source_reliability_score("grants_gov") == 1.0
        assert _source_reliability_score("iati") == 0.7

    def test_unknown_source(self):
        assert _source_reliability_score("unknown") == 0.5


class TestScoreGrant:
    def test_high_relevance(self):
        grant = {
            "sectors_json": json.dumps(["education", "women", "empowerment"]),
            "countries_json": json.dumps(["KE"]),
            "regions_json": json.dumps(["East Africa"]),
            "amount_floor": 10000,
            "amount_ceiling": 100000,
            "close_date": "",
            "source": "grants_gov",
        }
        org = {
            "sectors_json": json.dumps(["education", "women", "empowerment", "health"]),
            "countries_json": json.dumps(["KE", "US"]),
            "regions": ["East Africa"],
            "grant_range_min": 5000,
            "grant_range_max": 250000,
        }
        weights = {
            "sector_match": 0.30,
            "geographic_match": 0.25,
            "amount_fit": 0.20,
            "deadline_proximity": 0.15,
            "source_reliability": 0.10,
        }
        score, tier = score_grant(grant, org, weights)
        assert score > 0.5
        assert tier in ("HIGH", "MEDIUM")

    def test_irrelevant_grant(self):
        grant = {
            "sectors_json": json.dumps(["agriculture", "fisheries"]),
            "countries_json": json.dumps(["BR"]),
            "regions_json": json.dumps(["South America"]),
            "amount_floor": 5000000,
            "amount_ceiling": 10000000,
            "close_date": "2020-01-01",
            "source": "iati",
        }
        org = {
            "sectors_json": json.dumps(["education", "women"]),
            "countries_json": json.dumps(["KE"]),
            "regions": ["East Africa"],
            "grant_range_min": 5000,
            "grant_range_max": 250000,
        }
        weights = {
            "sector_match": 0.30,
            "geographic_match": 0.25,
            "amount_fit": 0.20,
            "deadline_proximity": 0.15,
            "source_reliability": 0.10,
        }
        score, tier = score_grant(grant, org, weights)
        assert score < 0.3
        assert tier in ("LOW", "IRRELEVANT")


class TestScoreAllGrants:
    def test_scores_all(self, db_with_grants, config):
        """score_all_grants should update all grants with scores and tiers."""
        score_all_grants(db_with_grants, config)

        rows = db_with_grants.execute(
            "SELECT relevance_score, relevance_tier FROM grants"
        ).fetchall()
        for row in rows:
            assert row["relevance_score"] > 0
            assert row["relevance_tier"] in ("HIGH", "MEDIUM", "LOW", "IRRELEVANT")
