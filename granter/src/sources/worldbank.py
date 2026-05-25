"""World Bank Projects API — International development projects. No auth required.

Search: GET https://search.worldbank.org/api/v2/projects?format=json&qterm={keyword}&rows=50
NOTE: This is the Projects API, NOT the Indicators API (api.worldbank.org/v2).
"""

from __future__ import annotations

import logging

from src.sources.base import GrantSource, GrantRecord

logger = logging.getLogger(__name__)

SEARCH_URL = "https://search.worldbank.org/api/v2/projects"


class WorldBankSource(GrantSource):
    SOURCE_NAME = "worldbank"

    async def fetch_grants(self, keywords: list[str]) -> list[GrantRecord]:
        records = []
        for keyword in keywords:
            params = {
                "format": "json",
                "qterm": keyword,
                "rows": 50,
                "os": 0,  # offset
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

            projects = data.get("projects", {})
            if isinstance(projects, dict):
                for proj_id, proj in projects.items():
                    if isinstance(proj, dict):
                        record = self._parse(proj_id, proj)
                        if record:
                            records.append(record)

        seen = set()
        unique = []
        for r in records:
            if r.source_id not in seen:
                seen.add(r.source_id)
                unique.append(r)
        return unique

    def _parse(self, proj_id: str, proj: dict) -> GrantRecord | None:
        if not proj_id or proj_id == "total":
            return None

        # Extract country codes
        countries = []
        country_data = proj.get("countryshortname", "")
        if country_data:
            countries = [c.strip() for c in str(country_data).split(";") if c.strip()]

        # Extract sectors
        sectors = []
        sector_data = proj.get("sector1", "") or proj.get("mjsector1", "")
        if sector_data:
            sectors = [s.strip() for s in str(sector_data).split(";") if s.strip()]

        # Extract amounts
        total_amt = proj.get("totalamt")
        try:
            amount = float(total_amt) if total_amt else None
        except (ValueError, TypeError):
            amount = None

        # Map status
        status_raw = (proj.get("status", "") or "").lower()
        status_map = {"active": "active", "closed": "completed", "pipeline": "forecasted"}
        status = status_map.get(status_raw, status_raw)

        return GrantRecord(
            source=self.SOURCE_NAME,
            source_id=str(proj.get("id", proj_id)),
            title=proj.get("project_name", ""),
            description=proj.get("project_abstract", "") or proj.get("pdo", ""),
            agency="World Bank",
            amount_floor=amount,
            amount_ceiling=amount,
            currency="USD",
            status=status,
            open_date=proj.get("boardapprovaldate", ""),
            close_date=proj.get("closingdate", ""),
            url=proj.get("url", f"https://projects.worldbank.org/en/projects-operations/project-detail/{proj_id}"),
            sectors=sectors,
            countries=countries,
            regions=[proj.get("regionname", "")] if proj.get("regionname") else [],
            raw_json=proj,
        )
