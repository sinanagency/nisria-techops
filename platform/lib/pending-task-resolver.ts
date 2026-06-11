// Layer 0: deterministic resolver for the conversational task-collection handoff.
//
// Runs BEFORE parseTasks in the WhatsApp worker. Catches the case where Sasa
// asked a clarifying question ("What's the task?") on a prior turn and the
// current inbound is the answer (a bare task title like "Update the algorithm
// sequence"). Without this layer, that bare-title reply falls through every
// parseTasks regex and the LLM cold-calls into HONEST_NO_ACTION.
//
// Repro case (06-11 15:36, Taona):
//   "Add a task for taona" → Sasa: "What's the task, and when is it due?"
//   "Update the algorithm sequence" → previously HONEST_NO_ACTION; now: deterministic write.
//
// This layer never wakes the LLM. It either resolves (returns ok+reply+taskId)
// or returns null and the worker proceeds to parseTasks unchanged.

import type { SupabaseClient } from "@supabase/supabase-js";

const RECENT_WINDOW_MS = 10 * 60 * 1000;

// Sasa's typical clarifying-question shapes on task creation.
const TASK_CLARIFY_PATTERN = /\b(?:what'?s|which|tell me|give me)\b[^.?!\n]*\b(?:the\s+)?(?:task|reminder|item|to-?do)\b/i;

// Hint that the inbound BEFORE Sasa's question was a task-creation request.
// Used to widen precision: only fire when we know the broader intent was task creation.
const PRIOR_INBOUND_TASK_HINT = /\b(?:add|create|log|note|track|set up)\s+(?:a\s+|an\s+|the\s+|new\s+)?(?:task|reminder|to-?do|item|note)\b/i;

// Patterns we must NOT fire on. parseTasks owns these.
const PARSETASKS_OWNED = [
  /^(?:add|create|log|note|track)\s+(?:a\s+|an\s+|new\s+)?(?:task|reminder)/i,  // headed creation
  /^[-•*]\s/,                                                                    // bullet
  /^assign\s+(?:this|these|that|it)\b/i,                                          // "Assign this..."
  /^@/,                                                                           // @mention
  /^remind\s+(?:me|@|[A-Z])/i,                                                    // "Remind me/X..."
];

// Confirmation/cancellation tokens are reserved for the payment resolver.
const CONFIRM_OR_CANCEL = /^\s*(?:yes|yeah|yep|yup|ok(?:ay)?|sure|go(?:\s+ahead)?|do\s+it|confirm(?:ed)?|verified|correct|proceed|approve(?:d)?|send|log it|save it|please do|sawa|ndio|haya|poa|👍|✅|💯|no|nope|nah|cancel|don'?t|stop|hold|wait|not\s+yet|later|scrap|hapana|la|🚫|👎)\b\s*[.!?]*\s*$/i;

export interface Layer0Context {
  db: SupabaseClient;
  contactId: string;
  command: string;
  sourceMessageId: string | null;
  senderTeamMember: { id: string; name: string } | null;
  opName?: string | null;
  fromName?: string | null;
}

export interface Layer0Result {
  ok: boolean;
  reply?: string;
  taskId?: string | null;
  reason?: string;
}

export async function resolvePendingTaskTitle(ctx: Layer0Context): Promise<Layer0Result | null> {
  const { db, contactId, command } = ctx;
  if (!contactId || !command) return null;
  const cmd = command.trim();
  if (cmd.length < 2 || cmd.length > 240) return null;

  // Skip the patterns owned by other layers.
  for (const re of PARSETASKS_OWNED) if (re.test(cmd)) return null;
  if (CONFIRM_OR_CANCEL.test(cmd)) return null;

  // Look at recent conversation context.
  const since = new Date(Date.now() - RECENT_WINDOW_MS).toISOString();
  const { data: recent } = await db
    .from("messages")
    .select("id, direction, body, created_at, handled_by")
    .eq("contact_id", contactId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(8);
  if (!recent || recent.length === 0) return null;

  // The most recent outbound from sasa must be a task-clarifying question.
  const lastBot = recent.find((m: any) => m.direction === "out" && m.handled_by === "sasa");
  if (!lastBot) return null;
  const lastBotBody = String(lastBot.body || "");
  if (!TASK_CLARIFY_PATTERN.test(lastBotBody)) return null;

  // Widen precision: the user's message BEFORE the bot's question should have
  // been task-creation-shaped. Without this, a clarifying question on an
  // unrelated topic that happened to mention "task" would mis-fire.
  const lastBotAt = new Date(lastBot.created_at).getTime();
  const priorUserMsg = recent.find(
    (m: any) => m.direction === "in" && new Date(m.created_at).getTime() < lastBotAt
  );
  if (priorUserMsg && !PRIOR_INBOUND_TASK_HINT.test(String(priorUserMsg.body || ""))) return null;

  // Resolve to a write. Title is the current inbound, cleaned.
  const title = cmd.replace(/\s+/g, " ");

  // Sender → assignee (defaults to "Nur" when caller isn't a team member,
  // matching the parseTasks fallback).
  const assigneeId = ctx.senderTeamMember?.id || null;
  const assigneeName = ctx.senderTeamMember?.name || ctx.opName || ctx.fromName || "Nur";

  // Idempotency: if the same (source_kind, source_id, title) already exists,
  // return the existing row id and let the caller confirm gracefully.
  if (ctx.sourceMessageId) {
    const { data: existing } = await db
      .from("tasks")
      .select("id")
      .eq("source_kind", "task_collected")
      .eq("source_id", ctx.sourceMessageId)
      .eq("title", title)
      .limit(1);
    if (existing && existing[0]) {
      return { ok: true, reply: `Already logged: ${title}.`, taskId: existing[0].id, reason: "idempotent" };
    }
  }

  const { data: inserted, error: insErr } = await db
    .from("tasks")
    .insert({
      title,
      assignee_id: assigneeId,
      status: "todo",
      priority: "medium",
      source: "ai",
      created_by: ctx.opName || ctx.fromName || "Nur",
      important: false,
      task_type: "specific",
      source_kind: "task_collected",
      source_id: ctx.sourceMessageId,
      source_text: command,
    })
    .select("id, title")
    .single();

  if (insErr) {
    return { ok: false, reason: `db_error: ${String(insErr.message || insErr).slice(0, 240)}` };
  }

  return {
    ok: true,
    reply: `Logged: ${title}.`,
    taskId: inserted?.id || null,
    reason: assigneeName ? `assignee=${assigneeName}` : "ok",
  };
}
