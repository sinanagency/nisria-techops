"""ProPublica Nonprofit Explorer — Funder research from IRS 990 data. No auth required.

Search orgs: GET https://projects.propublica.org/nonprofits/api/v2/search.json?q={keyword}
Org detail:  GET https://projects.propublica.org/nonprofits/api/v2/organizations/{ein}.json

This source populates the funders table, NOT the grants table.
It's used for funder research and cold outreach targeting.
"""

from __future__ import annotations

import json
import logging

from src.sources.base import GrantSource, GrantRecord, FunderRecord

logger = logging.getLogger(__name__)

SEARCH_URL = "https://projects.propublica.org/nonprofits/api/v2/search.json"
ORG_URL = "https://projects.propublica.org/nonprofits/api/v2/organizations/{ein}.json"


class ProPublicaSource(GrantSource):
    SOURCE_NAME = "propublica"

    async def fetch_grants(self, keywords: list[str]) -> list[GrantRecord]:
        """ProPublica returns funders, not grants. We upsert to funders table directly."""
        for keyword in keywords:
            await self._search_funders(keyword)
        return []  # No GrantRecords — funders go to their own table

    async def _search_funders(self, keyword: str) -> list[FunderRecord]:
        data = await self.http.get(
            source=self.SOURCE_NAME,
            url=SEARCH_URL,
            params={"q": keyword},
            ttl_hours=self.cache_ttl,
            daily_budget=self.daily_budget,
        )
        if not data:
            return []

        orgs = data.get("organizations", [])
        records = []
        for org in orgs:
            record = self._parse_funder(org)
            if record:
                record.upsert(self.conn)
                records.append(record)

        self.conn.commit()
        logger.info(f"[propublica] Found {len(records)} funders for '{keyword}'")
        return records

    async def fetch_funder_detail(self, ein: str) -> FunderRecord | None:
        """Fetch detailed 990 data for a specific organization."""
        url = ORG_URL.format(ein=ein)
        data = await self.http.get(
            source=self.SOURCE_NAME,
            url=url,
            ttl_hours=self.cache_ttl,
            daily_budget=self.daily_budget,
        )
        if not data:
            return None

        org = data.get("organization", {})
        filings = data.get("filings_with_data", [])

        record = self._parse_funder(org)
        if record and filings:
            latest = filings[0] if filings else {}
            record.assets = latest.get("totassetsend")
            record.annual_giving = latest.get("grantamt") or latest.get("totfuncexpns")
        return record

    def _parse_funder(self, org: dict) -> FunderRecord | None:
        ein = str(org.get("ein", ""))
        if not ein:
            return None

        # Determine funder type from NTEE code
        ntee = org.get("ntee_code", "") or ""
        subsection = org.get("subsection_code")
        funder_type = "foundation" if ntee.startswith("T") else "nonprofit"
        if subsection == 3:
            funder_type = "501c3"

        return FunderRecord(
            source=self.SOURCE_NAME,
            ein=ein,
            name=org.get("name", ""),
            type=funder_type,
            assets=org.get("asset_amount"),
            annual_giving=org.get("income_amount"),
            geographic_focus=f"{org.get('city', '')}, {org.get('state', '')}".strip(", "),
            sector_focus=ntee,
            website="",
            raw_json=org,
        )
