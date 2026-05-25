"""Grants.gov — PRIMARY source. No auth required.

Search: POST https://api.grants.gov/v1/api/search2
Detail: POST https://api.grants.gov/v1/api/fetchOpportunity
"""

from __future__ import annotations

import logging

from src.sources.base import GrantSource, GrantRecord

logger = logging.getLogger(__name__)

BASE_URL = "https://api.grants.gov/v1/api"
SEARCH_URL = f"{BASE_URL}/search2"

# Grants.gov category codes mapped to readable sectors
CATEGORY_MAP = {
    "ACA": "arts",
    "AG": "agriculture",
    "BC": "business",
    "CD": "community development",
    "CP": "consumer protection",
    "DPR": "disaster prevention",
    "ED": "education",
    "ELT": "employment",
    "EN": "energy",
    "ENV": "environment",
    "FN": "food",
    "HL": "health",
    "HO": "housing",
    "HU": "humanities",
    "ISS": "social services",
    "IS": "information",
    "LJL": "law",
    "NR": "natural resources",
    "O": "other",
    "RA": "recovery",
    "RD": "regional development",
    "ST": "science",
    "T": "transportation",
}


class GrantsGovSource(GrantSource):
    SOURCE_NAME = "grants_gov"

    async def fetch_grants(self, keywords: list[str]) -> list[GrantRecord]:
        records = []
        for keyword in keywords:
            data = await self.http.post(
                source=self.SOURCE_NAME,
                url=SEARCH_URL,
                json_body={"keyword": keyword, "rows": 50, "oppStatuses": "posted"},
                ttl_hours=self.cache_ttl,
                daily_budget=self.daily_budget,
            )
            if not data:
                continue

            opps = data.get("oppHits", [])
            for opp in opps:
                record = self._parse(opp)
                if record:
                    records.append(record)

        # Deduplicate by source_id
        seen = set()
        unique = []
        for r in records:
            if r.source_id not in seen:
                seen.add(r.source_id)
                unique.append(r)
        return unique

    def _parse(self, opp: dict) -> GrantRecord | None:
        opp_id = str(opp.get("id", ""))
        if not opp_id:
            return None

        # Parse category codes to readable sectors
        cat_codes = opp.get("fundingCategories", "") or ""
        categories = [c.strip() for c in cat_codes.split(",") if c.strip()]
        sectors = [CATEGORY_MAP.get(c, c) for c in categories]

        # Parse amounts
        award_floor = opp.get("awardFloor")
        award_ceiling = opp.get("awardCeiling")
        try:
            amount_floor = float(award_floor) if award_floor else None
        except (ValueError, TypeError):
            amount_floor = None
        try:
            amount_ceiling = float(award_ceiling) if award_ceiling else None
        except (ValueError, TypeError):
            amount_ceiling = None

        return GrantRecord(
            source=self.SOURCE_NAME,
            source_id=opp_id,
            title=opp.get("title", ""),
            description=opp.get("synopsis", "") or opp.get("description", ""),
            agency=opp.get("agencyName", "") or opp.get("agency", ""),
            amount_floor=amount_floor,
            amount_ceiling=amount_ceiling,
            status=opp.get("oppStatus", "posted").lower(),
            open_date=opp.get("openDate", ""),
            close_date=opp.get("closeDate", ""),
            url=f"https://www.grants.gov/search-results-detail/{opp_id}",
            categories=categories,
            sectors=sectors,
            countries=["US"],
            eligibility=[e for e in (opp.get("eligibilities", "") or "").split(",") if e.strip()],
            raw_json=opp,
        )
