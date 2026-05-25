"""Application tracker routes — Kanban pipeline for grant applications."""

from __future__ import annotations

from fastapi import APIRouter, Request, Form
from fastapi.responses import RedirectResponse
from src.common.db import get_db
from src.web.templates import render

router = APIRouter()

PIPELINE_STAGES = ["identified", "researching", "writing", "submitted", "awarded", "rejected"]


@router.get("/")
async def tracker_view(request: Request):
    conn = get_db()
    try:
        rows = conn.execute(
            """SELECT a.*, g.title as grant_title, g.agency, g.close_date,
                      g.relevance_score, g.relevance_tier, g.url as grant_url
               FROM applications a
               LEFT JOIN grants g ON a.grant_id = g.id
               ORDER BY a.updated_at DESC"""
        ).fetchall()

        pipeline = {stage: [] for stage in PIPELINE_STAGES}
        for row in rows:
            r = dict(row)
            stage = r.get("status", "identified")
            if stage in pipeline:
                pipeline[stage].append(r)

        return render("tracker.html", {
            "request": request,
            "pipeline": pipeline,
            "stages": PIPELINE_STAGES,
        })
    finally:
        conn.close()


@router.post("/add")
async def add_to_tracker(grant_id: int = Form(...)):
    conn = get_db()
    try:
        existing = conn.execute(
            "SELECT id FROM applications WHERE grant_id = ?", (grant_id,)
        ).fetchone()
        if not existing:
            grant = conn.execute(
                "SELECT close_date FROM grants WHERE id = ?", (grant_id,)
            ).fetchone()
            deadline = grant["close_date"] if grant else None
            conn.execute(
                "INSERT INTO applications (grant_id, status, deadline) VALUES (?, 'identified', ?)",
                (grant_id, deadline),
            )
            conn.commit()
        return RedirectResponse(url="/tracker", status_code=303)
    finally:
        conn.close()


@router.post("/update/{app_id}")
async def update_application(
    app_id: int,
    status: str = Form(""),
    notes: str = Form(""),
    amount_requested: float = Form(None),
    next_action: str = Form(""),
    next_action_date: str = Form(""),
):
    conn = get_db()
    try:
        updates = ["updated_at = datetime('now')"]
        params = []

        if status and status in PIPELINE_STAGES:
            updates.append("status = ?")
            params.append(status)
        if notes:
            updates.append("notes = ?")
            params.append(notes)
        if amount_requested is not None:
            updates.append("amount_requested = ?")
            params.append(amount_requested)
        if next_action:
            updates.append("next_action = ?")
            params.append(next_action)
        if next_action_date:
            updates.append("next_action_date = ?")
            params.append(next_action_date)

        params.append(app_id)
        conn.execute(
            f"UPDATE applications SET {', '.join(updates)} WHERE id = ?",
            params,
        )
        conn.commit()
        return RedirectResponse(url="/tracker", status_code=303)
    finally:
        conn.close()
