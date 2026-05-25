"""Funder search and detail routes."""

from __future__ import annotations

from fastapi import APIRouter, Request
from src.common.db import get_db
from src.web.templates import render

router = APIRouter()

PAGE_SIZE = 25


@router.get("/")
async def funder_search(request: Request, q: str = "", page: int = 1):
    conn = get_db()
    try:
        offset = (page - 1) * PAGE_SIZE
        params = []

        if q:
            where_sql = "funders.id IN (SELECT rowid FROM funders_fts WHERE funders_fts MATCH ?)"
            params.append(q)
        else:
            where_sql = "1=1"

        count = conn.execute(
            f"SELECT COUNT(*) FROM funders WHERE {where_sql}", params
        ).fetchone()[0]

        rows = conn.execute(
            f"""SELECT * FROM funders WHERE {where_sql}
                ORDER BY annual_giving DESC NULLS LAST
                LIMIT ? OFFSET ?""",
            params + [PAGE_SIZE, offset],
        ).fetchall()

        total_pages = (count + PAGE_SIZE - 1) // PAGE_SIZE

        return render("funders.html", {
            "request": request,
            "funders": [dict(r) for r in rows],
            "q": q,
            "page": page,
            "total_pages": total_pages,
            "total_count": count,
        })
    finally:
        conn.close()


@router.get("/{funder_id}")
async def funder_detail(request: Request, funder_id: int):
    conn = get_db()
    try:
        funder = conn.execute("SELECT * FROM funders WHERE id = ?", (funder_id,)).fetchone()
        return render("funder_detail.html", {
            "request": request,
            "funder": dict(funder) if funder else None,
        })
    finally:
        conn.close()
