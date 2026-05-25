"""Background refresh scheduler using APScheduler.

Schedule:
  grants_gov:   every 6h
  sam_gov:      once daily at 02:00 UTC
  usaspending:  every 12h
  worldbank:    once daily at 03:00 UTC
  propublica:   weekly (Sundays at 04:00 UTC)
  iati:         once daily at 05:00 UTC
  Re-score:     after each refresh cycle
  Cache purge:  daily at 00:00 UTC
"""

from __future__ import annotations

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from src.common.config import load_config
from src.common.db import get_db
from src.common.rate_budget import RateBudget
from src.common.http_client import CachedHttpClient
from src.scoring.relevance import score_all_grants
from src.sources.grants_gov import GrantsGovSource
from src.sources.sam_gov import SamGovSource
from src.sources.usaspending import USASpendingSource
from src.sources.worldbank import WorldBankSource
from src.sources.propublica import ProPublicaSource
from src.sources.iati import IATISource

logger = logging.getLogger(__name__)


async def _refresh_source(source_cls, config: dict, db_path: str | None = None):
    """Refresh a single source, then re-score all grants."""
    conn = get_db(db_path)
    budget = RateBudget(conn)
    http = CachedHttpClient(conn, rate_budget=budget)

    try:
        source = source_cls(http, conn, config)
        keywords = config.get("org_profile", {}).get("search_keywords", [])
        count = await source.refresh(keywords)
        if count > 0:
            score_all_grants(conn, config)
        logger.info(f"[{source.SOURCE_NAME}] Refresh complete: {count} grants")
    except Exception as exc:
        logger.error(f"[{source_cls.SOURCE_NAME}] Refresh failed: {exc}")
        conn.execute(
            "UPDATE source_status SET last_error = ? WHERE source = ?",
            (str(exc), source_cls.SOURCE_NAME),
        )
        conn.commit()
    finally:
        await http.close()
        conn.close()


async def _purge_cache(db_path: str | None = None):
    """Purge expired cache entries and reset daily counters."""
    conn = get_db(db_path)
    budget = RateBudget(conn)
    http = CachedHttpClient(conn)
    http.purge_expired()
    budget.reset_daily_counters()
    conn.close()


def create_scheduler(config: dict, db_path: str | None = None) -> AsyncIOScheduler:
    """Create and configure the APScheduler instance."""
    scheduler = AsyncIOScheduler()

    def _job(source_cls):
        async def _run():
            await _refresh_source(source_cls, config, db_path)
        return _run

    # Grants.gov: every 6 hours
    scheduler.add_job(_job(GrantsGovSource), IntervalTrigger(hours=6),
                      id="refresh_grants_gov", name="Grants.gov refresh")

    # SAM.gov: daily at 02:00 UTC (preserve budget)
    scheduler.add_job(_job(SamGovSource), CronTrigger(hour=2),
                      id="refresh_sam_gov", name="SAM.gov daily refresh")

    # USASpending: every 12 hours
    scheduler.add_job(_job(USASpendingSource), IntervalTrigger(hours=12),
                      id="refresh_usaspending", name="USASpending refresh")

    # World Bank: daily at 03:00 UTC
    scheduler.add_job(_job(WorldBankSource), CronTrigger(hour=3),
                      id="refresh_worldbank", name="World Bank daily refresh")

    # ProPublica: weekly Sundays at 04:00 UTC (IRS data is annual)
    scheduler.add_job(_job(ProPublicaSource), CronTrigger(day_of_week="sun", hour=4),
                      id="refresh_propublica", name="ProPublica weekly refresh")

    # IATI: daily at 05:00 UTC
    scheduler.add_job(_job(IATISource), CronTrigger(hour=5),
                      id="refresh_iati", name="IATI daily refresh")

    # Cache purge + budget reset: daily at midnight UTC
    async def _purge():
        await _purge_cache(db_path)

    scheduler.add_job(_purge, CronTrigger(hour=0),
                      id="purge_cache", name="Daily cache purge")

    return scheduler
