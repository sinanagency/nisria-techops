"""Per-source daily API call budget tracking."""

from __future__ import annotations

import logging
import sqlite3

logger = logging.getLogger(__name__)


class RateBudget:
    """Tracks and enforces per-source daily API call budgets via SQLite."""

    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    def can_call(self, source: str, daily_budget: int) -> bool:
        """Check whether a source has remaining budget for today."""
        row = self.conn.execute(
            "SELECT calls_today FROM source_status WHERE source = ?",
            (source,),
        ).fetchone()
        if not row:
            return True
        return row["calls_today"] < daily_budget

    def get_remaining(self, source: str, daily_budget: int) -> int:
        """Return remaining calls for today."""
        row = self.conn.execute(
            "SELECT calls_today FROM source_status WHERE source = ?",
            (source,),
        ).fetchone()
        if not row:
            return daily_budget
        return max(0, daily_budget - row["calls_today"])

    def reset_daily_counters(self) -> None:
        """Reset all source daily call counters (run at midnight)."""
        self.conn.execute("UPDATE source_status SET calls_today = 0")
        self.conn.commit()
        logger.info("Reset daily API call counters")
