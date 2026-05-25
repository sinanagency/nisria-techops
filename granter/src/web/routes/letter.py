"""Letter generator route."""

from __future__ import annotations

from fastapi import APIRouter, Request
from src.common.db import get_db
from src.web.templates import render
from src.letter.generator import generate_letter

router = APIRouter()


@router.get("/letter")
async def letter_page(
    request: Request,
    funder_id: int = 0,
    tone: str = "formal",
):
    conn = get_db()
    try:
        funders = conn.execute("SELECT id, name FROM funders ORDER BY name").fetchall()
        letter = ""
        if funder_id:
            letter = generate_letter(conn, funder_id, tone)

        return render("letter.html", {
            "request": request,
            "funders": [dict(f) for f in funders],
            "selected_funder_id": funder_id,
            "tone": tone,
            "letter": letter,
        })
    finally:
        conn.close()
