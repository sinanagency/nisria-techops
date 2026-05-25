"""USASpending.gov — Federal award spending data. No auth required.

Search: POST https://api.usaspending.gov/api/v2/search/spending_by_award/
Award type codes for grants: 02, 03, 04, 05
"""

from __future__ import annotations

import logging

from src.sources.base import GrantSource, GrantRecord

logger = logging.getLogger(__name__)

SEARCH_URL = "https://api.usaspending.gov/api/v2/search/spending_by_award/"

# Grant-type award codes
GRANT_AWARD_TYPES = ["02", "03", "04", "05"]


class USASpendingSource(GrantSource):
    SOURCE_NAME = "usaspending"

    async def fetch_grants(self, keywords: list[str]) -> list[GrantRecord]:
        records = []
        for keyword in keywords:
            body = {
                "subawards": False,
                "limit": 50,
                "page": 1,
                "sort": "Award Amount",
                "order": "desc",
                "filters": {
                    "keywords": [keyword],
                    "award_type_codes": GRANT_AWARD_TYPES,
                },
                "fields": [
                    "Award ID", "Recipient Name", "Award Amount",
                    "Awarding Agency", "Awarding Sub Agency",
                    "Start Date", "End Date", "Description",
                    "generated_internal_id",
                ],
            }
            data = await self.http.post(
                source=self.SOURCE_NAME,
                url=SEARCH_URL,
                json_body=body,
                ttl_hours=self.cache_ttl,
                daily_budget=self.daily_budget,
            )
            if not data:
                continue

            results = data.get("results", [])
            for award in results:
                record = self._parse(award)
                if record:
                    records.append(record)

        seen = set()
        unique = []
        for r in records:
            if r.source_id not in seen:
                seen.add(r.source_id)
                unique.append(r)
        return unique

    def _parse(self, award: dict) -> GrantRecord | None:
        award_id = award.get("generated_internal_id") or award.get("Award ID", "")
        if not award_id:
            return None

        amount = award.get("Award Amount")
        try:
            amount_val = float(amount) if amount else None
        except (ValueError, TypeError):
            amount_val = None

        return GrantRecord(
            source=self.SOURCE_NAME,
            source_id=str(award_id),
            title=award.get("Recipient Name", ""),
            description=award.get("Description", ""),
            agency=award.get("Awarding Agency", ""),
            amount_floor=amount_val,
            amount_ceiling=amount_val,
            status="active",
            open_date=award.get("Start Date", ""),
            close_date=award.get("End Date", ""),
            url=f"https://www.usaspending.gov/award/{award_id}",
            countries=["US"],
            raw_json=award,
        )
