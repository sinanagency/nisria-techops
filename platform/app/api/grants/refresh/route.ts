// Self-hosted grant discovery: fetches Grants.gov (free, no key) for Nisria-fit
// opportunities, scores relevance, and upserts into grant_opportunities.
// Driven by Supabase pg_cron (daily) — same mechanism as the agent tick.
// No Python host needed. The richer multi-source Python engine (granter/) stays
// available for offline / CI runs.
import { NextRequest, NextResponse } from "next/server";
import { admin } from "../../../../lib/supabase-admin";
import { emit } from "../../../../lib/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Nisria fit: children/education/nutrition/women + Kenya/Africa, $5k–$250k range.
const KW = ["child", "children", "orphan", "education", "school", "nutrition", "feeding", "women", "empowerment", "family", "families", "vulnerable", "youth", "community", "welfare", "poverty", "girls"];
const GEO = ["kenya", "africa", "east africa", "sub-saharan", "international", "global", "developing", "overseas"];
const QUERIES = ["children welfare Africa", "education Kenya", "child nutrition", "women empowerment Africa", "orphans vulnerable children", "international development education"];

function score(title: string, agency: string): { s: number; tier: string } {
  const t = `${title} ${agency}`.toLowerCase();
  const kw = KW.filter((k) => t.includes(k)).length;
  const sector = Math.min(1, kw / 3);
  const geo = GEO.some((g) => t.includes(g)) ? 1 : 0.35;
  const s = Math.min(1, 0.15 + 0.55 * sector + 0.3 * geo);
  const tier = s >= 0.68 ? "HIGH" : s >= 0.45 ? "MEDIUM" : "LOW";
  return { s: Math.round(s * 100) / 100, tier };
}

async function searchGrantsGov(keyword: string) {
  const r = await fetch("https://api.grants.gov/v1/api/search2", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rows: 40, keyword, oppStatuses: "forecasted|posted", eligibilities: "", agencies: "", aln: "", fundingCategories: "" }),
    cache: "no-store",
  });
  if (!r.ok) return [];
  const j = await r.json();
  return j?.data?.oppHits || [];
}

async function run() {
  const db = admin();
  const seen = new Map<string, any>();
  for (const q of QUERIES) {
    try {
      const hits = await searchGrantsGov(q);
      for (const h of hits) {
        const num = h.number || h.id;
        if (!num || seen.has(num)) continue;
        const { s, tier } = score(h.title || "", h.agency || h.agencyCode || "");
        if (tier === "LOW" && s < 0.4) continue; // drop the clearly-irrelevant
        seen.set(num, {
          source: "grants_gov", source_id: String(num),
          title: (h.title || "").slice(0, 400), description: "",
          funder: h.agency || h.agencyCode || "US Federal",
          currency: "USD", status: (h.oppStatus || "posted").toLowerCase(),
          close_date: h.closeDate || "", url: `https://www.grants.gov/search-results-detail/${h.id}`,
          relevance_score: s, relevance_tier: tier,
        });
      }
    } catch { /* skip a failed query */ }
  }
  const rows = [...seen.values()];
  if (rows.length) {
    await db.from("grant_opportunities").upsert(rows, { onConflict: "source,source_id" });
    await emit({ type: "grants.refreshed", source: "grant-hunter", actor: "system", payload: { source: "grants_gov", found: rows.length, high: rows.filter((r) => r.relevance_tier === "HIGH").length } });
  }
  return { found: rows.length, high: rows.filter((r) => r.relevance_tier === "HIGH").length, medium: rows.filter((r) => r.relevance_tier === "MEDIUM").length };
}

function authed(req: NextRequest) {
  const agent = process.env.AGENT_TICK_SECRET, cron = process.env.CRON_SECRET;
  const h = req.headers.get("x-agent-secret"); const auth = req.headers.get("authorization") || "";
  const qs = new URL(req.url).searchParams.get("key");
  return (agent && (h === agent || qs === agent)) || (cron && auth === `Bearer ${cron}`);
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await run());
}
export async function GET(req: NextRequest) {
  if (authed(req)) return NextResponse.json(await run());
  return NextResponse.json({ ok: true, note: "POST with x-agent-secret to refresh grant opportunities" });
}
