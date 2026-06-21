// TIMED REMINDER FIRING (Field-nervous-system law, the at-the-time path).
//
// create_task time=HH:MM and a timed create_event store a time-of-day, but a
// once-a-day cron can never fire AT that time. This route is hit every 5 minutes
// by Supabase pg_cron (the same managed path as the worker drain, because Vercel
// Hobby only allows DAILY crons). On each tick it finds anything due NOW in the
// operator's timezone that has not yet been pinged, fires the WhatsApp reminder,
// and stamps reminded_at so it fires exactly once (idempotent, Real-action law).
//
// "due now" = scheduled for today, time-of-day <= the current time, and not yet
// reminded. The <= (not ==) catches a tick that lands a few minutes late, while
// reminded_at guarantees a single ping. Past times earlier today still fire once
// on the first tick after this route goes live, which is the honest behaviour
// (better a late ping than a silent miss); reminded_at then closes them out.

import { NextRequest, NextResponse } from "next/server";
import { admin } from "../../../../lib/supabase-admin";
import { now } from "../../../../lib/now";
import { pushTaskDigest, pushCalendarAlert } from "../../../../lib/notify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authed(req: NextRequest): boolean {
  const auth = req.headers.get("authorization") || "";
  const cron = process.env.CRON_SECRET, agent = process.env.AGENT_TICK_SECRET, group = process.env.GROUP_BOT_SECRET;
  const qs = new URL(req.url).searchParams.get("key");
  if (cron && auth === `Bearer ${cron}`) return true;
  if (agent && (req.headers.get("x-agent-secret") === agent || qs === agent)) return true;
  if (group && (req.headers.get("x-group-secret") === group || qs === group)) return true;
  return false;
}

// Current HH:MM in a given IANA timezone.
function hhmmIn(tz: string, d: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const h = parts.find((p) => p.type === "hour")?.value || "00";
  const m = parts.find((p) => p.type === "minute")?.value || "00";
  return `${h}:${m}`;
}

// Minutes-since-midnight for an "HH:MM" string (robust integer compare, avoids the
// string-comparison hour/day-boundary bugs). Non-parseable → -1 (never matches).
function minutesOf(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})/.exec(String(hhmm || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
}

// Lead time: remind LEAD_MIN minutes BEFORE the due time (operator asked for a
// 5-minute heads-up, 2026-06-20). A task/event is "due" the moment it falls inside
// the next LEAD_MIN window, so a 21:00 task fires at the 20:55 tick. Past times
// still fire once (catch-up) because dueMinutes <= nowMinutes < nowMinutes+LEAD.
const LEAD_MIN = 5;

async function run(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const db = admin();
  const n = await now();
  const today = n.today;
  const nowHHMM = hhmmIn(n.tz, n.date);
  // Fire anything due within the next LEAD_MIN minutes (the 5-min heads-up).
  const fireThreshold = minutesOf(nowHHMM) + LEAD_MIN;

  // 1) Tasks with a due_time, due today, time has arrived, not yet pinged.
  const { data: taskRows } = await db
    .from("tasks")
    .select("id,title,due_on,due_time,priority,assignee_id")
    .neq("status", "done")
    .eq("due_on", today)
    .not("due_time", "is", null)
    .is("reminded_at", null)
    .limit(100);
  // Anti-spam (KT, 2026-06-15): group due-now tasks by assignee_id and fire
  // ONE digest per assignee, not one push per row. On 2026-06-15 10:00:06-10:00:17
  // Dubai, Nur received 6 separate WhatsApp pings in 11 seconds because the old
  // per-task loop sent one task_alert per matched row. pushTaskDigest collapses
  // those into a single message ("you have N tasks due now: • ... • ...") and
  // routes recipients with the same operator/bot_access logic as pushTaskAlert.
  // For N=1 the digest delegates back to pushTaskAlert so the single-task
  // Meta-approved template path is preserved exactly.
  const dueNow: any[] = [];
  for (const t of (taskRows || []) as any[]) {
    if (minutesOf(String(t.due_time)) > fireThreshold) continue; // not yet within the 5-min lead window
    dueNow.push(t);
  }
  // RACE-2 atomic claim (Field-nervous-system + Real-action laws, 2026-06-15).
  // The old shape sent the digest THEN stamped reminded_at. Two overlapping cron
  // ticks (Vercel cron lag, or pg_cron retry) could both pull the same row in
  // SELECT...IS NULL and both call pushTaskDigest before either UPDATE landed,
  // so Nur would get the SAME task in two separate digests. The fix: claim the
  // rows by UPDATE first with .is("reminded_at", null) as a guard, then SEND
  // only the ids we actually claimed. Postgres serialises the UPDATE per row,
  // so exactly one tick wins per task. The RETURNING (via .select("id")) tells
  // us which ones we got. Anything filtered out was already claimed by the
  // other tick and must not be re-sent.
  const ids = dueNow.map((t) => t.id).filter(Boolean);
  let tasksToSend: any[] = [];
  if (ids.length) {
    const { data: claimed } = await db
      .from("tasks")
      .update({ reminded_at: n.iso })
      .in("id", ids)
      .is("reminded_at", null)
      .select("id");
    const claimedIds = new Set(((claimed || []) as any[]).map((r) => r.id));
    tasksToSend = dueNow.filter((t) => claimedIds.has(t.id));
  }
  // Group the CLAIMED tasks by assignee_id (null bucket goes to Nur via the
  // digest's recipient resolution, the same routing pushTaskAlert applies
  // when assignee_id is null).
  const byAssignee = new Map<string, any[]>();
  for (const t of tasksToSend) {
    const key = t.assignee_id || "__nur__";
    const bucket = byAssignee.get(key) || [];
    bucket.push(t);
    byAssignee.set(key, bucket);
  }
  let tasksFired = 0;
  for (const [, bucket] of byAssignee) {
    const items = bucket.map((t) => ({ id: t.id, title: t.title, due_on: t.due_on, due_time: t.due_time, priority: t.priority, assignee_id: t.assignee_id }));
    // The cron path passes dev:false implicitly. To smoke-test on the dev phone,
    // invoke the route with ?dev=1 (still authed) and pass it through here.
    const r = await pushTaskDigest(db, items);
    // reminded_at was already stamped by the atomic claim above. The .in() ids
    // mirror exactly the rows we picked for THIS digest, so the next 5-min
    // tick cannot re-fire any of them. Critically we no longer need the
    // post-send UPDATE because the claim closed them out before the network
    // call to Meta.
    if (r.pinged.length) tasksFired++;
  }

  // 2) Calendar events with a start_time, today, time arrived, not yet pinged.
  const { data: evRows } = await db
    .from("calendar_events")
    .select("id,title,starts_on,start_time,location,kind")
    .eq("starts_on", today)
    .not("start_time", "is", null)
    .is("reminded_at", null)
    .limit(100);
  let eventsFired = 0;
  for (const e of (evRows || []) as any[]) {
    if (minutesOf(String(e.start_time)) > fireThreshold) continue; // 5-min lead, same as tasks
    // Atomic claim: UPDATE reminded_at FIRST, only send if we won the race.
    // Mirrors the task pattern above (lines 83-91) to prevent double-sends
    // when two cron ticks overlap.
    const { data: claimed } = await db.from("calendar_events").update({ reminded_at: n.iso }).eq("id", e.id).is("reminded_at", null).select("id").maybeSingle();
    if (!claimed) continue;
    const when = `${e.starts_on} at ${String(e.start_time).slice(0, 5)}`;
    const r = await pushCalendarAlert(db, { id: e.id, title: e.title, when, location: e.location, kind: e.kind }, "now");
    if (r.pinged.length) eventsFired++;
  }

  return NextResponse.json({ ok: true, now: nowHHMM, tz: n.tz, tasks_fired: tasksFired, events_fired: eventsFired });
}

export async function GET(req: NextRequest) { return run(req); }
export async function POST(req: NextRequest) { return run(req); }
