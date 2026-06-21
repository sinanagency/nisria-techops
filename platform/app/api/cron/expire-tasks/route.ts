// DATE-PASSED TASK EXPIRY (KT #316). Once a task's due date has passed, "assume
// closed": take it off the active board so the morning brief stops nagging, BUT
// (a) set status to "expired", NEVER "done" — we do not know it was actually done,
// claiming done would be the lie we have spent this whole effort killing; (b)
// archive the lapsed task to agent_memory with topic = the due date, so "what was
// due / lapsed on June 16" is retrievable forever via a tool, never guessed; and
// (c) for high-priority / important tasks, send Nur ONE heads-up so a real
// obligation never silently disappears. She can REOPEN any.
//
// Deterministic job (this is the "use tools / verified facts" half of the
// operator's tool-based-memory doctrine): the cron WRITES the real records; the
// bot later READS them through list_tasks(status=expired) / search_history.
//
// Vercel cron (GET, Bearer CRON_SECRET), scheduled before the morning brief.
import { NextRequest, NextResponse } from "next/server";
import { admin } from "../../../../lib/supabase-admin";
import { emit } from "../../../../lib/events";
import { sendTextAndLog } from "../../../../lib/whatsapp";
import { today as todayIn } from "../../../../lib/now";
import { classifyExpiry } from "./_expire";

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

async function tick({ force }: { force: boolean }): Promise<any> {
  const db = admin();
  // Today's calendar date in Asia/Dubai via the CANONICAL clock (lib/now.ts,
  // DEFAULT_TZ = Asia/Dubai), the SAME source reminders uses. Was a hand-rolled
  // manual four-hour offset that diverged from todayIn() the moment tz config
  // changed (#12 timezone split). One clock, both crons.
  const today = todayIn();

  // Idempotency: one expiry pass per day (a tasks.expired event today) unless forced.
  if (!force) {
    const dayStart = today + "T00:00:00";
    const { data: ran } = await db.from("events").select("id").eq("type", "tasks.expired").gte("created_at", dayStart).limit(1);
    if (ran && ran.length) return { ok: true, skipped: "already ran today" };
  }

  const { data: rows } = await db
    .from("tasks")
    .select("id,title,due_on,status,priority,important,assignee_id")
    .lt("due_on", today)
    .not("due_on", "is", null)
    .in("status", ["todo", "in_progress"]);

  const { expirable, important, normal } = classifyExpiry((rows || []) as any[], today);

  // CHECK THE UPDATE ERROR (integration-verification 2026-06-20). The status
  // mutation MUST be confirmed before we (a) count the row as expired and (b)
  // write the agent_memory "lapsed" record. Until 2026-06-20 this was a fire-
  // and-forget UPDATE: when the tasks_status_check constraint rejected 'expired'
  // (23514), every write failed silently, 0 rows changed, yet the lapsed memory
  // row was still inserted and expirable.length was still reported as expired.
  // That source-of-truth split (memory says lapsed, board says active) is the
  // exact silent-failure class fixed for delete/update/reopen in smart-tools.
  let expiredOk = 0;
  const failedIds: string[] = [];
  for (const t of expirable) {
    // (a) assume closed, but EXPIRED, never done. Confirm the write landed.
    const { error: updErr } = await db.from("tasks").update({ status: "expired" }).eq("id", t.id);
    if (updErr) {
      failedIds.push(t.id);
      await emit({
        type: "tasks.expire_failed",
        source: "cron:expire-tasks",
        actor: "system",
        subject_type: "task",
        subject_id: t.id,
        payload: { date: today, title: String(t.title || "").slice(0, 120), code: (updErr as any)?.code || null, message: String((updErr as any)?.message || updErr).slice(0, 200) },
      }).catch(() => null);
      // Do NOT write the lapsed-memory record for a row that did not actually
      // move: memory must never claim a state the board does not hold.
      continue;
    }
    expiredOk += 1;
    // (b) archive the lapsed fact to memory, tied to the due date for retrieval.
    await db.from("agent_memory").insert({
      kind: "task_lapsed",
      brand: null,
      title: `Lapsed task: ${t.title || "(untitled)"}`,
      content: `Task "${t.title || ""}" was due ${t.due_on} and lapsed without being marked done. It was assumed closed and taken off the active board on ${today}. NOT confirmed done; can be reopened.`,
      topic: String(t.due_on),
      source_type: "task",
      source_id: t.id,
      status: "active",
      metadata: { task_id: t.id, due_on: t.due_on, assignee_id: t.assignee_id || null, priority: t.priority || null, important: !!t.important, was: t.status },
    });
  }

  // (c) heads-up to Nur for the important ones — never let a real obligation
  // vanish silently. She can REOPEN any. Only mention rows that ACTUALLY moved
  // off the board (a failed UPDATE means the task is still active; do not tell
  // Nur it was filed when it was not).
  let notified = 0;
  const importantExpired = important.filter((t) => !failedIds.includes(t.id));
  if (importantExpired.length) {
    const lines = importantExpired.map((t) => `• ${t.title} (was due ${t.due_on})`).join("\n");
    const msg = `A few important tasks passed their date, so I have moved them off the active list. I have NOT marked them done, just filed them by date. Reply with REOPEN and the name to bring any back:\n${lines}`;
    const nur = process.env.NUR_WHATSAPP;
    if (nur) { try { await sendTextAndLog(db, nur, msg, { handledBy: "sasa" }); notified = 1; } catch { /* never block */ } }
  }

  await emit({
    type: "tasks.expired",
    source: "cron:expire-tasks",
    actor: "system",
    subject_type: "task",
    subject_id: null,
    // expired = rows that ACTUALLY moved to 'expired' (expiredOk), not merely the
    // count of candidates. failed surfaces any rejected writes so a constraint
    // regression is loud, never silent.
    payload: { date: today, expired: expiredOk, candidates: expirable.length, failed: failedIds.length, important: importantExpired.length, normal: normal.length, notified },
  });

  return { ok: true, date: today, expired: expiredOk, candidates: expirable.length, failed: failedIds.length, important: importantExpired.length, normal: normal.length, notified };
}

async function handle(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const force = new URL(req.url).searchParams.get("force") === "1";
  try {
    return NextResponse.json(await tick({ force }));
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message || err).slice(0, 300) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
