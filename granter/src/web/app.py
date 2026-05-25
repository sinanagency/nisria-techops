"""FastAPI application factory."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
import os

from src.web.routes import dashboard, grants, funders, tracker, settings, api, letter


def create_app() -> FastAPI:
    app = FastAPI(title="Nisria Grant Finder", version="1.0.0")

    # Static files
    static_dir = os.path.join(os.path.dirname(__file__), "..", "..", "static")
    app.mount("/static", StaticFiles(directory=os.path.realpath(static_dir)), name="static")

    # Register route modules
    app.include_router(dashboard.router)
    app.include_router(grants.router, prefix="/grants", tags=["grants"])
    app.include_router(funders.router, prefix="/funders", tags=["funders"])
    app.include_router(tracker.router, prefix="/tracker", tags=["tracker"])
    app.include_router(settings.router, prefix="/settings", tags=["settings"])
    app.include_router(api.router, prefix="/api/v1", tags=["api"])
    app.include_router(letter.router, tags=["letter"])

    return app
