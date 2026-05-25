"""Async HTTP client with 3-tier caching: fresh cache -> live API -> stale fallback."""

from __future__ import annotations

import hashlib
import json
import logging
import sqlite3
from datetime import datetime, timedelta

import httpx

from src.common.rate_budget import RateBudget

logger = logging.getLogger(__name__)


def _cache_key(source: str, url: str, params: dict | None = None, body: dict | None = None) -> str:
    """Generate a SHA-256 cache key from request parameters."""
    raw = f"{source}|{url}|{json.dumps(params or {}, sort_keys=True)}|{json.dumps(body or {}, sort_keys=True)}"
    return hashlib.sha256(raw.encode()).hexdigest()


class CachedHttpClient:
    """HTTP client with SQLite-backed cache and rate budget enforcement."""

    def __init__(
        self,
        conn: sqlite3.Connection,
        rate_budget: RateBudget | None = None,
        timeout: float = 30.0,
    ):
        self.conn = conn
        self.budget = rate_budget
        self._client = httpx.AsyncClient(timeout=timeout, follow_redirects=True)

    async def get(
        self,
        source: str,
        url: str,
        params: dict | None = None,
        ttl_hours: int = 6,
        daily_budget: int | None = None,
    ) -> dict | None:
        """GET request with caching and budget check."""
        key = _cache_key(source, url, params=params)
        cached = self._get_cache(key)
        if cached is not None:
            return cached

        if daily_budget and self.budget and not self.budget.can_call(source, daily_budget):
            logger.warning(f"[{source}] Daily budget exhausted, trying stale cache")
            return self._get_stale_cache(key)

        try:
            resp = await self._client.get(url, params=params)
            self._log_call(source, url, resp.status_code)
            resp.raise_for_status()
            data = resp.json()
            self._set_cache(key, source, url, data, ttl_hours)
            return data
        except Exception as exc:
            logger.error(f"[{source}] GET {url} failed: {exc}")
            stale = self._get_stale_cache(key)
            if stale is not None:
                logger.info(f"[{source}] Serving stale cache for {url}")
            return stale

    async def post(
        self,
        source: str,
        url: str,
        json_body: dict | None = None,
        ttl_hours: int = 6,
        daily_budget: int | None = None,
    ) -> dict | None:
        """POST request with caching and budget check."""
        key = _cache_key(source, url, body=json_body)
        cached = self._get_cache(key)
        if cached is not None:
            return cached

        if daily_budget and self.budget and not self.budget.can_call(source, daily_budget):
            logger.warning(f"[{source}] Daily budget exhausted, trying stale cache")
            return self._get_stale_cache(key)

        try:
            resp = await self._client.post(url, json=json_body)
            self._log_call(source, url, resp.status_code)
            resp.raise_for_status()
            data = resp.json()
            self._set_cache(key, source, url, data, ttl_hours)
            return data
        except Exception as exc:
            logger.error(f"[{source}] POST {url} failed: {exc}")
            stale = self._get_stale_cache(key)
            if stale is not None:
                logger.info(f"[{source}] Serving stale cache for {url}")
            return stale

    def _get_cache(self, key: str) -> dict | None:
        """Get fresh (non-expired) cached response."""
        row = self.conn.execute(
            "SELECT response_json FROM http_cache WHERE cache_key = ? AND expires_at > datetime('now')",
            (key,),
        ).fetchone()
        if row:
            return json.loads(row["response_json"])
        return None

    def _get_stale_cache(self, key: str) -> dict | None:
        """Get any cached response regardless of expiry (stale fallback)."""
        row = self.conn.execute(
            "SELECT response_json FROM http_cache WHERE cache_key = ? ORDER BY fetched_at DESC LIMIT 1",
            (key,),
        ).fetchone()
        if row:
            return json.loads(row["response_json"])
        return None

    def _set_cache(self, key: str, source: str, url: str, data: dict, ttl_hours: int) -> None:
        """Store response in cache."""
        expires = (datetime.utcnow() + timedelta(hours=ttl_hours)).isoformat()
        self.conn.execute(
            """INSERT INTO http_cache (cache_key, source, url, response_json, expires_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(cache_key) DO UPDATE SET
                   response_json=excluded.response_json,
                   fetched_at=datetime('now'),
                   expires_at=excluded.expires_at""",
            (key, source, url, json.dumps(data), expires),
        )
        self.conn.commit()

    def _log_call(self, source: str, url: str, status_code: int) -> None:
        """Log API call for budget tracking."""
        self.conn.execute(
            "INSERT INTO api_call_log (source, url, status_code) VALUES (?, ?, ?)",
            (source, url, status_code),
        )
        self.conn.execute(
            "UPDATE source_status SET calls_today = calls_today + 1 WHERE source = ?",
            (source,),
        )
        self.conn.commit()

    def purge_expired(self) -> None:
        """Remove expired cache entries."""
        self.conn.execute("DELETE FROM http_cache WHERE expires_at < datetime('now')")
        self.conn.commit()
        logger.info("Purged expired cache entries")

    async def close(self) -> None:
        """Close the underlying httpx client."""
        await self._client.aclose()
