"""Tests for grant source parsers with mocked HTTP responses."""

import json
import pytest
import sqlite3
from unittest.mock import AsyncMock, MagicMock

from src.sources.grants_gov import GrantsGovSource
from src.sources.sam_gov import SamGovSource
from src.sources.usaspending import USASpendingSource
from src.sources.worldbank import WorldBankSource
from src.sources.iati import IATISource
from src.sources.base import GrantRecord


class MockHttpClient:
    """Mock CachedHttpClient that returns preset responses."""

    def __init__(self, responses=None):
        self.responses = responses or {}
        self.calls = []

    async def get(self, source, url, params=None, ttl_hours=6, daily_budget=None):
        self.calls.append(("GET", source, url, params))
        return self.responses.get(url)

    async def post(self, source, url, json_body=None, ttl_hours=6, daily_budget=None):
        self.calls.append(("POST", source, url, json_body))
        return self.responses.get(url)


class TestGrantsGov:
    @pytest.mark.asyncio
    async def test_parse_results(self, db, config):
        mock_response = {
            "oppHits": [
                {
                    "id": "12345",
                    "title": "Women Education Grant",
                    "synopsis": "Supporting women's education in developing nations",
                    "agencyName": "USAID",
                    "awardFloor": "10000",
                    "awardCeiling": "100000",
                    "oppStatus": "posted",
                    "openDate": "2026-01-01",
                    "closeDate": "2026-06-15",
                    "fundingCategories": "ED,HL",
                },
            ],
        }
        http = MockHttpClient({"https://api.grants.gov/v1/api/search2": mock_response})
        source = GrantsGovSource(http, db, config)
        records = await source.fetch_grants(["education"])

        assert len(records) == 1
        assert records[0].source == "grants_gov"
        assert records[0].source_id == "12345"
        assert records[0].title == "Women Education Grant"
        assert records[0].amount_floor == 10000
        assert records[0].amount_ceiling == 100000
        assert "education" in records[0].sectors

    @pytest.mark.asyncio
    async def test_deduplicates(self, db, config):
        mock_response = {
            "oppHits": [
                {"id": "1", "title": "Grant A"},
                {"id": "1", "title": "Grant A duplicate"},
            ],
        }
        http = MockHttpClient({"https://api.grants.gov/v1/api/search2": mock_response})
        source = GrantsGovSource(http, db, config)
        records = await source.fetch_grants(["test"])
        assert len(records) == 1


class TestWorldBank:
    @pytest.mark.asyncio
    async def test_parse_results(self, db, config):
        mock_response = {
            "projects": {
                "P12345": {
                    "id": "P12345",
                    "project_name": "Kenya Education Support",
                    "project_abstract": "Supporting education in Kenya",
                    "countryshortname": "Kenya",
                    "totalamt": "5000000",
                    "status": "Active",
                    "boardapprovaldate": "2025-01-15",
                    "closingdate": "2027-12-31",
                    "regionname": "Africa",
                    "sector1": "Education",
                },
                "total": 1,
            },
        }
        http = MockHttpClient({"https://search.worldbank.org/api/v2/projects": mock_response})
        source = WorldBankSource(http, db, config)
        records = await source.fetch_grants(["education Kenya"])

        assert len(records) == 1
        assert records[0].source == "worldbank"
        assert records[0].title == "Kenya Education Support"
        assert records[0].agency == "World Bank"


class TestUSASpending:
    @pytest.mark.asyncio
    async def test_parse_results(self, db, config):
        mock_response = {
            "results": [
                {
                    "generated_internal_id": "AWARD-123",
                    "Recipient Name": "Kenya Aid Foundation",
                    "Award Amount": 75000,
                    "Awarding Agency": "USAID",
                    "Start Date": "2025-10-01",
                    "End Date": "2026-09-30",
                    "Description": "Community development in East Africa",
                },
            ],
        }
        http = MockHttpClient({"https://api.usaspending.gov/api/v2/search/spending_by_award/": mock_response})
        source = USASpendingSource(http, db, config)
        records = await source.fetch_grants(["Kenya"])

        assert len(records) == 1
        assert records[0].amount_floor == 75000


class TestGrantRecordUpsert:
    def test_insert_and_update(self, db):
        """GrantRecord.upsert should insert new and update existing."""
        record = GrantRecord(
            source="test", source_id="U1",
            title="Original Title", description="Desc",
        )
        record.upsert(db)
        db.commit()

        row = db.execute("SELECT title FROM grants WHERE source_id = 'U1'").fetchone()
        assert row["title"] == "Original Title"

        record.title = "Updated Title"
        record.upsert(db)
        db.commit()

        row = db.execute("SELECT title FROM grants WHERE source_id = 'U1'").fetchone()
        assert row["title"] == "Updated Title"

        # Should still be only 1 row
        count = db.execute("SELECT COUNT(*) FROM grants WHERE source_id = 'U1'").fetchone()[0]
        assert count == 1
