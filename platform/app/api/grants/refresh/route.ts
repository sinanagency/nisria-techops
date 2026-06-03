// Self-hosted grant discovery: fetches Grants.gov + the World Bank Projects API
// (both free, no key) for Nisria-fit opportunities, scores relevance, and upserts
// into grant_opportunities. Driven by Supabase pg_cron (daily) — same mechanism
// as the agent tick. No Python host needed. The richer multi-source Python engine
// (granter/) stays available for offline / CI runs.
import { NextRequest, NextResponse } from "next/server";
import { admin } from "../../../../lib/supabase-admin";
import { emit } from "../../../../lib/events";
import { autoPursueHighOpportunities } from "../../../../lib/agents/grant-autoprepare";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Nisria fit: children/education/nutrition/women + Kenya/Africa, $5k–$250k range.
const KW = ["child", "children", "orphan", "education", "school", "nutrition", "feeding", "women", "empowerment", "family", "families", "vulnerable", "youth", "community", "welfare", "poverty", "girls"];
const GEO = ["kenya", "africa", "east africa", "sub-saharan", "international", "global", "developing", "overseas"];
const QUERIES = ["children welfare Africa", "education Kenya", "child nutrition", "women empowerment Africa", "orphans vulnerable children", "international development education"];
const WB_QUERIES = ["children education Kenya", "child nutrition Africa", "women empowerment", "vulnerable children", "community education development"];

function score(title: string, agency: string): { s: number; tier: string } {
  const t = `${title} ${agency}`.toLowerCase();
  const kw = KW.filter((k) => t.includes(k)).length;
  const sector = Math.min(1, kw / 3);
  const geo = GEO.some((g) => t.includes(g)) ? 1 : 0.35;
  const s = Math.min(1, 0.15 + 0.55 * sector + 0.3 * geo);
  const tier = s >= 0.68 ? "HIGH" : s >= 0.45 ? "MEDIUM" : "LOW";
  return { s: Math.round(s * 100) / 100, tier };
}

// Bound every upstream call so one slow/hanging API cannot blow the 60s budget
// (heal #4: 11 sequential fetches with no timeout). On abort/error: return null,
// the callers treat that exactly like a non-ok response and skip the query.
async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 8000): Promise<Response | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); }
  catch { return null; }
  finally { clearTimeout(t); }
}

async function searchGrantsGov(keyword: string) {
  const r = await fetchWithTimeout("https://api.grants.gov/v1/api/search2", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rows: 40, keyword, oppStatuses: "forecasted|posted", eligibilities: "", agencies: "", aln: "", fundingCategories: "" }),
    cache: "no-store",
  });
  if (!r || !r.ok) return [];
  const j = await r.json();
  return j?.data?.oppHits || [];
}

// World Bank Projects API (no key). `projects` comes back as an object keyed by
// project id, so we take the values. These are funded operations by country —
// useful as partnership / co-funding signal even though they aren't open RFPs.
async function searchWorldBank(keyword: string) {
  const url = `https://search.worldbank.org/api/v2/projects?format=json&rows=30&qterm=${encodeURIComponent(keyword)}&fl=id,project_name,countryshortname,closingdate,boardapprovaldate,url,sector1,status`;
  const r = await fetchWithTimeout(url, { cache: "no-store" });
  if (!r || !r.ok) return [];
  const j = await r.json();
  return Object.values(j?.projects || {}) as any[];
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
  for (const q of WB_QUERIES) {
    try {
      const hits = await searchWorldBank(q);
      for (const h of hits) {
        const id = h.id;
        if (!id) continue;
        const st = (h.status || "").toLowerCase();
        if (st === "closed" || st === "dropped") continue; // only live/pipeline operations
        const key = `wb:${id}`;
        if (seen.has(key)) continue;
        const country = h.countryshortname || "";
        const sector = h.sector1?.Name || "";
        const { s, tier } = score(h.project_name || "", `${country} ${sector} world bank`);
        if (tier === "LOW" && s < 0.4) continue;
        seen.set(key, {
          source: "worldbank", source_id: String(id),
          title: (h.project_name || "").slice(0, 400),
          description: country ? `World Bank operation · ${country}` : "World Bank operation",
          funder: "World Bank", currency: "USD",
          status: (h.status || "active").toLowerCase(),
          close_date: h.closingdate || "",
          url: h.url || `https://projects.worldbank.org/en/projects-operations/project-detail/${id}`,
          relevance_score: s, relevance_tier: tier,
        });
      }
    } catch { /* skip a failed query */ }
  }
  const rows = [...seen.values()];
  const bySource = (src: string) => rows.filter((r) => r.source === src).length;
  if (rows.length) {
    await db.from("grant_opportunities").upsert(rows, { onConflict: "source,source_id" });
    await emit({ type: "grants.refreshed", source: "grant-hunter", actor: "system", payload: { grants_gov: bySource("grants_gov"), worldbank: bySource("worldbank"), found: rows.length, high: rows.filter((r) => r.relevance_tier === "HIGH").length } });
  }

  // After the hunt, AUTO-PURSUE the strongest finds into the pipeline so they
  // are queued for preparation. This is the cheap half (no Claude). The actual
  // package PREPARATION runs in its own invocation (the daily cron tick and the
  // "Prepare all ready" button), because the hunt's many external calls already
  // consume most of the 60s serverless budget and a full prepare is ~15-25s.
  // autoPursueHighOpportunities is the cheap half of the shared auto-prepare
  // helper, exported standalone so refresh runs only the pursue step (no Claude).
  let pursued = 0;
  try {
    const before = await db.from("grant_applications").select("id", { count: "exact", head: true });
    await autoPursueHighOpportunities();
    const after = await db.from("grant_applications").select("id", { count: "exact", head: true });
    pursued = Math.max(0, (after.count || 0) - (before.count || 0));
  } catch { /* never let pursue failure break the hunt result */ }

  return { found: rows.length, grants_gov: bySource("grants_gov"), worldbank: bySource("worldbank"), high: rows.filter((r) => r.relevance_tier === "HIGH").length, medium: rows.filter((r) => r.relevance_tier === "MEDIUM").length, auto_pursued: pursued };
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
