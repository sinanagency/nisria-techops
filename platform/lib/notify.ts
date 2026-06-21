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
import { sendTemplate, sendTemplateAndLog, sendTextAndLog, phoneKey } from "./whatsapp";
import { emit } from "./events";
import { sendEmail } from "./email";
import { humanize } from "./humanize";

// The operator allowlist as comparable wa_id keys (Nur + the builder).
function operatorKeys(): string[] {
  return (process.env.WHATSAPP_OPERATORS || "").split(",").map((x) => phoneKey(x)).filter(Boolean);
}

// QUIET HOURS (KT #288). On 2026-06-14 night Nur got 13 proactive pings
// between 01:33 and 02:47 Dubai. Inbound conversations stay free at any hour
// (those go through sendTextAndLog, not these surfaces), but every PROACTIVE
// push must respect a no-disturb window. Defaults to 22:00 → 07:00 Asia/Dubai;
// override per-deployment via QUIET_HOURS_START_DUBAI + QUIET_HOURS_END_DUBAI
// (integer hour 0-23 each). The morning brief at ~09:00 picks up everything
// that was deferred, so nothing is lost — only delayed to a humane hour.
//
// pushDailyBrief is exempted (IT IS the morning brief). pushIncident is
// exempted (operators need ops alerts at any hour). pushCalendarAlert in mode
// "now" is exempted (the start-of-meeting ping must fire at meeting time).
function withinQuietHours(): boolean {
  const startEnv = process.env.QUIET_HOURS_START_DUBAI;
  const endEnv = process.env.QUIET_HOURS_END_DUBAI;
  // Disable when explicitly set to empty.
  if (startEnv === "" || endEnv === "") return false;
  const start = Number.isFinite(Number(startEnv)) ? Number(startEnv) : 22;
  const end = Number.isFinite(Number(endEnv)) ? Number(endEnv) : 7;
  if (start < 0 || start > 23 || end < 0 || end > 23 || start === end) return false;
  // Current hour in Asia/Dubai. Intl avoids DST issues (the UAE does not observe
  // DST so this is a fixed +04:00, but Intl is the safe path for any future TZ).
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Dubai" }).format(new Date()),
  );
  if (!Number.isFinite(hour)) return false;
  // Wrap-around window (22 → 7): inside means hour >= start OR hour < end.
  // Non-wrap window (e.g. 1 → 6): inside means hour >= start AND hour < end.
  return start > end ? (hour >= start || hour < end) : (hour >= start && hour < end);
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

type AlertKind = "new" | "escalation" | "reminder";

// Send the task_alert template to a task's assignee AND Nur. Used by the urgent
// gate on create_task (kind "new") and by the overdue escalation in the daily
// cron (kind "escalation"). Resolves recipients itself from the roster so callers
// only pass the task. Returns the list of wa_ids actually pinged.
export async function pushTaskAlert(
  db: any,
  task: { id: string | null; title: string; due_on?: string | null; due_time?: string | null; priority?: string | null; assignee_id?: string | null },
  kind: AlertKind = "new",
): Promise<{ pinged: string[]; deduped?: boolean; deferredQuietHours?: boolean }> {
  try {
    // Quiet-hours gate (KT #288). Inbound conversation stays free; proactive
    // task pings sleep until the next morning brief at ~09:00 Dubai. Emit a
    // deferral event so observability sees the queueing without a send.
    if (withinQuietHours()) {
      await emit({
        type: "task.alert_deferred_quiet_hours", source: "notify", actor: "system", subject_type: "task", subject_id: task.id,
        payload: { kind, title: String(task.title || "").slice(0, 200), priority: task.priority || null, due_on: task.due_on || null },
      }).catch(() => null);
      return { pinged: [], deferredQuietHours: true };
    }
    if (await pushedRecently(db, "task.alert_sent", task.id, kind === "escalation" ? 20 * 60 : 6 * 60)) {
      return { pinged: [], deduped: true };
    }
    const ops = operatorKeys();
    const { data: members } = await db.from("team_members").select("id,name,phone,status,bot_access").limit(400);
    const roster = (members || []) as any[];
    // WHO HAS A 727 LINE (updated after the tiered-access change): the two
    // principals (Nur + the builder) ALWAYS, plus any team member granted
    // bot_access. A bot_access staffer now has their own restricted 727 session,
    // so an urgent task assigned to them DOES ping them on that line. A staffer
    // with NO bot_access still has no 727 line: their tasks reach them via the
    // GROUP bot, so we send no DM (return empty).
    const nur = roster.find((m) => ops.includes(phoneKey(m.phone)));
    const nurWa = nur ? phoneKey(nur.phone) : (ops[0] || null);
    const assignee = task.assignee_id ? roster.find((m) => m.id === task.assignee_id) : null;
    const assigneeIsOperator = assignee ? ops.includes(phoneKey(assignee.phone)) : false;
    const assigneeHasBot = assignee ? assignee.bot_access === true : false;
    // Assigned to a staffer with no 727 line at all: not a 727 event.
    if (assignee && !assigneeIsOperator && !assigneeHasBot) return { pinged: [] };
    const assigneeWa = assignee && (assigneeIsOperator || assigneeHasBot) ? phoneKey(assignee.phone) : null;

    // Recipients. An operator/builder task pings the assignee + Nur (she co-owns
    // the principal lane). A pure team-member task (bot_access, not an operator)
    // pings JUST that member on their own line: Nur hears it in the morning
    // roll-up, not as a real-time double-ping every time she delegates.
    const teamMemberTask = !!assignee && assigneeHasBot && !assigneeIsOperator;
    const recipients = teamMemberTask
      ? ([assigneeWa].filter(Boolean) as string[])
      : (Array.from(new Set([assigneeWa, nurWa].filter(Boolean))) as string[]);
    if (!recipients.length) return { pinged: [] };

    const adj = kind === "escalation" ? "an overdue" : task.priority === "high" ? "an urgent" : kind === "reminder" ? "a reminder for your" : "a new";
    const due = task.due_on || "ASAP";
    const title = humanize(String(task.title || "a task")).slice(0, 200);
    const pinged: string[] = [];

    // REMINDER WORDING (KT #331): a timed reminder is NOT a new task assignment, so
    // it must not read "Heads up, a new task for you ... Reply DONE". Word it as a
    // reminder and send it FREE-FORM first — correct wording, and it delivers
    // whenever the recipient is inside WhatsApp's 24h window (a same-day timed
    // reminder usually is). Fall back to the task_alert template ONLY if free-form
    // fails (out-of-window) so the reminder still lands, just in the stiffer wording.
    if (kind === "reminder") {
      const timeStr = task.due_time ? ` at ${String(task.due_time).slice(0, 5)} today` : "";
      const reminderBody = `Reminder: ${title}${timeStr}. Reply DONE when it is handled, or open the Nisria portal.`;
      for (const to of recipients) {
        const free = await sendTextAndLog(db, to, reminderBody, {});
        if (free.id) { pinged.push(to); continue; }
        const r = await sendTemplateAndLog(db, to, "task_alert", [adj, title, due], reminderBody);
        if (r.id) pinged.push(to);
      }
      await emit({
        type: "task.alert_sent", source: "notify", actor: "system", subject_type: "task", subject_id: task.id,
        payload: { kind, title, priority: task.priority || null, due_on: task.due_on || null, to: pinged.map((p) => p.slice(-4)) },
      });
      return { pinged };
    }

    // Log line mirrors what the recipient actually sees, so the proactive ping
    // lands in the bot's own memory (the agent can answer "what did you just
    // tell me?"). Chokepoint logging is best-effort and never blocks the send.
    const logBody = `Heads up, ${adj} task for you: ${title}. Due ${due}. Reply DONE when it is handled, or open the Nisria portal.`;
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

// TIMED REMINDER DIGEST (Field-nervous-system law, the anti-spam version).
// When the 5-min timed cron finds N due tasks for the SAME assignee, it must
// NOT fire one push per row (Nur got 6 pings in 11s on 2026-06-15 because the
// old per-task loop did exactly that). Instead the cron groups by assignee and
// calls this once: a single message listing all N titles. Routing (operator vs
// bot_access vs nobody) mirrors pushTaskAlert exactly so a non-727 assignee
// still gets no DM. For N=1 this delegates back to pushTaskAlert so the
// single-task Meta-approved template path is preserved (no plural awkwardness,
// no template regression). For N>=2 it uses pushOperatorUpdate's free-form
// `operator_update` template (the same path pushCalendarAlert uses for
// multi-content lines) since the static task_alert template only fits one row.
// Caller is responsible for stamping reminded_at on ALL N tasks AFTER this
// returns so the next 5-min tick does not re-fire any of them.
export async function pushTaskDigest(
  db: any,
  tasks: Array<{ id: string | null; title: string; due_on?: string | null; due_time?: string | null; priority?: string | null; assignee_id?: string | null }>,
  opts?: { dev?: boolean },
): Promise<{ pinged: string[] }> {
  try {
    const list = (tasks || []).filter(Boolean);
    if (!list.length) return { pinged: [] };
    // Quiet-hours gate (KT #288). Defer the whole digest as one batch — morning
    // brief (pushDailyBrief at ~09:00) will surface the same items via LIST.
    if (withinQuietHours()) {
      for (const t of list) {
        await emit({
          type: "task.alert_deferred_quiet_hours", source: "notify", actor: "system", subject_type: "task", subject_id: t?.id || null,
          payload: { kind: "new", digest: true, count: list.length, title: String(t?.title || "").slice(0, 200) },
        }).catch(() => null);
      }
      return { pinged: [] };
    }
    // N=1: reuse the single-task template exactly. Same body, same dedup, same
    // recipients. Guarantees no "you have 1 tasks" plural slip and no break of
    // anything that already works for the one-task case.
    if (list.length === 1) {
      // A single due task from the TIMED cron is a reminder, not a new task (KT #331).
      const r = await pushTaskAlert(db, list[0], "reminder");
      return { pinged: r.pinged };
    }

    // N>=2: resolve recipients once from the roster, same routing as pushTaskAlert.
    const ops = operatorKeys();
    const { data: members } = await db.from("team_members").select("id,name,phone,status,bot_access").limit(400);
    const roster = (members || []) as any[];
    const nur = roster.find((m) => ops.includes(phoneKey(m.phone)));
    const nurName = nur?.name || null;
    const nurWa = nur ? phoneKey(nur.phone) : (ops[0] || null);
    // All tasks in a digest share the same assignee_id (the cron groups by it).
    const assigneeId = list[0]?.assignee_id || null;
    const assignee = assigneeId ? roster.find((m) => m.id === assigneeId) : null;
    const assigneeIsOperator = assignee ? ops.includes(phoneKey(assignee.phone)) : false;
    const assigneeHasBot = assignee ? assignee.bot_access === true : false;
    // Field staff with no 727 line: not a 727 event (mirror of pushTaskAlert).
    if (assignee && !assigneeIsOperator && !assigneeHasBot) return { pinged: [] };
    const assigneeWa = assignee && (assigneeIsOperator || assigneeHasBot) ? phoneKey(assignee.phone) : null;

    const teamMemberTask = !!assignee && assigneeHasBot && !assigneeIsOperator;
    const recipients = teamMemberTask
      ? ([assigneeWa].filter(Boolean) as string[])
      : (Array.from(new Set([assigneeWa, nurWa].filter(Boolean))) as string[]);
    if (!recipients.length) return { pinged: [] };

    const anyUrgent = list.some((t) => t?.priority === "high");
    const header = anyUrgent
      ? `Heads up, urgent: you have ${list.length} tasks due now:`
      : `Heads up, you have ${list.length} tasks due now:`;
    const bullets = list.map((t) => `• ${humanize(String(t?.title || "a task")).slice(0, 200)}`).join("\n");
    const footer = `Reply DONE ${list.length} to clear them, or DONE 1,3 to mark specific ones, or open the Nisria portal.`;
    const body = `${header}\n${bullets}\n${footer}`;

    // Resolve a friendly first-name per recipient: if they are Nur (or any
    // rostered member), use their name; otherwise let pushOperatorUpdate fall
    // back to "there". Routes through the chokepoint so the bot remembers it.
    // Law 12 (test-mode). Thread dev through pushOperatorUpdate → the
    // chokepoint reroutes the template to the developer phone, skips the
    // messages insert, never lands on Nur.
    const pinged: string[] = [];
    for (const to of recipients) {
      const member = roster.find((m) => phoneKey(m.phone) === to);
      const firstName = member?.name || nurName || null;
      const r = await pushOperatorUpdate(db, to, firstName, body, { dev: opts?.dev });
      if (r.ok) pinged.push(to);
    }

    // One emission per task so the dedup floor stays per-task (a future caller
    // that picks tasks individually still sees task.alert_sent and respects
    // pushedRecently()). Payload marks `digest:true` so observability can tell
    // a digest tick apart from a one-off urgent ping.
    for (const t of list) {
      await emit({
        type: "task.alert_sent", source: "notify", actor: "system", subject_type: "task", subject_id: t.id,
        payload: { kind: "new", digest: true, count: list.length, title: t.title, priority: t.priority || null, due_on: t.due_on || null, to: pinged.map((p) => p.slice(-4)) },
      });
    }
    return { pinged };
  } catch (err) {
    console.error("pushTaskDigest failed", err);
    return { pinged: [] };
  }
}

// Send the daily_brief template (count only) to one off-window recipient. The
// rich itemised list is what they get back when they reply LIST (in-window).
export async function pushDailyBrief(db: any, to: string, count: number): Promise<boolean> {
  try {
    const logBody = `Task brief: you have ${count} due today. Reply LIST for the items.`;
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
    // #14: system/technical alerts go to the DEVELOPER (owner) only, never to Nur.
    // Was operatorKeys() (WHATSAPP_OPERATORS, which includes Nur). Operational
    // items reach Nur through approvals/briefs, not raw incident alerts.
    const ops = ownerKeys();
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
): Promise<{ pinged: boolean; deduped?: boolean; deferredQuietHours?: boolean }> {
  try {
    // Quiet-hours gate (KT #288). Approvals are time-sensitive but a 2am ping
    // is not — the morning brief picks them up via the Needs You queue.
    if (withinQuietHours()) {
      await emit({
        type: "approval.ping_deferred_quiet_hours", source: "notify", actor: "system", subject_type: "approval", subject_id: approval.id,
        payload: { title: String(approval.title || approval.kind || "").slice(0, 150), kind: approval.kind || null },
      }).catch(() => null);
      return { pinged: false, deferredQuietHours: true };
    }
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
  opts?: { needsReply?: boolean; dev?: boolean },
): Promise<{ ok: boolean; error?: string; deferredQuietHours?: boolean }> {
  try {
    // Quiet-hours gate (KT #288). The free-form operator_update template was
    // the surface that fired 13 times at Nur between 01:33 and 02:47 Dubai on
    // 2026-06-14. Defer outside business hours. The {dev:true} branch is NOT
    // gated (Taona testing on his own line at any hour).
    if (!opts?.dev && withinQuietHours()) {
      await emit({
        type: "operator_update.deferred_quiet_hours", source: "notify", actor: "system", subject_type: "contact", subject_id: null,
        payload: { to_last4: String(toWa).slice(-4), needsReply: !!opts?.needsReply, preview: String(text).slice(0, 160) },
      }).catch(() => null);
      return { ok: false, deferredQuietHours: true };
    }
    const first = (name || "there").trim().split(/\s+/)[0] || "there";
    const body = String(text).replace(/\s+/g, " ").trim().slice(0, 900);
    const tmpl = opts?.needsReply ? "operator_request" : "operator_update";
    const logBody = opts?.needsReply
      ? `Hi ${first}, from Nisria:\n\n${body}\n\nReply here when you're ready.`
      : `Hi ${first}, an update from Nisria:\n\n${body}\n\nOpen the dashboard at command.nisria.co for the details.`;
    // Law 12 (test-mode). Pass dev through to the chokepoint; sendTemplateAndLog
    // handles the rerouting and the [DEV] prefix on the log line.
    const r = await sendTemplateAndLog(db, phoneKey(toWa), tmpl, [first, body], logBody, { dev: opts?.dev });
    return { ok: !!r.id, error: r.error };
  } catch (err: any) {
    console.error("pushOperatorUpdate failed", err);
    return { ok: false, error: String(err?.message || err) };
  }
}

// CALENDAR ALERT (Field-nervous-system law for the calendar). Two moments:
//   - mode "added": when something lands on the calendar, Nur gets a heads-up.
//   - mode "now":   at the event's start time, the timed cron pings "this is on now".
// 727 serves only the principals, so this pings the operator (Nur) plus any owner
// number, never field staff. "now" is deduped so the 5-minute cron fires it once.
// Best-effort: a failure here never blocks the calendar write.
export async function pushCalendarAlert(
  db: any,
  ev: { id: string | null; title: string; when: string; location?: string | null; kind?: string | null },
  mode: "added" | "now" = "added",
): Promise<{ pinged: string[]; deduped?: boolean; deferredQuietHours?: boolean }> {
  try {
    if (mode === "now" && (await pushedRecently(db, "calendar.alert_sent", ev.id, 6 * 60))) {
      return { pinged: [], deduped: true };
    }
    // Quiet-hours gate (KT #288). "added" mode is a heads-up that can wait for
    // morning. "now" mode is the start-of-event ping and MUST fire at meeting
    // time regardless of hour — never gate it.
    if (mode === "added" && withinQuietHours()) {
      await emit({
        type: "calendar.alert_deferred_quiet_hours", source: "notify", actor: "system", subject_type: "event", subject_id: ev.id,
        payload: { title: String(ev.title || "").slice(0, 200), when: ev.when, kind: ev.kind || null },
      }).catch(() => null);
      return { pinged: [], deferredQuietHours: true };
    }
    const ops = operatorKeys();
    const { data: members } = await db.from("team_members").select("id,name,phone,status").limit(400);
    const roster = (members || []) as any[];
    const nur = roster.find((m) => ops.includes(phoneKey(m.phone)));
    const nurName = nur?.name || null;
    const nurWa = nur ? phoneKey(nur.phone) : (ops[0] || null);
    const recipients = Array.from(new Set([nurWa].filter(Boolean))) as string[];
    if (!recipients.length) return { pinged: [] };
    const title = String(ev.title || "an event").slice(0, 180);
    const loc = ev.location ? `, ${String(ev.location).slice(0, 80)}` : "";
    const text = mode === "now"
      ? `Now on your calendar: ${title} (${ev.when}${loc}).`
      : `Added to your calendar: ${title} on ${ev.when}${loc}.`;
    const pinged: string[] = [];
    for (const to of recipients) {
      const r = await pushOperatorUpdate(db, to, nurName, text);
      if (r.ok) pinged.push(to);
    }
    await emit({
      type: "calendar.alert_sent", source: "notify", actor: "system", subject_type: "calendar_event", subject_id: ev.id,
      payload: { mode, title, when: ev.when, to: pinged.map((p) => p.slice(-4)) },
    });
    return { pinged };
  } catch (err) {
    console.error("pushCalendarAlert failed", err);
    return { pinged: [] };
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
      .select("id,title,description,priority,created_by,assignee_id,assignee:team_members!tasks_assignee_id_fkey(name,email)")
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
