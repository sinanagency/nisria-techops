"""5-signal grant relevance scoring — mirrors outreach pipeline score.py pattern.

Signals and weights (must sum to 1.0):
  sector_match      0.30  Jaccard similarity of grant sectors vs org profile sectors
  geographic_match   0.25  Country match=1.0, region=0.6, global=0.3, mismatch=0.0
  amount_fit         0.20  Overlap of grant range with org's target range
  deadline_proximity 0.15  7-30d=1.0, 30-90d=0.8, >90d=0.4, <7d=0.5, passed=0.0
  source_reliability 0.10  Static per-source weight

Tiers: HIGH (>=0.7), MEDIUM (>=0.4), LOW (>=0.2), IRRELEVANT (<0.2)
"""

from __future__ import annotations

import json
import logging
import sqlite3
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

SOURCE_RELIABILITY = {
    "grants_gov": 1.0,
    "sam_gov": 0.95,
    "usaspending": 0.85,
    "worldbank": 0.80,
    "iati": 0.70,
    "propublica": 0.60,
}

TIER_THRESHOLDS = [
    (0.7, "HIGH"),
    (0.4, "MEDIUM"),
    (0.2, "LOW"),
    (0.0, "IRRELEVANT"),
]


def _jaccard(set_a: set, set_b: set) -> float:
    """Jaccard similarity between two sets."""
    if not set_a or not set_b:
        return 0.0
    intersection = set_a & set_b
    union = set_a | set_b
    return len(intersection) / len(union) if union else 0.0


def _sector_score(grant_sectors: list[str], org_sectors: list[str]) -> float:
    """Jaccard similarity of grant sectors vs org profile sectors."""
    a = {s.lower().strip() for s in grant_sectors if s}
    b = {s.lower().strip() for s in org_sectors if s}
    return _jaccard(a, b)


def _geographic_score(grant_countries: list[str], grant_regions: list[str],
                      org_countries: list[str], org_regions: list[str]) -> float:
    """Score geographic relevance."""
    gc = {c.upper() for c in grant_countries if c}
    oc = {c.upper() for c in org_countries if c}

    # Direct country match
    if gc & oc:
        return 1.0

    # Region match
    gr = {r.lower() for r in grant_regions if r}
    org_r = {r.lower() for r in org_regions if r}
    if gr & org_r:
        return 0.6

    # No country/region specified on grant = global program
    if not gc and not gr:
        return 0.3

    return 0.0


def _amount_score(grant_floor: float | None, grant_ceiling: float | None,
                  org_min: float, org_max: float) -> float:
    """Score how well the grant amount range fits the org's target range."""
    if grant_floor is None and grant_ceiling is None:
        return 0.5  # Unknown amount — neutral

    g_low = grant_floor or 0
    g_high = grant_ceiling or g_low or float("inf")

    # Check overlap
    overlap_low = max(g_low, org_min)
    overlap_high = min(g_high, org_max)

    if overlap_low > overlap_high:
        return 0.0  # No overlap

    overlap_range = overlap_high - overlap_low
    org_range = org_max - org_min
    if org_range <= 0:
        return 0.5

    return min(overlap_range / org_range, 1.0)


def _deadline_score(close_date: str) -> float:
    """Score deadline proximity."""
    if not close_date:
        return 0.4  # Unknown deadline — moderate

    try:
        # Try common date formats
        for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%Y-%m-%dT%H:%M:%S", "%m-%d-%Y"):
            try:
                deadline = datetime.strptime(close_date[:10], fmt)
                break
            except ValueError:
                continue
        else:
            return 0.4

        now = datetime.now()
        days = (deadline - now).days

        if days < 0:
            return 0.0   # Passed
        elif days < 7:
            return 0.5   # Very soon — risky
        elif days <= 30:
            return 1.0   # Sweet spot
        elif days <= 90:
            return 0.8   # Good lead time
        else:
            return 0.4   # Far out

    except Exception:
        return 0.4


def _source_reliability_score(source: str) -> float:
    return SOURCE_RELIABILITY.get(source, 0.5)


def score_grant(grant: dict, org_profile: dict, weights: dict) -> tuple[float, str]:
    """Score a single grant against the org profile. Returns (score, tier)."""
    w_sector = weights.get("sector_match", 0.30)
    w_geo = weights.get("geographic_match", 0.25)
    w_amount = weights.get("amount_fit", 0.20)
    w_deadline = weights.get("deadline_proximity", 0.15)
    w_source = weights.get("source_reliability", 0.10)

    # Parse JSON fields from grant row
    grant_sectors = json.loads(grant.get("sectors_json", "[]") or "[]")
    grant_countries = json.loads(grant.get("countries_json", "[]") or "[]")
    grant_regions = json.loads(grant.get("regions_json", "[]") or "[]")

    org_sectors = json.loads(org_profile.get("sectors_json", "[]") or "[]")
    org_countries = json.loads(org_profile.get("countries_json", "[]") or "[]")
    org_regions = org_profile.get("regions", [])
    if isinstance(org_regions, str):
        org_regions = json.loads(org_regions) if org_regions.startswith("[") else [org_regions]

    sector_val = _sector_score(grant_sectors, org_sectors)
    geo_val = _geographic_score(grant_countries, grant_regions, org_countries, org_regions)
    amount_val = _amount_score(
        grant.get("amount_floor"), grant.get("amount_ceiling"),
        org_profile.get("grant_range_min", 5000),
        org_profile.get("grant_range_max", 250000),
    )
    deadline_val = _deadline_score(grant.get("close_date", ""))
    source_val = _source_reliability_score(grant.get("source", ""))

    score = (
        w_sector * sector_val
        + w_geo * geo_val
        + w_amount * amount_val
        + w_deadline * deadline_val
        + w_source * source_val
    )
    score = round(score, 4)

    tier = "IRRELEVANT"
    for threshold, tier_name in TIER_THRESHOLDS:
        if score >= threshold:
            tier = tier_name
            break

    return score, tier


def score_all_grants(conn: sqlite3.Connection, config: dict):
    """Re-score all grants against the current org profile."""
    weights = config.get("scoring", {})

    org_row = conn.execute("SELECT * FROM org_profile WHERE id = 1").fetchone()
    if not org_row:
        logger.warning("No org profile found — cannot score grants")
        return

    org_profile = dict(org_row)
    # Add regions from config since they're not in the DB table
    org_profile["regions"] = config.get("org_profile", {}).get("regions", [])

    grants = conn.execute("SELECT * FROM grants").fetchall()
    logger.info(f"Scoring {len(grants)} grants")

    tier_counts = {}
    for grant in grants:
        g = dict(grant)
        score, tier = score_grant(g, org_profile, weights)
        conn.execute(
            "UPDATE grants SET relevance_score = ?, relevance_tier = ?, last_updated_at = datetime('now') WHERE id = ?",
            (score, tier, g["id"]),
        )
        tier_counts[tier] = tier_counts.get(tier, 0) + 1

    conn.commit()

    for tier_name in ["HIGH", "MEDIUM", "LOW", "IRRELEVANT"]:
        logger.info(f"  {tier_name}: {tier_counts.get(tier_name, 0)}")
