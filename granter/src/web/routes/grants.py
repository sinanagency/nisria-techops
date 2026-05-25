"""Grant search and detail routes."""

from __future__ import annotations

import csv
import io
from fastapi import APIRouter, Request, Query
from fastapi.responses import StreamingResponse
from src.common.db import get_db
from src.web.templates import render

router = APIRouter()

PAGE_SIZE = 25


@router.get("/")
async def grant_search(
    request: Request,
    q: str = "",
    source: str = "",
    tier: str = "",
    status: str = "",
    page: int = 1,
):
    conn = get_db()
    try:
        offset = (page - 1) * PAGE_SIZE
        params = []
        where_clauses = []

        if q:
            where_clauses.append("grants.id IN (SELECT rowid FROM grants_fts WHERE grants_fts MATCH ?)")
            params.append(q)
        if source:
            where_clauses.append("grants.source = ?")
            params.append(source)
        if tier:
            where_clauses.append("grants.relevance_tier = ?")
            params.append(tier)
        if status:
            where_clauses.append("grants.status = ?")
            params.append(status)

        where_sql = " AND ".join(where_clauses) if where_clauses else "1=1"

        count = conn.execute(
            f"SELECT COUNT(*) FROM grants WHERE {where_sql}", params
        ).fetchone()[0]

        rows = conn.execute(
            f"""SELECT * FROM grants WHERE {where_sql}
                ORDER BY relevance_score DESC, close_date ASC
                LIMIT ? OFFSET ?""",
            params + [PAGE_SIZE, offset],
        ).fetchall()

        total_pages = (count + PAGE_SIZE - 1) // PAGE_SIZE

        all_sources = conn.execute(
            "SELECT DISTINCT source FROM grants ORDER BY source"
        ).fetchall()

        return render("grants.html", {
            "request": request,
            "grants": [dict(r) for r in rows],
            "q": q,
            "source": source,
            "tier": tier,
            "status": status,
            "page": page,
            "total_pages": total_pages,
            "total_count": count,
            "all_sources": [r["source"] for r in all_sources],
        })
    finally:
        conn.close()


@router.get("/export")
async def export_csv(
    q: str = "",
    source: str = "",
    tier: str = "",
    status: str = "",
):
    """Export filtered grants as CSV."""
    conn = get_db()
    try:
        params = []
        where_clauses = []

        if q:
            where_clauses.append("grants.id IN (SELECT rowid FROM grants_fts WHERE grants_fts MATCH ?)")
            params.append(q)
        if source:
            where_clauses.append("grants.source = ?")
            params.append(source)
        if tier:
            where_clauses.append("grants.relevance_tier = ?")
            params.append(tier)
        if status:
            where_clauses.append("grants.status = ?")
            params.append(status)

        where_sql = " AND ".join(where_clauses) if where_clauses else "1=1"

        rows = conn.execute(
            f"SELECT * FROM grants WHERE {where_sql} ORDER BY relevance_score DESC",
            params,
        ).fetchall()

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "Title", "Agency", "Source", "Amount Floor", "Amount Ceiling",
            "Status", "Open Date", "Close Date", "Relevance Score", "Tier", "URL",
        ])
        for row in rows:
            r = dict(row)
            writer.writerow([
                r["title"], r["agency"], r["source"],
                r["amount_floor"], r["amount_ceiling"],
                r["status"], r["open_date"], r["close_date"],
                r["relevance_score"], r["relevance_tier"], r["url"],
            ])

        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=grants_export.csv"},
        )
    finally:
        conn.close()


@router.get("/{grant_id}")
async def grant_detail(request: Request, grant_id: int):
    conn = get_db()
    try:
        grant = conn.execute("SELECT * FROM grants WHERE id = ?", (grant_id,)).fetchone()

        application = None
        if grant:
            application = conn.execute(
                "SELECT * FROM applications WHERE grant_id = ?", (grant_id,)
            ).fetchone()

        return render("grant_detail.html", {
            "request": request,
            "grant": dict(grant) if grant else None,
            "application": dict(application) if application else None,
        })
    finally:
        conn.close()
