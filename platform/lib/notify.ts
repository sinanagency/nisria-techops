// PROACTIVE NOTIFICATIONS (Field-nervous-system law). The portal does not just
// wait to be asked: when something is urgent or broken, it reaches OUT to the
// right phone. This is the one place that decides WHO gets pinged and WHEN.
//
// Three rails, all via Meta-approved UTILITY templates (sendTemplate), because a
// proactive push is almost always OUTSIDE WhatsApp's 24h window where free-form
// text silently fails:
//   task_alert    — an urgent / overdue task, to the assignee + Nur
//   daily_brief   — the morning "you have N due" nudge (off-window recipients)
//   system_alert  — a backend incident, to the operators (the builder first)
//
// Dedup is by EVENTS, not new columns (extend-beside law): before a push we check
// for a recent matching event so a burst never spams. Every send is best-effort
// and NEVER throws into its caller — a failed ping must not break task creation.
import { admin } from "./supabase-admin";
import { sendTemplate, sendTemplateAndLog, phoneKey } from "./whatsapp";
import { emit } from "./events";
import { sendEmail } from "./email";

// The operator allowlist as comparable wa_id keys (Nur + the builder).
function operatorKeys(): string[] {
  return (process.env.WHATSAPP_OPERATORS || "").split(",").map((x) => phoneKey(x)).filter(Boolean);
}

// Was an event of this type already emitted for this UUID subject within `mins`?
// This is the burst guard: one urgent task pings once, not once per retry.
// (subject_id is a uuid column, so this is only for real ids like task.id.)
async function pushedRecently(db: any, type: string, subjectId: string | null, mins: number): Promise<boolean> {
  if (!subjectId) return false;
  const since = new Date(Date.now() - mins * 60_000).toISOString();
  const { data } = await db.from("events").select("id").eq("type", type).eq("subject_id", subjectId).gte("created_at", since).limit(1);
  return Boolean(data?.[0]);
}

// Incident dedup keys on a non-uuid string (the component), so it lives in the
// payload, not subject_id (which is a uuid column). Same 30min burst guard.
async function incidentSentRecently(db: any, key: string, mins: number): Promise<boolean> {
  const since = new Date(Date.now() - mins * 60_000).toISOString();
  const { data } = await db.from("events").select("id").eq("type", "system.incident_sent").filter("payload->>key", "eq", key).gte("created_at", since).limit(1);
  return Boolean(data?.[0]);
}

type AlertKind = "new" | "escalation";

// Send the task_alert template to a task's assignee AND Nur. Used by the urgent
// gate on create_task (kind "new") and by the overdue escalation in the daily
// cron (kind "escalation"). Resolves recipients itself from the roster so callers
// only pass the task. Returns the list of wa_ids actually pinged.
export async function pushTaskAlert(
  db: any,
  task: { id: string | null; title: string; due_on?: string | null; priority?: string | null; assignee_id?: string | null },
  kind: AlertKind = "new",
): Promise<{ pinged: string[]; deduped?: boolean }> {
  try {
    if (await pushedRecently(db, "task.alert_sent", task.id, kind === "escalation" ? 20 * 60 : 6 * 60)) {
      return { pinged: [], deduped: true };
    }
    const ops = operatorKeys();
    const { data: members } = await db.from("team_members").select("id,name,phone,status").limit(400);
    const roster = (members || []) as any[];
    // 727 ONLY serves the two principals (Nur + the builder). Field staff get
    // their tasks via the GROUP bot, never an unsolicited 727 DM. So:
    //   - Nur (the operator on the roster) is always a recipient.
    //   - the assignee is added ONLY IF the assignee is also an operator.
    //   - a task assigned to a NON-operator staffer => no 727 push at all
    //     (return empty; the group bot @mentions them in their group instead).
    const nur = roster.find((m) => ops.includes(phoneKey(m.phone)));
    const nurWa = nur ? phoneKey(nur.phone) : (ops[0] || null);
    const assignee = task.assignee_id ? roster.find((m) => m.id === task.assignee_id) : null;
    const assigneeIsOperator = assignee ? ops.includes(phoneKey(assignee.phone)) : false;
    // Assigned to a staffer who does not use 727: this is not a 727 event.
    if (assignee && !assigneeIsOperator) return { pinged: [] };
    const assigneeWa = assigneeIsOperator ? phoneKey(assignee.phone) : null;

    // Recipients: the operator assignee + Nur, de-duplicated. (Nur's own or an
    // unassigned reminder pings just Nur; a task on the builder pings him + Nur.)
    const recipients = Array.from(new Set([assigneeWa, nurWa].filter(Boolean))) as string[];
    if (!recipients.length) return { pinged: [] };

    const adj = kind === "escalation" ? "an overdue" : task.priority === "high" ? "an urgent" : "a new";
    const due = task.due_on || "ASAP";
    const title = String(task.title || "a task").slice(0, 200);

    // Log line mirrors what the recipient actually sees, so the proactive ping
    // lands in the bot's own memory (the agent can answer "what did you just
    // tell me?"). Chokepoint logging is best-effort and never blocks the send.
    const logBody = `Heads up, ${adj} task for you: ${title}. Due ${due}. Reply DONE when it is handled, or open the Nisria portal.`;
    const pinged: string[] = [];
    for (const to of recipients) {
      const r = await sendTemplateAndLog(db, to, "task_alert", [adj, title, due], logBody);
      if (r.id) pinged.push(to);
    }
    await emit({
      type: "task.alert_sent", source: "notify", actor: "system", subject_type: "task", subject_id: task.id,
      payload: { kind, title, priority: task.priority || null, due_on: task.due_on || null, to: pinged.map((p) => p.slice(-4)) },
    });
    return { pinged };
  } catch (err) {
    console.error("pushTaskAlert failed", err);
    return { pinged: [] };
  }
}

// Send the daily_brief template (count only) to one off-window recipient. The
// rich itemised list is what they get back when they reply LIST (in-window).
export async function pushDailyBrief(db: any, to: string, count: number): Promise<boolean> {
  try {
    const logBody = `Morning brief: you have ${count} due today. Reply LIST for the items.`;
    const r = await sendTemplateAndLog(db, phoneKey(to), "daily_brief", [String(count)], logBody);
    return Boolean(r.id);
  } catch (err) {
    console.error("pushDailyBrief failed", err);
    return false;
  }
}

// Send the system_alert template to every operator. `component` is the failing
// part ("WhatsApp worker"), `detail` is what happened. Deduped 30min per
// component so a flapping failure does not machine-gun the operators.
// NOT routed through the chokepoint on purpose: an incident alert is bot to
// operator system meta, not part of the user <-> Sasa conversation. Logging it
// into `messages` would pollute the brain's view of the thread, so it stays raw.
export async function pushIncident(component: string, detail: string): Promise<{ sent: number; deduped?: boolean }> {
  try {
    const db = admin();
    const key = component.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
    if (await incidentSentRecently(db, key, 30)) return { sent: 0, deduped: true };
    const ops = operatorKeys();
    let sent = 0;
    for (const to of ops) {
      const r = await sendTemplate(to, "system_alert", [component.slice(0, 200), detail.slice(0, 400)]);
      if (r.id) sent++;
    }
    // The component key lives in the payload (subject_id is a uuid column); the
    // dedup window above reads it back, so the guard is per-component.
    await emit({ type: "system.incident_sent", source: "notify", actor: "system", subject_type: "incident", subject_id: null, payload: { key, component, detail: detail.slice(0, 200), sent } });
    return { sent };
  } catch (err) {
    console.error("pushIncident failed", err);
    return { sent: 0 };
  }
}

// The builder's wa_id keys (owner override). Used to tell the two operators
// apart: Nur is the operator who is NOT the owner.
function ownerKeys(): string[] {
  return (process.env.OWNER_WHATSAPP || "").split(",").map((x) => phoneKey(x)).filter(Boolean);
}

// APPROVALS / NEEDS YOU (Field-nervous-system law). The moment a decision lands
// in Nur's queue (a payment to confirm, an email draft to approve), ping her so
// time-sensitive approvals do not wait for the next morning brief. Goes to NUR
// only: Needs You is the founder's decision queue, not the builder's, so this
// stays off the builder's phone. Fired from the single chokepoint
// (gateway.queueApproval) so EVERY approval kind is covered, current and future.
// Deduped 6h per approval id. Best-effort: never breaks the approval write.
export async function pushApprovalRequest(
  db: any,
  approval: { id: string | null; title?: string | null; kind?: string | null },
): Promise<{ pinged: boolean; deduped?: boolean }> {
  try {
    if (await pushedRecently(db, "approval.ping_sent", approval.id, 6 * 60)) return { pinged: false, deduped: true };
    const owners = ownerKeys();
    const opsKeys = operatorKeys();
    const nurWa = opsKeys.find((k) => !owners.includes(k)) || opsKeys[0] || null;
    if (!nurWa) return { pinged: false };
    const label = String(approval.title || approval.kind || "an item").replace(/\s+/g, " ").slice(0, 150);
    const logBody = `Something needs your decision: ${label}. Open the portal to approve or decline.`;
    const r = await sendTemplateAndLog(db, nurWa, "approval_request", [label], logBody);
    await emit({
      type: "approval.ping_sent", source: "notify", actor: "system", subject_type: "approval", subject_id: approval.id,
      payload: { title: label, kind: approval.kind || null, ok: !!r.id },
    });
    return { pinged: !!r.id };
  } catch (err) {
    console.error("pushApprovalRequest failed", err);
    return { pinged: false };
  }
}

// OPERATOR UPDATE (the 24h-window escape hatch). A plain sendText silently fails
// once an operator has not messaged the line in 24 hours; an approved template
// never does. This reaches Nur or the builder with a FREE-FORM update at any
// time via the `operator_update` template ({{1}}=first name, {{2}}=the body), or
// `operator_request` when a reply is wanted. Logs through the chokepoint so the
// bot remembers it said this. Returns ok=false (with the error) if the template
// is not yet Meta-approved, so callers can fall back gracefully.
export async function pushOperatorUpdate(
  db: any,
  toWa: string,
  name: string | null,
  text: string,
  opts?: { needsReply?: boolean },
): Promise<{ ok: boolean; error?: string }> {
  try {
    const first = (name || "there").trim().split(/\s+/)[0] || "there";
    const body = String(text).replace(/\s+/g, " ").trim().slice(0, 900);
    const tmpl = opts?.needsReply ? "operator_request" : "operator_update";
    const logBody = opts?.needsReply
      ? `Hi ${first}, from Nisria:\n\n${body}\n\nReply here when you're ready.`
      : `Hi ${first}, an update from Nisria:\n\n${body}\n\nOpen the dashboard at command.nisria.co for the details.`;
    const r = await sendTemplateAndLog(db, phoneKey(toWa), tmpl, [first, body], logBody);
    return { ok: !!r.id, error: r.error };
  } catch (err: any) {
    console.error("pushOperatorUpdate failed", err);
    return { ok: false, error: String(err?.message || err) };
  }
}

// ----------------------------------------------------------------------------
// TASK COMPLETION (Field-nervous-system law). When a task is marked done, the
// people who care must hear it. The routing, agreed with the operators:
//   - Operator task (Nur <-> the builder): the DELEGATOR gets an instant email
//     the moment the doer completes it. Low volume, individually important.
//   - Team-member task: NO instant email (the team is ~38 people; per-task mail
//     would flood the inbox). Instead the in-portal `task.completed` event is the
//     realtime signal in Mission Control, and the daily task-digest cron emails
//     Nur ONE summary of the day's completions.
// Either way a `task.completed` event is emitted, so the feed is always live and
// the digest has a source to read from. Best-effort: a failed ping never breaks
// the status write that called it.
const OPERATOR_EMAILS = ["nur@nisria.co", "tech@nisria.co"];

// Resolve a created_by NAME (e.g. "Nur", "Taona", or a staffer's name) to an
// email. Operators are matched by their team_members row like everyone else, so
// there is no second source of truth for who Nur/Taona are.
async function emailForName(db: any, name: string | null): Promise<{ email: string; name: string } | null> {
  const n = (name || "").trim();
  if (!n) return null;
  const { data } = await db.from("team_members").select("name,email").ilike("name", `%${n}%`).limit(1);
  if (data?.[0]?.email) return { email: String(data[0].email).toLowerCase(), name: String(data[0].name) };
  return null;
}

export async function notifyTaskCompleted(
  db: any,
  taskId: string,
  actor: { name?: string | null; teamEmail?: string | null } | null,
): Promise<void> {
  try {
    const { data: task } = await db
      .from("tasks")
      .select("id,title,description,priority,created_by,assignee_id,assignee:team_members(name,email)")
      .eq("id", taskId)
      .maybeSingle();
    if (!task) return;

    const actorName = actor?.name || "Someone";
    const actorEmail = (actor?.teamEmail || "").toLowerCase();

    const assignee = (task as any).assignee || null;
    const assigneeEmail = (assignee?.email || "").toLowerCase();
    const assigneeIsOperator = OPERATOR_EMAILS.includes(assigneeEmail);

    const creator = await emailForName(db, (task as any).created_by);
    const creatorEmail = (creator?.email || "").toLowerCase();
    const creatorIsOperator = OPERATOR_EMAILS.includes(creatorEmail);

    // An "operator task" is one BOTH delegated by and assigned to a principal
    // (Nur or the builder). Those get the instant individual email. Everything
    // else is a team-member task and rides the in-portal event + daily digest.
    const operatorTask = assigneeIsOperator && creatorIsOperator;

    // The realtime signal everyone reads (Mission Control feed) + the digest source.
    await emit({
      type: "task.completed",
      source: "tasks",
      actor: actorName,
      subject_type: "task",
      subject_id: (task as any).id,
      payload: {
        title: (task as any).title,
        assignee: assignee?.name || null,
        creator: creator?.name || (task as any).created_by || null,
        completed_by: actorName,
        operator_task: operatorTask,
        priority: (task as any).priority || null,
      },
    });

    // Instant email ONLY for operator tasks, ONLY to the delegator, and never to
    // the person who just clicked done (they already know).
    if (operatorTask && creatorEmail && creatorEmail !== actorEmail) {
      const t: any = task;
      await sendEmail(
        creatorEmail,
        `Task done: ${t.title}`,
        `${actorName} marked this task complete:\n\n"${t.title}"${t.description ? `\n${t.description}` : ""}\nPriority: ${t.priority || "medium"}\n\nView it on the Command Center: https://command.nisria.co/tasks`,
        { account: "sasa@nisria.co" },
      );
    }
  } catch (err) {
    console.error("notifyTaskCompleted failed", err);
  }
}
