// DAILY REMINDERS (Field-nervous-system law). Once each morning the portal pings
// people about what is due, ROUTED PER ASSIGNEE: each person hears about THEIR
// tasks, not the whole board.
//   - Operators (Nur, the builder) get a rich free-form brief (they live in the
//     24h window, so sendText is fine and they can reply DONE/LIST in line).
//   - Other staff get the daily_brief TEMPLATE (a count + "reply LIST"), because
//     they are off-window and free-form text would silently fail there.
//   - Nur additionally gets the ops roll-up: unassigned tasks, a team-overdue
//     count (the lightweight escalation so she knows who to chase), and Needs You.
// The real-time URGENT path is elsewhere (notify.pushTaskAlert on create_task);
// this is the steady morning heartbeat. Real-time urgent + this daily pass = full
// coverage without a noisy per-event firehose.
//
// Triggered by Vercel cron (GET, Authorization: Bearer CRON_SECRET). Also runnable
// with x-agent-secret / x-group-secret / ?key=. Idempotent per day: a
// reminder.operator_brief event already today means a re-run is skipped (?force=1
// overrides). DELIVERY: sendText only reaches someone inside WhatsApp's 24h window;
// the template path does not have that limit.
import { NextRequest, NextResponse } from "next/server";
import { admin } from "../../../../lib/supabase-admin";
import { emit } from "../../../../lib/events";
import { sendTextAndLog, phoneKey } from "../../../../lib/whatsapp";
import { pushDailyBrief } from "../../../../lib/notify";
import { today as todayIn } from "../../../../lib/now";
import { humanize } from "../../../../lib/humanize";

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

function daysOverdue(dueOn: string, today: string): number {
  const diff = new Date(today).getTime() - new Date(dueOn).getTime();
  return Math.max(0, Math.floor(diff / 86_400_000));
}

function overdueLabel(dueOn: string, today: string): string {
  const d = daysOverdue(dueOn, today);
  if (d === 0) return "due today";
  if (d === 1) return "was due yesterday";
  return `was due ${dueOn} (${d}d overdue)`;
}

// Render a person's own task lines (due today vs overdue) into a short brief body.
// No time-of-day greeting (SPEC §3 forbids — bot does not reliably know local time).
// Task titles run through humanize to prevent vendor/stack name leaks from stored data.
function ownBrief(name: string | null, mine: any[], today: string): string {
  const dueToday = mine.filter((t) => t.due_on === today);
  const overdue = mine.filter((t) => t.due_on < today);
  const blocks: string[] = [];
  if (dueToday.length) blocks.push(`Due today (${dueToday.length}):\n` + dueToday.map((t) => `• ${humanize(String(t.title || ""))}`).join("\n"));
  if (overdue.length) blocks.push(`Overdue (${overdue.length}):\n` + overdue.map((t) => `• ${humanize(String(t.title || ""))} (${overdueLabel(t.due_on, today)})`).join("\n"));
  const hi = name ? name.split(/\s+/)[0] : "there";
  return `${hi}, here is your task summary. ${blocks.join("\n\n")}`;
}

async function run(force: boolean) {
  const db = admin();
  // Dubai morning via the canonical clock (lib/now.ts DEFAULT_TZ = Asia/Dubai).
  // Was: new Date(Date.now() + 4 * 3600e3) hardcoded the +04:00 offset, which
  // works while UAE skips DST but bypasses the single-source-of-now discipline.
  // Routing through today() means a future tz change updates here too.
  const today = todayIn();

  if (!force) {
    const { data: sent } = await db.from("events").select("id").eq("type", "reminder.operator_brief").gte("created_at", today + "T00:00:00Z").limit(1);
    if (sent?.[0]) return { ok: true, skipped: "already sent today", date: today };
  }

  // All OPEN tasks due today or earlier, with assignee. One query.
  const { data: rows } = await db
    .from("tasks").select("title,due_on,status,assignee_id,priority")
    .not("status", "in", "(done,expired)").not("due_on", "is", null).lte("due_on", today)
    .order("due_on", { ascending: true });
  const tasks = (rows || []) as any[];

  // Roster + operator allowlist (Nur + builder).
  const ops = (process.env.WHATSAPP_OPERATORS || "").split(",").map((x) => phoneKey(x)).filter(Boolean);
  const { data: mem } = await db.from("team_members").select("id,name,phone,status,bot_access").limit(400);
  const roster = (mem || []) as any[];
  const isOp = (m: any) => ops.includes(phoneKey(m.phone));

  // Bucket tasks by assignee id; unassigned due tasks are Nur's ops lane.
  const byAssignee = new Map<string, any[]>();
  const unassigned: any[] = [];
  for (const t of tasks) {
    if (t.assignee_id) {
      if (!byAssignee.has(t.assignee_id)) byAssignee.set(t.assignee_id, []);
      byAssignee.get(t.assignee_id)!.push(t);
    } else unassigned.push(t);
  }
  const { count: needsYou } = await db.from("approvals").select("id", { count: "exact", head: true }).eq("status", "pending");
  // The oldest pending approval is the anchor: a stale donor thank-you that
  // sat for 17 days made the morning brief look like noise (06-10 audit). Lead
  // with the OLDEST name so the line is actionable, not a count Nur skims past.
  const { data: oldestPending } = await db
    .from("approvals")
    .select("title, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  // Team-overdue roll-up for Nur (the escalation): overdue tasks owned by NON-operators.
  const teamOverdue = tasks.filter((t) => t.due_on < today && t.assignee_id && !roster.find((m) => m.id === t.assignee_id && isOp(m)));

  const results: any[] = [];

  // 1) Operators: rich sendText brief of THEIR tasks. Nur (an operator on the
  // roster) also gets the unassigned ops tasks, the team-overdue roll-up, Needs You.
  // Identify Nur SPECIFICALLY via NUR_WHATSAPP (same env expire-tasks uses),
  // normalized through phoneKey to match the roster. If a second operator (a
  // builder/Taona) is also in WHATSAPP_OPERATORS, "the first operator" would
  // mis-route Nur's escalation roll-up to them and she could miss it. Fall back
  // to the first-operator heuristic ONLY when NUR_WHATSAPP is unset, so nothing
  // breaks if the env var is missing.
  const nurKey = phoneKey(process.env.NUR_WHATSAPP || "");
  const nur = (nurKey && roster.find((m) => isOp(m) && phoneKey(m.phone) === nurKey)) || roster.find((m) => isOp(m));
  for (const m of roster.filter(isOp)) {
    const mine = byAssignee.get(m.id) || [];
    const isNur = !!nur && m.id === nur.id;
    let body = mine.length ? ownBrief(m.name, mine, today) : `${m.name ? m.name.split(/\s+/)[0] : "there"}, here is your task summary.`;
    if (isNur) {
      if (unassigned.length) body += `\n\nUnassigned & due (${unassigned.length}):\n` + unassigned.map((t) => `• ${humanize(String(t.title || ""))}`).join("\n");
      if (teamOverdue.length) {
        const people = new Set(teamOverdue.map((t) => t.assignee_id)).size;
        const hi = teamOverdue.filter((t) => t.priority === "high").length;
        body += `\n\nTeam overdue: ${teamOverdue.length} task(s) across ${people} ${people === 1 ? "person" : "people"}${hi ? `, ${hi} high priority` : ""}.`;
      }
      if (needsYou) {
        const oldest = oldestPending as { title?: string; created_at?: string } | null;
        const days = oldest?.created_at ? Math.floor((Date.now() - new Date(oldest.created_at).getTime()) / 86_400_000) : 0;
        const oldestLine = oldest?.title && days >= 2 ? ` Oldest: "${oldest.title}" (${days}d).` : "";
        body += `\n\n${needsYou} item${needsYou === 1 ? "" : "s"} waiting in Needs You.${oldestLine}`;
      }
    }
    // Nothing to say to this operator: skip.
    if (!mine.length && !(isNur && (unassigned.length || teamOverdue.length || needsYou))) continue;
    body += `\n\nReply "done" on anything handled.`;
    // Through the chokepoint so the morning brief lands in the bot's memory:
    // a follow-up "done" or "what was on my list?" now has the brief in history.
    const r: any = await sendTextAndLog(db, phoneKey(m.phone), body);
    results.push({ to: phoneKey(m.phone).slice(-4), via: "text", ok: !!r?.id, tasks: mine.length });
  }

  // 2) Team members WITH bot_access: each has their own restricted 727 line now,
  // so they get the daily_brief TEMPLATE (a count + "reply LIST") for THEIR due
  // tasks. They are off-window, so the template path is required; free-form text
  // would silently fail. Members WITHOUT bot_access still get nothing here: their
  // tasks reach them via the GROUP bot, and Nur sees them in the roll-up above.
  for (const m of roster) {
    if (isOp(m)) continue; // operators already handled above
    if (m.bot_access !== true) continue; // no 727 line: group bot covers them
    const mine = byAssignee.get(m.id) || [];
    if (!mine.length) continue;
    const ok = await pushDailyBrief(db, phoneKey(m.phone), mine.length);
    results.push({ to: phoneKey(m.phone).slice(-4), via: "template", ok, tasks: mine.length });
  }

  await emit({ type: "reminder.operator_brief", source: "cron", actor: "system", subject_type: "contact", subject_id: null, payload: { date: today, recipients: results.length, needsYou, teamOverdue: teamOverdue.length, results } });
  return { ok: true, date: today, recipients: results.length, needsYou, teamOverdue: teamOverdue.length, sent: results, nothing: results.length === 0 };
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await run(new URL(req.url).searchParams.get("force") === "1"));
}
export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await run(new URL(req.url).searchParams.get("force") === "1"));
}
