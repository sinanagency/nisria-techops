"""SAM.gov — Federal opportunities. API key required (free registration).

Search: GET https://api.sam.gov/opportunities/v2/search
Rate limit: 1000/day with registered key, 10/day public. We budget 800/day.
Strategy: Batch large requests, serve from cache between refreshes.
"""

from __future__ import annotations

import logging
import os

from src.sources.base import GrantSource, GrantRecord

logger = logging.getLogger(__name__)

SEARCH_URL = "https://api.sam.gov/opportunities/v2/search"


class SamGovSource(GrantSource):
    SOURCE_NAME = "sam_gov"

    @property
    def api_key(self) -> str:
        return self.source_config.get("api_key", "") or os.environ.get("SAM_GOV_API_KEY", "")

    async def fetch_grants(self, keywords: list[str]) -> list[GrantRecord]:
        if not self.api_key:
            logger.warning("[sam_gov] No API key configured — skipping")
            return []

        records = []
        for keyword in keywords:
            params = {
                "api_key": self.api_key,
                "ptype": "g",  # grants only
                "keyword": keyword,
                "limit": 100,
                "postedFrom": "",
                "status": "active",
            }
            data = await self.http.get(
                source=self.SOURCE_NAME,
                url=SEARCH_URL,
                params=params,
                ttl_hours=self.cache_ttl,
                daily_budget=self.daily_budget,
            )
            if not data:
                continue

            opps = data.get("opportunitiesData", [])
            for opp in opps:
                record = self._parse(opp)
                if record:
                    records.append(record)

        seen = set()
        unique = []
        for r in records:
            if r.source_id not in seen:
                seen.add(r.source_id)
                unique.append(r)
        return unique

    def _parse(self, opp: dict) -> GrantRecord | None:
        notice_id = opp.get("noticeId", "")
        if not notice_id:
            return None

        return GrantRecord(
            source=self.SOURCE_NAME,
            source_id=notice_id,
            title=opp.get("title", ""),
            description=opp.get("description", ""),
            agency=opp.get("fullParentPathName", "") or opp.get("department", ""),
            amount_floor=None,  # SAM.gov doesn't expose award amounts in search
            amount_ceiling=None,
            status="posted",
            open_date=opp.get("postedDate", ""),
            close_date=opp.get("responseDeadLine", "") or opp.get("archiveDate", ""),
            url=opp.get("uiLink", f"https://sam.gov/opp/{notice_id}/view"),
            categories=[opp.get("classificationCode", "")] if opp.get("classificationCode") else [],
            countries=["US"],
            contact_name=opp.get("pointOfContact", [{}])[0].get("fullName", "") if isinstance(opp.get("pointOfContact"), list) and opp.get("pointOfContact") else "",
            contact_email=opp.get("pointOfContact", [{}])[0].get("email", "") if isinstance(opp.get("pointOfContact"), list) and opp.get("pointOfContact") else "",
            contact_phone=opp.get("pointOfContact", [{}])[0].get("phone", "") if isinstance(opp.get("pointOfContact"), list) and opp.get("pointOfContact") else "",
            raw_json=opp,
        )
