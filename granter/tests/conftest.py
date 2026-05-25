"""Shared test fixtures — in-memory SQLite, mock httpx."""

import json
import sqlite3
import pytest

from src.common.db import ensure_tables, seed_org_profile, seed_source_status
from src.common.config import DEFAULT_CONFIG, _deep_merge


@pytest.fixture
def config():
    """Test config with defaults."""
    return _deep_merge(DEFAULT_CONFIG, {})


@pytest.fixture
def db(config):
    """In-memory SQLite database with all tables created."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    ensure_tables(conn)
    seed_org_profile(conn, config)
    seed_source_status(conn, config)
    yield conn
    conn.close()


@pytest.fixture
def db_with_grants(db):
    """Database seeded with sample grants for testing."""
    grants = [
        ("grants_gov", "GG-001", "Women Empowerment Education Kenya",
         "Grant for women education programs in Kenya",
         "USAID", 50000, 200000, "USD", "posted",
         "2026-01-01", "2026-06-15",
         "https://grants.gov/1", json.dumps(["education"]),
         json.dumps(["Nonprofit"]), json.dumps(["education", "women"]),
         json.dumps(["KE"]), json.dumps(["East Africa"])),
        ("worldbank", "WB-001", "Youth Vocational Training East Africa",
         "Vocational training for youth",
         "World Bank", 100000, 500000, "USD", "active",
         "2025-06-01", "2026-12-31",
         "https://worldbank.org/1", json.dumps(["vocational"]),
         json.dumps([]), json.dumps(["youth", "vocational"]),
         json.dumps(["KE", "TZ"]), json.dumps(["East Africa"])),
        ("sam_gov", "SAM-001", "Federal Nutrition Program",
         "Nutrition assistance for communities",
         "USDA", 10000, 50000, "USD", "posted",
         "2026-02-01", "2026-04-01",
         "https://sam.gov/1", json.dumps(["nutrition"]),
         json.dumps([]), json.dumps(["nutrition", "health"]),
         json.dumps(["US"]), json.dumps([])),
    ]
    for g in grants:
        db.execute(
            """INSERT INTO grants (
                source, source_id, title, description, agency,
                amount_floor, amount_ceiling, currency, status,
                open_date, close_date, url, categories_json,
                eligibility_json, sectors_json, countries_json, regions_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            g,
        )
    db.commit()
    return db
