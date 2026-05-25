# Nisria Grant Finder — Runbook

## What This Tool Does

A free, self-hosted grant discovery platform that searches **6 public APIs simultaneously** to find funding opportunities for Nisria Foundation. It replaces paid platforms like Candid ($2,000+/yr), Instrumentl ($179/mo), and Granted.

### Data Sources
| Source | What It Finds | Auth | Rate Limit |
|--------|--------------|------|------------|
| **Grants.gov** | US federal grants (PRIMARY) | None | Unlimited |
| **SAM.gov** | Federal contracts + grants, POC emails | Free API key | 1,000/day |
| **USASpending.gov** | Historical federal award data | None | ~500/day safe |
| **World Bank** | International development projects | None | Unlimited |
| **ProPublica** | Foundation profiles from IRS 990s | None | ~200/day safe |
| **IATI** | International aid (UNDP, USAID, EU, DFID) | None | ~200/day safe |

### Core Features
1. **Unified Search** — One search box queries all 6 sources with FTS5 full-text search
2. **Relevance Scoring** — 5-signal algorithm ranks grants by fit (sector, geography, amount, deadline, source)
3. **Funder Intelligence** — ProPublica 990 data shows foundation assets, giving history, grantees
4. **Grant Tracker** — Kanban pipeline: Identified → Researching → Writing → Submitted → Awarded/Rejected
5. **Auto-Refresh** — Background scheduler pulls new grants every 6-24 hours per source
6. **Letter Generator** — Cold outreach templates in 3 tones (formal, urgent, brief)
7. **CSV Export** — Export any search results or funder list
8. **3-Tier Caching** — Fresh cache → Live API → Stale cache (never completely fails)

---

## How to Run

### First Time Setup
```bash
cd /Users/nurmnasria/Developer/Nisria-Granter

# Install dependencies
pip install -r requirements.txt

# Copy config and customize
cp config/config.example.yaml config/config.yaml
cp .env.example .env

# Optional: add SAM.gov API key to .env
# Get one free at https://sam.gov/content/entity-registration

# Start the server
python main.py
```

Server runs at **http://localhost:8000**

### Daily Use
```bash
# Just start the server — scheduler handles the rest
python main.py
```

The background scheduler will:
- Refresh Grants.gov every 6 hours
- Refresh SAM.gov once daily at 2 AM
- Refresh USASpending every 12 hours
- Refresh World Bank daily at 3 AM
- Refresh ProPublica weekly (Sundays)
- Refresh IATI daily at 5 AM
- Re-score all grants after each refresh
- Mark expired grants as closed

---

## Pages & What They Do

### Dashboard (`/`)
Your home screen. Shows:
- Total grants in database
- Grants closing in next 30 days
- Source health (green/yellow/red per API)
- New grants since last visit
- Quick search bar

### Search (`/grants`)
The main workhorse:
- Type keywords → results from ALL sources
- Filter by: source, status, amount range, deadline
- Results show: title, agency, amount, deadline, relevance tier (HIGH/MEDIUM/LOW)
- Click any grant for full details
- Export results to CSV

### Grant Detail (`/grants/{id}`)
Everything about one grant:
- Full description, eligibility, categories
- Contact info (name, email, phone when available — especially from SAM.gov)
- Link to original source
- Add to tracker pipeline
- Raw API data (collapsible, for power users)

### Funders (`/funders`)
Foundation research from ProPublica:
- Search foundations by keyword
- See: total assets, annual giving, NTEE code, state
- Click for full profile with 990 filing data

### Tracker (`/tracker`)
Kanban pipeline for your applications:
- Drag grants between stages
- Stages: Identified → Researching → Writing → Submitted → Awarded / Rejected
- Notes field per application
- Deadline tracking

### Settings (`/settings`)
Configure your org profile (used for relevance scoring):
- Organization name, mission, sectors
- Target countries/regions
- Grant size range
- Enable/disable individual sources
- API key entry

### Letter Generator (`/letter`)
Generate cold outreach to funders:
- Select a funder from your database
- Choose tone: Formal, Urgent/Human, Brief
- Auto-fills: your org name, mission, funder name, why they're a fit
- Copy output to clipboard

---

## Relevance Scoring

Every grant gets a score (0.0 to 1.0) based on your org profile:

| Signal | Weight | What It Measures |
|--------|--------|-----------------|
| Sector Match | 30% | Do the grant's categories match your sectors? |
| Geographic Match | 25% | Does the grant target your operating countries? |
| Amount Fit | 20% | Is the award range realistic for your org? |
| Deadline Proximity | 15% | Is the deadline in the sweet spot (7-90 days)? |
| Source Reliability | 10% | How authoritative is this data source? |

**Tiers:** HIGH (≥0.7) → MEDIUM (≥0.4) → LOW (≥0.2) → IRRELEVANT (<0.2)

---

## CLI Tools

```bash
# Export grants to CSV
python scripts/export_grants.py --output grants.csv

# Export only HIGH relevance grants
python scripts/export_grants.py --tier HIGH --output hot_grants.csv

# Run tests
pytest tests/ -v
```

---

## Database

Single SQLite file at `db/grants.db`. Created automatically on first run.

```bash
# Backup (just copy the file)
cp db/grants.db db/grants_backup_$(date +%Y%m%d).db
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| SAM.gov returns nothing | Add API key to `.env` — without it, you get 10 req/day |
| Source shows "degraded" | API is down — tool auto-serves cached data with warning |
| No results for search | Try broader keywords; check Settings that source is enabled |
| Server won't start | Run `pip install -r requirements.txt` — missing deps |
| Stale data warning | Normal when cache expires — auto-refreshes on next cycle |

---

## Architecture (for developers)

```
main.py → FastAPI server + APScheduler
  ├── src/common/       → Config, SQLite+FTS5, HTTP caching, rate budgets
  ├── src/sources/      → 6 API adapters (all extend GrantSource base class)
  ├── src/scoring/      → 5-signal relevance engine
  ├── src/scheduler/    → Background refresh jobs
  ├── src/letter/       → Outreach letter generator
  └── src/web/          → Routes + Jinja2 templates
```

All API calls go through `CachedHttpClient` which enforces:
1. Check fresh cache first
2. If expired, call live API
3. If API fails, serve stale cache
4. Track rate budgets per source per day
5. Never exceed daily limits — serve stale instead
