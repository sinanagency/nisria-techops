# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

Nisria Grant Finder — a free grant discovery platform for Nisria Foundation (registered USA + Kenya, operating in Kenya). Aggregates grants from 6 public APIs, scores them for relevance, and provides a web dashboard for search, tracking, and funder research. Built with FastAPI, SQLite (FTS5), and Bootstrap 5.

## Architecture

Single SQLite database (`db/grants.db`, WAL mode) with FTS5 virtual tables for full-text search. All external API calls go through `CachedHttpClient` which provides 3-tier caching (fresh cache -> live API -> stale cache fallback). Background refresh via APScheduler.

**Data flow:**
```
6 Sources (Grants.gov, SAM.gov, USASpending, World Bank, ProPublica, IATI)
    → CachedHttpClient (HTTP cache + rate budget)
        → GrantSource.fetch_grants() / refresh()
            → GrantRecord.upsert() into SQLite
                → FTS5 triggers auto-update search index
                    → score_all_grants() assigns relevance tiers
```

**Key directories:**
- `src/common/` — Shared: config, db, HTTP client, rate budget
- `src/sources/` — One file per API source, all extend `GrantSource` base
- `src/scoring/` — 5-signal weighted relevance scoring
- `src/scheduler/` — APScheduler background refresh jobs
- `src/web/` — FastAPI app factory + route modules
- `src/letter/` — Cold outreach letter generator
- `templates/` — Jinja2 HTML templates (Bootstrap 5)
- `static/` — CSS + JS

## Commands

```bash
# Setup
pip install -r requirements.txt
cp config/config.example.yaml config/config.yaml  # then customize
cp .env.example .env                               # add SAM_GOV_API_KEY

# Run server (starts web UI + background scheduler)
python main.py
python main.py --port 9000

# Tests
pytest tests/
pytest tests/test_scoring.py -v
```

## Key Conventions

- All source modules implement `GrantSource` ABC from `src/sources/base.py`
- `GrantRecord.upsert()` handles INSERT OR UPDATE via UNIQUE(source, source_id)
- FTS5 sync is automatic via SQLite triggers (no manual index updates needed)
- HTTP cache uses SHA-256 key of source+url+params, with per-source TTL
- Rate budgets tracked in `api_call_log` table, enforced by `RateBudget` class
- Scoring mirrors the outreach pipeline pattern: 5 weighted signals summing to 1.0
- ProPublica populates `funders` table (not grants) — used for funder research

## API Sources (Corrected Endpoints)

- **Grants.gov**: `POST https://api.grants.gov/v1/api/search2` (no auth)
- **SAM.gov**: `GET https://api.sam.gov/opportunities/v2/search` (free API key, 1000/day)
- **USASpending**: `POST https://api.usaspending.gov/api/v2/search/spending_by_award/` (no auth)
- **World Bank**: `GET https://search.worldbank.org/api/v2/projects` (no auth, NOT api.worldbank.org)
- **ProPublica**: `GET https://projects.propublica.org/nonprofits/api/v2/search.json` (no auth)
- **IATI**: `GET https://datastore.codeforiati.org/api/1/access/activity.json` (no auth)

## Config

`config/config.yaml` (gitignored, copy from `config.example.yaml`). Key sections:
- `org_profile` — Organization info used for relevance scoring
- `sources` — Per-source enable/disable, API keys, cache TTL, daily budgets
- `scoring` — 5-signal weights (must sum to 1.0)
- `server` — Host and port

## Scoring Model

Five weighted signals: sector_match (0.30), geographic_match (0.25), amount_fit (0.20), deadline_proximity (0.15), source_reliability (0.10). Tiers: HIGH (>=0.7), MEDIUM (>=0.4), LOW (>=0.2), IRRELEVANT (<0.2).
