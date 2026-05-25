"""JSON API endpoints for AJAX calls from the frontend."""

from __future__ import annotations

import json
from fastapi import APIRouter, Query
from src.common.db import get_db
from src.common.rate_budget import RateBudget
from src.common.http_client import CachedHttpClient
from src.common.config import load_config
from src.scoring.relevance import score_all_grants

router = APIRouter()


@router.get("/grants")
async def api_grants(
    q: str = "",
    source: str = "",
    tier: str = "",
    limit: int = Query(25, le=100),
    offset: int = 0,
):
    """JSON endpoint for grant search."""
    conn = get_db()
    try:
        params = []
        where_clauses = []

        if q:
            where_clauses.append("id IN (SELECT rowid FROM grants_fts WHERE grants_fts MATCH ?)")
            params.append(q)
        if source:
            where_clauses.append("source = ?")
            params.append(source)
        if tier:
            where_clauses.append("relevance_tier = ?")
            params.append(tier)

        where_sql = " AND ".join(where_clauses) if where_clauses else "1=1"

        rows = conn.execute(
            f"""SELECT id, source, source_id, title, agency, amount_floor, amount_ceiling,
                       status, open_date, close_date, relevance_score, relevance_tier, url
                FROM grants WHERE {where_sql}
                ORDER BY relevance_score DESC
                LIMIT ? OFFSET ?""",
            params + [limit, offset],
        ).fetchall()

        count = conn.execute(
            f"SELECT COUNT(*) FROM grants WHERE {where_sql}", params
        ).fetchone()[0]

        return {"total": count, "grants": [dict(r) for r in rows]}
    finally:
        conn.close()


@router.get("/sources/status")
async def api_source_status():
    """Get source health dashboard data."""
    conn = get_db()
    try:
        rows = conn.execute("SELECT * FROM source_status ORDER BY source").fetchall()
        return {"sources": [dict(r) for r in rows]}
    finally:
        conn.close()


@router.post("/refresh/{source_name}")
async def api_trigger_refresh(source_name: str):
    """Manually trigger a source refresh."""
    from src.sources.grants_gov import GrantsGovSource
    from src.sources.sam_gov import SamGovSource
    from src.sources.usaspending import USASpendingSource
    from src.sources.worldbank import WorldBankSource
    from src.sources.propublica import ProPublicaSource
    from src.sources.iati import IATISource

    source_map = {
        "grants_gov": GrantsGovSource,
        "sam_gov": SamGovSource,
        "usaspending": USASpendingSource,
        "worldbank": WorldBankSource,
        "propublica": ProPublicaSource,
        "iati": IATISource,
    }

    source_cls = source_map.get(source_name)
    if not source_cls:
        return {"error": f"Unknown source: {source_name}"}

    config = load_config()
    conn = get_db()
    budget = RateBudget(conn)
    http = CachedHttpClient(conn, rate_budget=budget)

    try:
        source = source_cls(http, conn, config)
        keywords = config.get("org_profile", {}).get("search_keywords", [])
        count = await source.refresh(keywords)
        if count > 0:
            score_all_grants(conn, config)
        return {"source": source_name, "grants_found": count}
    except Exception as exc:
        return {"error": str(exc)}
    finally:
        await http.close()
        conn.close()


@router.post("/rescore")
async def api_rescore():
    """Re-score all grants against current org profile."""
    config = load_config()
    conn = get_db()
    try:
        score_all_grants(conn, config)
        return {"status": "ok"}
    finally:
        conn.close()


@router.get("/stats")
async def api_stats():
    """Dashboard stats as JSON."""
    conn = get_db()
    try:
        total = conn.execute("SELECT COUNT(*) FROM grants").fetchone()[0]
        by_tier = {}
        for row in conn.execute(
            "SELECT relevance_tier, COUNT(*) as cnt FROM grants GROUP BY relevance_tier"
        ).fetchall():
            by_tier[row["relevance_tier"]] = row["cnt"]

        by_source = {}
        for row in conn.execute(
            "SELECT source, COUNT(*) as cnt FROM grants GROUP BY source"
        ).fetchall():
            by_source[row["source"]] = row["cnt"]

        return {"total": total, "by_tier": by_tier, "by_source": by_source}
    finally:
        conn.close()
