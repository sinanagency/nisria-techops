"""Tests for database schema, FTS5, and triggers."""

import json
import sqlite3
import pytest

from src.common.db import get_db, ensure_tables, seed_org_profile, seed_source_status


class TestSchema:
    def test_tables_created(self, db):
        """All expected tables should exist."""
        tables = db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        ).fetchall()
        table_names = {r["name"] for r in tables}
        assert "grants" in table_names
        assert "funders" in table_names
        assert "applications" in table_names
        assert "saved_searches" in table_names
        assert "org_profile" in table_names
        assert "http_cache" in table_names
        assert "api_call_log" in table_names
        assert "source_status" in table_names

    def test_fts5_tables_created(self, db):
        """FTS5 virtual tables should exist."""
        tables = db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%_fts'"
        ).fetchall()
        names = {r["name"] for r in tables}
        assert "grants_fts" in names
        assert "funders_fts" in names

    def test_org_profile_seeded(self, db):
        row = db.execute("SELECT * FROM org_profile WHERE id = 1").fetchone()
        assert row is not None
        assert row["name"] == "Nisria Foundation"

    def test_source_status_seeded(self, db):
        rows = db.execute("SELECT * FROM source_status").fetchall()
        sources = {r["source"] for r in rows}
        assert "grants_gov" in sources
        assert "sam_gov" in sources
        assert "worldbank" in sources


class TestFTS5:
    def test_fts_auto_index_on_insert(self, db):
        """Inserting a grant should auto-index in FTS via trigger."""
        db.execute(
            """INSERT INTO grants (source, source_id, title, description, agency)
               VALUES ('test', 'T1', 'Education for Women in Kenya', 'A test grant', 'TestAgency')"""
        )
        db.commit()

        results = db.execute(
            "SELECT rowid FROM grants_fts WHERE grants_fts MATCH 'education Kenya'"
        ).fetchall()
        assert len(results) == 1

    def test_fts_auto_update_on_update(self, db):
        """Updating a grant should update FTS index via trigger."""
        db.execute(
            """INSERT INTO grants (source, source_id, title, description, agency)
               VALUES ('test', 'T2', 'Original Title', 'desc', 'Agency')"""
        )
        db.commit()

        db.execute(
            "UPDATE grants SET title = 'Nutrition Program Kenya' WHERE source_id = 'T2'"
        )
        db.commit()

        # Old title should not match
        old = db.execute(
            "SELECT rowid FROM grants_fts WHERE grants_fts MATCH 'Original'"
        ).fetchall()
        assert len(old) == 0

        # New title should match
        new = db.execute(
            "SELECT rowid FROM grants_fts WHERE grants_fts MATCH 'Nutrition'"
        ).fetchall()
        assert len(new) == 1

    def test_fts_auto_delete(self, db):
        """Deleting a grant should remove from FTS index."""
        db.execute(
            """INSERT INTO grants (source, source_id, title, description, agency)
               VALUES ('test', 'T3', 'Deletable Grant', 'desc', 'Agency')"""
        )
        db.commit()
        row_id = db.execute("SELECT id FROM grants WHERE source_id = 'T3'").fetchone()["id"]

        db.execute("DELETE FROM grants WHERE id = ?", (row_id,))
        db.commit()

        results = db.execute(
            "SELECT rowid FROM grants_fts WHERE grants_fts MATCH 'Deletable'"
        ).fetchall()
        assert len(results) == 0

    def test_grant_unique_constraint(self, db):
        """Duplicate (source, source_id) should fail."""
        db.execute(
            """INSERT INTO grants (source, source_id, title) VALUES ('test', 'DUP1', 'First')"""
        )
        db.commit()
        with pytest.raises(sqlite3.IntegrityError):
            db.execute(
                """INSERT INTO grants (source, source_id, title) VALUES ('test', 'DUP1', 'Second')"""
            )
