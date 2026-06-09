// V1 SOAK WATCHDOG (Sasa 727 v1). Every 30 minutes, check whether the v1
// soak window is open and what it should do about it.
//
// State register: bot_status.key='v1_soak_start' carries { started_at, sha,
// branch }. The deploy script writes it once flags are flipped; this cron
// disarms it after the verdict ping. Three outcomes:
//   1. No soak active (key absent or null) -> noop
//   2. < 48h since started_at              -> log "in_soak hour N of 48"
//   3. >= 48h since started_at:
//      a. Run verification SQL (Q1 + Q2 in FROZEN-SPEC §15)
//      b. Q2 == 0 lying-done events     -> ping FIXED, disarm
//      c. Q2 >= 1 lying-done events     -> ping FAILED, try flag flip, disarm
//
// Gated by V1_SOAK_WATCHDOG_ENABLED so we don't poll the DB once the soak is
// done. Best-effort throughout; failures emit events and never crash the cron.

import { NextRequest, NextResponse } from "next/server";
import { admin } from "../../../../lib/supabase-admin";
import { emit } from "../../../../lib/events";
import { pushIncident } from "../../../../lib/notify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SOAK_KEY = "v1_soak_start";
const SOAK_HOURS = 48;

function authed(req: NextRequest): boolean {
  const auth = req.headers.get("authorization") || "";
  const cron = process.env.CRON_SECRET, agent = process.env.AGENT_TICK_SECRET;
  const qs = new URL(req.url).searchParams.get("key");
  if (cron && auth === `Bearer ${cron}`) return true;
  if (agent && (req.headers.get("x-agent-secret") === agent || qs === agent)) return true;
  return false;
}

async function tick() {
  if (process.env.V1_SOAK_WATCHDOG_ENABLED !== "1") {
    return { ok: true, skipped: "flag_off" };
  }
  const db = admin();

  const { data: row } = await db.from("bot_status").select("key,value,updated_at").eq("key", SOAK_KEY).maybeSingle();
  if (!row || !row.value || !row.value.started_at) {
    return { ok: true, soak_active: false };
  }
  const started = new Date(row.value.started_at).getTime();
  if (!Number.isFinite(started)) {
    return { ok: false, error: "bad_started_at", value: row.value };
  }
  const elapsedMs = Date.now() - started;
  const elapsedHours = elapsedMs / 3600_000;

  if (elapsedHours < SOAK_HOURS) {
    await emit({
      type: "v1_soak.in_soak",
      source: "cron:v1-soak-watchdog",
      actor: "system",
      subject_type: "incident",
      subject_id: null,
      payload: { hour_n: Math.floor(elapsedHours), hour_total: SOAK_HOURS, started_at: row.value.started_at, sha: row.value.sha || null },
    });
    return { ok: true, soak_active: true, hour: Math.floor(elapsedHours), hour_total: SOAK_HOURS };
  }

  // Soak window elapsed: run the verification queries.
  const startedISO = new Date(started).toISOString();
  // Q1: parsed_task rows created during soak.
  const { count: parsedCount } = await db
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .in("source_kind", ["parsed_task", "parsed_task_from_group"])
    .gte("created_at", startedISO);

  // Q2: lying-done detection. A task-shaped inbound during the soak window
  // with NO matching parsed_task row within 60s AND a Sasa outbound that
  // said "logged"/"created"/"assigned" within 3 min. We approximate with two
  // sequential reads since postgrest can't run the full correlated query in
  // one shot.
  const { data: inbound } = await db
    .from("messages")
    .select("id,contact_id,created_at,body")
    .eq("direction", "in")
    .gte("created_at", startedISO)
    .limit(2000);
  const candidates = ((inbound || []) as any[]).filter((m) => /^(assign|@|remind me|send a reminder)/i.test(String(m.body || "")));
  const lyingDone: any[] = [];
  for (const m of candidates) {
    const lo = new Date(m.created_at).toISOString();
    const hi60 = new Date(new Date(m.created_at).getTime() + 60_000).toISOString();
    const hi3m = new Date(new Date(m.created_at).getTime() + 180_000).toISOString();
    const { data: hasTask } = await db
      .from("tasks")
      .select("id")
      .eq("source_id", m.id)
      .in("source_kind", ["parsed_task", "parsed_task_from_group"])
      .gte("created_at", lo)
      .lte("created_at", hi60)
      .limit(1);
    if (hasTask?.[0]) continue;
    const { data: hasReply } = await db
      .from("messages")
      .select("id,body")
      .eq("contact_id", m.contact_id)
      .eq("direction", "out")
      .gte("created_at", lo)
      .lte("created_at", hi3m)
      .limit(8);
    const reply = ((hasReply || []) as any[]).find((r) => /\b(logged|created|assigned)\b/i.test(String(r.body || "")));
    if (reply) lyingDone.push({ inbound_id: m.id, body: String(m.body || "").slice(0, 120) });
  }

  const verdict = lyingDone.length === 0 && (parsedCount || 0) >= 1 ? "FIXED" : "FAILED";

  await emit({
    type: "v1_soak.verdict",
    source: "cron:v1-soak-watchdog",
    actor: "system",
    subject_type: "incident",
    subject_id: null,
    payload: { verdict, parsed_count: parsedCount || 0, lying_done_count: lyingDone.length, sample: lyingDone.slice(0, 5), elapsed_hours: Math.round(elapsedHours) },
  });

  if (verdict === "FIXED") {
    await pushIncident(
      "Sasa v1 soak complete",
      "Sasa v1 soak complete: FIXED. EXECUTION-RECEIPT and SOAK-SQL-RESULTS on disk. Approve via V1-COMPLETION-REPORT.md.",
    );
  } else {
    // best-effort flag flip via Vercel REST: requires VERCEL_TOKEN +
    // VERCEL_PROJECT_ID configured. Failures are logged, never crash.
    let flipped = false;
    try {
      const token = process.env.VERCEL_TOKEN || "";
      const projectId = process.env.VERCEL_PROJECT_ID || "";
      const teamId = process.env.VERCEL_TEAM_ID || "";
      if (token && projectId) {
        const params = teamId ? `?teamId=${teamId}` : "";
        // We need to delete the existing env then add it as "0". The Vercel
        // API doesn't support a single upsert call.
        const listRes = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env${params}`, {
          headers: { authorization: `Bearer ${token}` },
        });
        const list = await listRes.json();
        const existing = (list.envs || []).find((e: any) => e.key === "PARSE_TASKS_ENABLED" && (e.target || []).includes("production"));
        if (existing?.id) {
          await fetch(`https://api.vercel.com/v9/projects/${projectId}/env/${existing.id}${params}`, {
            method: "DELETE",
            headers: { authorization: `Bearer ${token}` },
          });
        }
        await fetch(`https://api.vercel.com/v9/projects/${projectId}/env${params}`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ key: "PARSE_TASKS_ENABLED", value: "0", target: ["production"], type: "encrypted" }),
        });
        flipped = true;
      }
    } catch (err: any) {
      await emit({ type: "v1_soak.flag_flip_failed", source: "cron:v1-soak-watchdog", actor: "system", subject_type: "incident", subject_id: null, payload: { error: String(err?.message || err).slice(0, 240) } });
    }
    await pushIncident(
      "Sasa v1 soak failed",
      `Sasa v1 soak FAILED: ${lyingDone.length} lying-done event${lyingDone.length === 1 ? "" : "s"} detected.${flipped ? " PARSE_TASKS_ENABLED flipped to 0." : " Flag flip failed; do it manually."} Investigate via SOAK-SQL-RESULTS.md.`,
    );
  }

  // Disarm so the next cron tick noops until the next soak starts.
  // 2026-06-09: was upsert({ value: null }) — bot_status.value is NOT NULL so
  // the disarm failed silently every tick and the cron re-fired the FAILED
  // incident every 30 minutes for ~3 hours, spamming the operator allowlist
  // (including Nur once maintenance flipped off). Switched to DELETE which
  // matches the "is the soak armed?" semantic — armed = row present, disarmed
  // = row absent (matches the check at line 44: `if (!row ...)`).
  await db.from("bot_status").delete().eq("key", SOAK_KEY);

  return { ok: true, verdict, parsed_count: parsedCount || 0, lying_done_count: lyingDone.length };
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const r = await tick();
  return NextResponse.json(r);
}
export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const r = await tick();
  return NextResponse.json(r);
}
