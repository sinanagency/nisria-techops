# Nisria Granter

> [One-line description placeholder — replace this with your own.]

A self-hosted grant discovery platform for Nisria Foundation. Aggregates funding opportunities from 6 public APIs (Grants.gov, SAM.gov, USASpending, World Bank, ProPublica, IATI), scores them for relevance, and provides a web dashboard for search, tracking, funder research, and outreach letter generation.

## Quick Start

```bash
pip install -r requirements.txt
cp config/config.example.yaml config/config.yaml   # then customize
cp .env.example .env                                # add SAM_GOV_API_KEY
python main.py
```

Server runs at **http://localhost:8000**

## Documentation

- [RUNBOOK.md](RUNBOOK.md) — full usage guide, features, and troubleshooting
- [CLAUDE.md](CLAUDE.md) — developer architecture reference

## License

Private — Nisria Foundation internal use.
