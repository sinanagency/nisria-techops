"""IATI Datastore — International aid activities. No auth required.

Uses the IATI Datastore Classic API (Code for IATI) which is fully open:
Search: GET https://datastore.codeforiati.org/api/1/access/activity.json

This replaces the defunct UNDP open.undp.org API. IATI contains data from UNDP,
USAID, DFID, EU, and 500+ other reporting organizations.
"""

from __future__ import annotations

import logging

from src.sources.base import GrantSource, GrantRecord

logger = logging.getLogger(__name__)

# IATI Datastore Classic (Code for IATI fork — reliable, no auth)
SEARCH_URL = "https://datastore.codeforiati.org/api/1/access/activity.json"


class IATISource(GrantSource):
    SOURCE_NAME = "iati"

    async def fetch_grants(self, keywords: list[str]) -> list[GrantRecord]:
        records = []
        # Fetch by country codes from org profile
        countries = self.config.get("org_profile", {}).get("countries", ["KE"])
        for country in countries:
            data = await self.http.get(
                source=self.SOURCE_NAME,
                url=SEARCH_URL,
                params={
                    "recipient-country": country,
                    "limit": 50,
                    "offset": 0,
                },
                ttl_hours=self.cache_ttl,
                daily_budget=self.daily_budget,
            )
            if not data:
                continue

            activities = data.get("iati-activities", [])
            if isinstance(activities, list):
                for act in activities:
                    record = self._parse(act)
                    if record:
                        records.append(record)

        seen = set()
        unique = []
        for r in records:
            if r.source_id not in seen:
                seen.add(r.source_id)
                unique.append(r)
        return unique

    def _parse(self, act: dict) -> GrantRecord | None:
        iati_id = act.get("iati-identifier", "")
        if not iati_id:
            return None

        # Extract title (may be a dict with narratives or plain string)
        title = ""
        title_data = act.get("title", {})
        if isinstance(title_data, dict):
            narrative = title_data.get("narrative", "")
            if isinstance(narrative, list) and narrative:
                title = narrative[0].get("text", "") if isinstance(narrative[0], dict) else str(narrative[0])
            elif isinstance(narrative, str):
                title = narrative
        elif isinstance(title_data, str):
            title = title_data

        # Extract description
        description = ""
        desc_data = act.get("description", [])
        if isinstance(desc_data, list) and desc_data:
            first = desc_data[0] if desc_data else {}
            narrative = first.get("narrative", "") if isinstance(first, dict) else ""
            if isinstance(narrative, list) and narrative:
                description = narrative[0].get("text", "") if isinstance(narrative[0], dict) else str(narrative[0])
            elif isinstance(narrative, str):
                description = narrative
        elif isinstance(desc_data, dict):
            narrative = desc_data.get("narrative", "")
            if isinstance(narrative, str):
                description = narrative

        # Extract reporting org
        agency = ""
        reporting = act.get("reporting-org", {})
        if isinstance(reporting, dict):
            narrative = reporting.get("narrative", "")
            if isinstance(narrative, list) and narrative:
                agency = narrative[0].get("text", "") if isinstance(narrative[0], dict) else str(narrative[0])
            elif isinstance(narrative, str):
                agency = narrative

        # Extract countries
        countries = []
        rc = act.get("recipient-country", [])
        if isinstance(rc, list):
            for c in rc:
                code = c.get("code", "") if isinstance(c, dict) else ""
                if code:
                    countries.append(code)
        elif isinstance(rc, dict) and rc.get("code"):
            countries.append(rc["code"])

        # Extract sectors from DAC codes
        sectors = []
        sector_data = act.get("sector", [])
        if isinstance(sector_data, list):
            for s in sector_data:
                narrative = s.get("narrative", "") if isinstance(s, dict) else ""
                if isinstance(narrative, list) and narrative:
                    text = narrative[0].get("text", "") if isinstance(narrative[0], dict) else str(narrative[0])
                    if text:
                        sectors.append(text)
                elif isinstance(narrative, str) and narrative:
                    sectors.append(narrative)

        # Status mapping
        status_code = act.get("activity-status", {})
        if isinstance(status_code, dict):
            status_code = status_code.get("code", "")
        status_map = {"1": "forecasted", "2": "active", "3": "active", "4": "completed", "5": "completed"}
        status = status_map.get(str(status_code), "active")

        return GrantRecord(
            source=self.SOURCE_NAME,
            source_id=iati_id,
            title=title,
            description=description,
            agency=agency,
            status=status,
            countries=countries,
            sectors=sectors,
            url=f"https://d-portal.org/ctrack.html?search={iati_id}",
            raw_json=act,
        )
