// STALE-INGEST-AUDIT (KT #238). Closes the visibility gap that let the
// 2026-06-12 incident go undetected for hours: two PDFs + multiple expense
// lines were dropped between routing and applying with zero alarm. State
// machines need a stuck-state alert path.
//
// Every 4h this cron:
//   1. Finds ingest_items with status='routed' AND applied=false AND created
//      more than 24h ago. Groups by routed_to (finance, brain, beneficiary,
//      etc.).
//   2. Finds inbound messages older than 24h that LOOK like expense lines
//      (Ksh|KES|sh + amount-shape token) but have no resulting action_intent
//      OR pending approval tied via correlation_id = message.id. These are
//      parsePayment-dropped candidates.
//   3. If anything is found, hashes the alertable set (sorted IDs) and checks
//      audit_alerts: skip if the SAME hash was sent in the last 12h
//      (idempotency). Otherwise send ONE summary message via sendTextAndLog
//      to devPhone() with `dev: true` (Law 12). The dev branch skips the
//      messages-table insert so Nur never sees this, and the [DEV] prefix is
//      auto-added.
//
// Auth: standard Bearer CRON_SECRET (matches reminders/v1-soak-watchdog).
// Manual sweep: `?force=1` skips the dedup check, useful for the initial
// triggering and incident soak. `?dry=1` returns what would alert without
// sending or writing the ledger row.

import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { admin } from "../../../../lib/supabase-admin";
import { emit } from "../../../../lib/events";
import { sendTextAndLog, devPhone } from "../../../../lib/whatsapp";
import { buildAlert } from "./_build";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STALE_HOURS = 24;
const DEDUP_HOURS = 12;
// Expense-shape: Ksh/KES/sh/shillings + amount-like number, OR an amount-like
// number followed by ksh/kes. Hyphen-payee-first ("Sanara trainer-Ksh 25,000")
// matches because the second branch covers "<word>-Ksh <num>" too.
const EXPENSE_REGEX = /(?:\b(?:ksh|kes|sh|shillings?)\b[\s.:-]*[\d,]{2,}|\b[\d,]{2,}\s*(?:ksh|kes|sh|\/=))/i;

function authed(req: NextRequest): boolean {
  const auth = req.headers.get("authorization") || "";
  const cron = process.env.CRON_SECRET, agent = process.env.AGENT_TICK_SECRET;
  const qs = new URL(req.url).searchParams.get("key");
  if (cron && auth === `Bearer ${cron}`) return true;
  if (agent && (req.headers.get("x-agent-secret") === agent || qs === agent)) return true;
  return false;
}

async function tick(opts: { force: boolean; dry: boolean }) {
  const db = admin();
  const cutoff = new Date(Date.now() - STALE_HOURS * 3600_000).toISOString();

  // Q1: stale routed-but-not-applied ingest_items.
  const { data: staleRows, error: staleErr } = await db
    .from("ingest_items")
    .select("id, routed_to, filename, created_at, status, applied")
    .eq("status", "routed")
    .eq("applied", false)
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(200);
  if (staleErr) {
    await emit({ type: "stale_ingest_audit.error", source: "cron:stale-ingest-audit", actor: "system", subject_type: "incident", subject_id: null, payload: { stage: "query_stale_ingest", error: String(staleErr.message || staleErr).slice(0, 240) } });
  }

  // Q2: expense-shape inbound with no intent/approval anchor. We pull seen-
  // status inbound from the last 7d but older than 24h, regex-filter
  // expense-shape in memory (the regex is too rich for postgrest), then
  // exclude any whose id appears as action_intents.correlation_id.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const { data: inbound, error: inErr } = await db
    .from("messages")
    .select("id, body, created_at, status, direction")
    .eq("direction", "in")
    .gte("created_at", sevenDaysAgo)
    .lt("created_at", cutoff)
    .limit(2000);
  if (inErr) {
    await emit({ type: "stale_ingest_audit.error", source: "cron:stale-ingest-audit", actor: "system", subject_type: "incident", subject_id: null, payload: { stage: "query_messages", error: String(inErr.message || inErr).slice(0, 240) } });
  }
  const expenseShaped = ((inbound || []) as any[]).filter((m) => {
    const b = String(m.body || "");
    if (b.length < 4) return false;
    return EXPENSE_REGEX.test(b);
  });
  // Anchor check: anything with a matching action_intents.correlation_id is
  // accounted for (gateway action created from this message).
  const droppedExpense: Array<{ id: string; body: string; created_at: string }> = [];
  if (expenseShaped.length) {
    const ids = expenseShaped.map((m) => m.id);
    const { data: anchored } = await db
      .from("action_intents")
      .select("correlation_id")
      .in("correlation_id", ids);
    const anchoredSet = new Set(((anchored || []) as any[]).map((r) => String(r.correlation_id)));
    for (const m of expenseShaped) {
      if (!anchoredSet.has(String(m.id))) {
        droppedExpense.push({ id: m.id, body: String(m.body || ""), created_at: m.created_at });
      }
    }
  }

  const built = buildAlert({
    staleIngest: ((staleRows || []) as any[]).map((r) => ({ id: r.id, routed_to: r.routed_to, filename: r.filename, created_at: r.created_at })),
    droppedExpense,
  });
  if (!built) {
    return { ok: true, alert: false, stale: (staleRows || []).length, dropped: droppedExpense.length };
  }

  // Idempotency: skip if same hash sent within DEDUP_HOURS, unless force=1.
  if (!opts.force) {
    const dedupCutoff = new Date(Date.now() - DEDUP_HOURS * 3600_000).toISOString();
    const { data: recent } = await db
      .from("audit_alerts")
      .select("id, sent_at")
      .eq("hash", built.hash)
      .gte("sent_at", dedupCutoff)
      .limit(1);
    if (recent && recent[0]) {
      return { ok: true, alert: true, sent: false, reason: "dedup_window", hash: built.hash, last_sent: recent[0].sent_at, counts: built.counts };
    }
  }

  if (opts.dry) {
    return { ok: true, alert: true, sent: false, reason: "dry_run", kind: built.kind, hash: built.hash, counts: built.counts, body_preview: built.body.slice(0, 240) };
  }

  // Write ledger BEFORE send so a crash on send doesn't cause infinite re-fire
  // (we prefer "alert lost on crash" over "spam loop").
  const alertId = "aa_" + crypto.randomBytes(8).toString("hex");
  await db.from("audit_alerts").insert({
    id: alertId,
    kind: built.kind,
    hash: built.hash,
    payload: { counts: built.counts, body_preview: built.body.slice(0, 600) },
  });

  // Law 12 dev-mode chokepoint. Reroutes to Taona, [DEV] prefix auto-added,
  // skips messages-table insert so Nur never sees it.
  const sendRes = await sendTextAndLog(db, devPhone(), built.body, { dev: true, handledBy: "system" });
  await emit({
    type: "stale_ingest_audit.alert",
    source: "cron:stale-ingest-audit",
    actor: "system",
    subject_type: "incident",
    subject_id: null,
    payload: { alert_id: alertId, kind: built.kind, hash: built.hash, counts: built.counts, send_ok: !!sendRes?.id },
  });

  return { ok: true, alert: true, sent: true, kind: built.kind, hash: built.hash, alert_id: alertId, counts: built.counts };
}

async function handle(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const dry = url.searchParams.get("dry") === "1";
  try {
    const r = await tick({ force, dry });
    return NextResponse.json(r);
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message || err).slice(0, 300) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
