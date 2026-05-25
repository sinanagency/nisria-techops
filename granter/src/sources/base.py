"""Base classes for grant sources — GrantRecord dataclass and abstract GrantSource."""

from __future__ import annotations

import json
import logging
import sqlite3
from dataclasses import dataclass, field
from abc import ABC, abstractmethod

logger = logging.getLogger(__name__)


@dataclass
class GrantRecord:
    """Normalized grant record for upsert into the grants table."""

    source: str
    source_id: str
    title: str = ""
    description: str = ""
    agency: str = ""
    amount_floor: float | None = None
    amount_ceiling: float | None = None
    currency: str = "USD"
    status: str = "posted"
    open_date: str = ""
    close_date: str = ""
    url: str = ""
    categories: list[str] = field(default_factory=list)
    eligibility: list[str] = field(default_factory=list)
    sectors: list[str] = field(default_factory=list)
    countries: list[str] = field(default_factory=list)
    regions: list[str] = field(default_factory=list)
    contact_name: str = ""
    contact_email: str = ""
    contact_phone: str = ""
    raw_json: dict | str = field(default_factory=dict)

    def upsert(self, conn: sqlite3.Connection) -> None:
        """Insert or update this grant in the database."""
        raw = self.raw_json if isinstance(self.raw_json, str) else json.dumps(self.raw_json)
        conn.execute(
            """INSERT INTO grants (
                source, source_id, title, description, agency,
                amount_floor, amount_ceiling, currency, status,
                open_date, close_date, url,
                categories_json, eligibility_json, sectors_json,
                countries_json, regions_json,
                contact_name, contact_email, contact_phone,
                raw_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(source, source_id) DO UPDATE SET
                title=excluded.title,
                description=excluded.description,
                agency=excluded.agency,
                amount_floor=excluded.amount_floor,
                amount_ceiling=excluded.amount_ceiling,
                currency=excluded.currency,
                status=excluded.status,
                open_date=excluded.open_date,
                close_date=excluded.close_date,
                url=excluded.url,
                categories_json=excluded.categories_json,
                eligibility_json=excluded.eligibility_json,
                sectors_json=excluded.sectors_json,
                countries_json=excluded.countries_json,
                regions_json=excluded.regions_json,
                contact_name=excluded.contact_name,
                contact_email=excluded.contact_email,
                contact_phone=excluded.contact_phone,
                raw_json=excluded.raw_json,
                last_updated_at=datetime('now')
            """,
            (
                self.source, self.source_id, self.title, self.description, self.agency,
                self.amount_floor, self.amount_ceiling, self.currency, self.status,
                self.open_date, self.close_date, self.url,
                json.dumps(self.categories), json.dumps(self.eligibility),
                json.dumps(self.sectors), json.dumps(self.countries),
                json.dumps(self.regions),
                self.contact_name, self.contact_email, self.contact_phone,
                raw,
            ),
        )


@dataclass
class FunderRecord:
    """Normalized funder record for upsert into the funders table."""

    source: str
    ein: str
    name: str = ""
    type: str = ""
    assets: float | None = None
    annual_giving: float | None = None
    geographic_focus: str = ""
    sector_focus: str = ""
    website: str = ""
    contact_name: str = ""
    contact_email: str = ""
    contact_phone: str = ""
    raw_json: dict | str = field(default_factory=dict)

    def upsert(self, conn: sqlite3.Connection) -> None:
        """Insert or update this funder in the database."""
        raw = self.raw_json if isinstance(self.raw_json, str) else json.dumps(self.raw_json)
        conn.execute(
            """INSERT INTO funders (
                source, ein, name, type, assets, annual_giving,
                geographic_focus, sector_focus, website,
                contact_name, contact_email, contact_phone, raw_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(source, ein) DO UPDATE SET
                name=excluded.name,
                type=excluded.type,
                assets=excluded.assets,
                annual_giving=excluded.annual_giving,
                geographic_focus=excluded.geographic_focus,
                sector_focus=excluded.sector_focus,
                website=excluded.website,
                contact_name=excluded.contact_name,
                contact_email=excluded.contact_email,
                contact_phone=excluded.contact_phone,
                raw_json=excluded.raw_json,
                last_updated_at=datetime('now')
            """,
            (
                self.source, self.ein, self.name, self.type,
                self.assets, self.annual_giving,
                self.geographic_focus, self.sector_focus, self.website,
                self.contact_name, self.contact_email, self.contact_phone,
                raw,
            ),
        )


class GrantSource(ABC):
    """Abstract base for all grant data sources."""

    SOURCE_NAME: str = ""

    def __init__(self, http, conn: sqlite3.Connection, config: dict):
        self.http = http
        self.conn = conn
        self.config = config
        self.source_config = config.get("sources", {}).get(self.SOURCE_NAME, {})
        self.cache_ttl = self.source_config.get("cache_ttl_hours", 6)
        self.daily_budget = self.source_config.get("daily_budget")

    @abstractmethod
    async def fetch_grants(self, keywords: list[str]) -> list[GrantRecord]:
        """Fetch grants matching the given keywords."""
        ...

    async def refresh(self, keywords: list[str]) -> int:
        """Fetch, deduplicate, and upsert grants. Returns count of grants found."""
        records = await self.fetch_grants(keywords)
        count = 0
        for record in records:
            record.upsert(self.conn)
            count += 1
        self.conn.commit()

        # Update source status
        self.conn.execute(
            """UPDATE source_status SET
                grants_found = ?, last_refresh_at = datetime('now'), last_error = ''
               WHERE source = ?""",
            (count, self.SOURCE_NAME),
        )
        self.conn.commit()

        logger.info(f"[{self.SOURCE_NAME}] Refreshed: {count} grants upserted")
        return count
