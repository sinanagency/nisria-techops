"""Jinja2 templates helper — extracted to avoid circular imports."""

from __future__ import annotations

import os
from starlette.requests import Request
from starlette.responses import HTMLResponse
from jinja2 import Environment, FileSystemLoader

_env: Environment | None = None


def _get_env() -> Environment:
    global _env
    if _env is None:
        templates_dir = os.path.join(os.path.dirname(__file__), "..", "..", "templates")
        _env = Environment(loader=FileSystemLoader(os.path.realpath(templates_dir)))
    return _env


def render(name: str, context: dict) -> HTMLResponse:
    """Render a template to HTMLResponse — avoids Starlette TemplateResponse compat issues."""
    env = _get_env()
    template = env.get_template(name)
    html = template.render(**context)
    return HTMLResponse(html)
