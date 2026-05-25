"""Dashboard route — GET / — stats, upcoming deadlines, source health."""

from __future__ import annotations

from fastapi import APIRouter, Request
from src.common.db import get_db
from src.web.templates import render

router = APIRouter()


@router.get("/")
async def dashboard(request: Request):
    conn = get_db()
    try:
        # Grant counts by tier
        tier_counts = {}
        for row in conn.execute(
            "SELECT relevance_tier, COUNT(*) as cnt FROM grants GROUP BY relevance_tier"
        ).fetchall():
            tier_counts[row["relevance_tier"]] = row["cnt"]

        total_grants = sum(tier_counts.values())

        # Upcoming deadlines (next 30 days)
        upcoming = conn.execute(
            """SELECT id, title, source, close_date, relevance_tier, relevance_score
               FROM grants
               WHERE close_date >= date('now') AND close_date <= date('now', '+30 days')
               ORDER BY close_date ASC LIMIT 10"""
        ).fetchall()

        # Source health
        sources = conn.execute("SELECT * FROM source_status ORDER BY source").fetchall()

        # Application pipeline counts
        pipeline = {}
        for row in conn.execute(
            "SELECT status, COUNT(*) as cnt FROM applications GROUP BY status"
        ).fetchall():
            pipeline[row["status"]] = row["cnt"]

        # Recent grants (last 7 days)
        recent_count = conn.execute(
            "SELECT COUNT(*) FROM grants WHERE first_seen_at >= datetime('now', '-7 days')"
        ).fetchone()[0]

        return render("dashboard.html", {
            "request": request,
            "total_grants": total_grants,
            "tier_counts": tier_counts,
            "upcoming": [dict(r) for r in upcoming],
            "sources": [dict(r) for r in sources],
            "pipeline": pipeline,
            "recent_count": recent_count,
        })
    finally:
        conn.close()
