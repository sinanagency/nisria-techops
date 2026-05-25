"""Settings routes — org profile and source configuration."""

from __future__ import annotations

import json
from fastapi import APIRouter, Request, Form
from fastapi.responses import RedirectResponse
from src.common.db import get_db
from src.web.templates import render

router = APIRouter()


@router.get("/")
async def settings_view(request: Request):
    conn = get_db()
    try:
        org = conn.execute("SELECT * FROM org_profile WHERE id = 1").fetchone()
        sources = conn.execute("SELECT * FROM source_status ORDER BY source").fetchall()

        return render("settings.html", {
            "request": request,
            "org": dict(org) if org else {},
            "sources": [dict(s) for s in sources],
        })
    finally:
        conn.close()


@router.post("/org")
async def update_org(
    name: str = Form(""),
    mission: str = Form(""),
    ein: str = Form(""),
    sectors: str = Form(""),
    countries: str = Form(""),
    annual_budget: float = Form(0),
    grant_range_min: float = Form(5000),
    grant_range_max: float = Form(250000),
    org_type: str = Form("Nonprofit"),
):
    conn = get_db()
    try:
        sectors_list = [s.strip() for s in sectors.split(",") if s.strip()]
        countries_list = [c.strip().upper() for c in countries.split(",") if c.strip()]

        conn.execute(
            """INSERT INTO org_profile (id, name, mission, ein, sectors_json, countries_json,
                   annual_budget, grant_range_min, grant_range_max, org_type)
               VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                   name=excluded.name, mission=excluded.mission, ein=excluded.ein,
                   sectors_json=excluded.sectors_json, countries_json=excluded.countries_json,
                   annual_budget=excluded.annual_budget,
                   grant_range_min=excluded.grant_range_min,
                   grant_range_max=excluded.grant_range_max,
                   org_type=excluded.org_type""",
            (name, mission, ein, json.dumps(sectors_list), json.dumps(countries_list),
             annual_budget, grant_range_min, grant_range_max, org_type),
        )
        conn.commit()
        return RedirectResponse(url="/settings", status_code=303)
    finally:
        conn.close()


@router.post("/sources/{source_name}/toggle")
async def toggle_source(source_name: str):
    conn = get_db()
    try:
        conn.execute(
            "UPDATE source_status SET is_enabled = CASE WHEN is_enabled = 1 THEN 0 ELSE 1 END WHERE source = ?",
            (source_name,),
        )
        conn.commit()
        return RedirectResponse(url="/settings", status_code=303)
    finally:
        conn.close()
