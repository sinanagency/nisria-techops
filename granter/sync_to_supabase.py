#!/usr/bin/env python3
"""Bridge: run the grant hunter sources + scoring, then push scored opportunities
into the Command Center's Supabase (grant_opportunities). Run from granter/:
    python sync_to_supabase.py
Recurring: schedule this (Railway/cron) so the Grants tab stays fresh.
"""
from __future__ import annotations
import asyncio, json, os, subprocess, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from src.common.config import load_config
from src.common.db import get_db, ensure_tables, seed_org_profile, seed_source_status
from src.common.rate_budget import RateBudget
from src.common.http_client import CachedHttpClient
from src.scoring.relevance import score_all_grants
from src.sources.grants_gov import GrantsGovSource
from src.sources.worldbank import WorldBankSource
from src.sources.iati import IATISource
from src.sources.usaspending import USASpendingSource
from src.sources.propublica import ProPublicaSource

REF = os.environ.get("SUPABASE_REF", "ptvhqudonvvszupzhcfl")
# token from env (CI/Railway) or macOS Keychain (local)
SB = os.environ.get("SUPABASE_MGMT_TOKEN") or subprocess.run(
    ["security", "find-generic-password", "-l", "bu-supabase-token", "-w"],
    capture_output=True, text=True).stdout.strip()
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
E = lambda s: "NULL" if s in (None, "") else "'" + str(s).replace("'", "''") + "'"
NUM = lambda x: "NULL" if x in (None, "") else str(float(x))


def sql(q):
    p = subprocess.run(["curl", "-s", "-X", "POST",
        f"https://api.supabase.com/v1/projects/{REF}/database/query",
        "-H", f"Authorization: Bearer {SB}", "-H", "Content-Type: application/json",
        "-A", UA, "--data", "@-"], input=json.dumps({"query": q}), capture_output=True, text=True)
    return p.stdout


async def refresh_all(config):
    conn = get_db()
    ensure_tables(conn); seed_org_profile(conn, config); seed_source_status(conn, config)
    budget = RateBudget(conn)
    keywords = config.get("org_profile", {}).get("search_keywords", [])
    for cls in [GrantsGovSource, WorldBankSource, IATISource, USASpendingSource, ProPublicaSource]:
        try:
            http = CachedHttpClient(conn, rate_budget=budget)
            n = await cls(http, conn, config).refresh(keywords)
            print(f"{cls.SOURCE_NAME}: {n} grants")
            await http.close()
        except Exception as e:
            print(f"{cls.SOURCE_NAME} FAILED: {e}")
    try:
        score_all_grants(conn, config)
    except Exception as e:
        print(f"scoring failed: {e}")
    return conn


def push(conn):
    rows = conn.execute(
        "SELECT source,source_id,title,description,agency,amount_floor,amount_ceiling,"
        "currency,status,close_date,url,sectors_json,countries_json,relevance_score,relevance_tier "
        "FROM grants WHERE relevance_tier IN ('HIGH','MEDIUM','LOW') ORDER BY relevance_score DESC LIMIT 300"
    ).fetchall()
    if not rows:
        print("no scored grants to push"); return
    def arr(j):
        try:
            items = json.loads(j or "[]")
            return "ARRAY[" + ",".join(E(str(x)) for x in items) + "]::text[]" if items else "'{}'::text[]"
        except Exception:
            return "'{}'::text[]"
    vals = []
    for r in rows:
        d = dict(r)
        vals.append("(" + ",".join([
            E(d["source"]), E(d["source_id"]), E((d["title"] or "")[:400]), E((d["description"] or "")[:1500]),
            E(d["agency"]), NUM(d["amount_floor"]), NUM(d["amount_ceiling"]), E(d["currency"] or "USD"),
            E(d["status"]), E(d["close_date"]), E(d["url"]), arr(d["sectors_json"]), arr(d["countries_json"]),
            NUM(d["relevance_score"]), E(d["relevance_tier"]),
        ]) + ")")
    q = ("INSERT INTO grant_opportunities (source,source_id,title,description,funder,amount_floor,"
         "amount_ceiling,currency,status,close_date,url,sectors,countries,relevance_score,relevance_tier) VALUES "
         + ",".join(vals) +
         " ON CONFLICT (source,source_id) DO UPDATE SET relevance_score=excluded.relevance_score,"
         " relevance_tier=excluded.relevance_tier, close_date=excluded.close_date, last_updated_at=now();")
    print("push result:", sql(q)[:200])
    print("count:", sql("select count(*) n, count(*) filter (where relevance_tier='HIGH') high from grant_opportunities;"))


if __name__ == "__main__":
    config = load_config()
    conn = asyncio.run(refresh_all(config))
    push(conn)
    conn.close()
