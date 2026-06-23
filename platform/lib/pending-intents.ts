// Pending Intents — a durable subscription to a future EXTERNAL event (KT #206542).
//
// The bot could defer on the clock (crons) and on the operator's own next "yes"
// (the pending_actions confirm gate), but never on "when person X does Y". This is
// that missing primitive: register an intent ("when an event of trigger_type
// matching trigger_key happens, run action_type(payload)"), and the inbound worker
// dispatches it through a typed, guarded handler when the event arrives.
//
// Phase 1 ships exactly one trigger_type: 'window_open' / action 'send_text' — the
// deferred relay (Nur asks to message someone who has no open 24h WhatsApp window;
// hold it; deliver the moment they next message in, which reopens the window).
//
// DARK UNTIL MIGRATED: every DB call here is best-effort. If the pending_intents
// table is absent, every function no-ops and the bot behaves exactly as before, so
// the code is safe to deploy before the migration runs.
//
// See db/migrations/20260621_pending_intents.sql and docs/decisions/0012-*.

import { createHash } from "node:crypto";
import { sendTextAndLog, phoneKey } from "./whatsapp";
import { emit } from "./events";
import { isSandbox } from "./sandbox";

const DEFAULT_TTL_MS = 48 * 60 * 60 * 1000; // 48h (guardrail 3: stale promises must lapse, not fire)
const MAX_ATTEMPTS = 4;
const FLUSH_BATCH = 20;

export type RegisterIntentArgs = {
  triggerType: string;          // 'window_open'
  triggerKey: string;           // match key; for window_open = recipient wa_id
  actionType: string;           // 'send_text'
  payload: Record<string, any>; // { body: "..." }
  toName?: string | null;
  requesterWaId?: string | null;
  requesterContactId?: string | null;
  reason?: string | null;
  traceId?: string | null;
  origin?: string;              // live|dev|maintenance|harness (default derived)
  ttlMs?: number;
};

// Pure: the idempotency key. One LIVE pending row per (trigger, key, content,
// requester). Exposed so the wall can test it without a DB.
export function intentDedupKey(triggerType: string, triggerKey: string, actionType: string, payloadBody: string, requesterWaId?: string | null): string {
  const contentHash = createHash("sha256").update(`${actionType}:${String(payloadBody || "").slice(0, 2000)}`).digest("hex").slice(0, 16);
  return `${triggerType}:${triggerKey}:${contentHash}:${requesterWaId || "sys"}`;
}

// Register a subscription. Best-effort: returns null if the table is absent or the
// write fails (caller falls through to today's behavior); {deduped:true} if an
// identical live intent already exists; {id} on a fresh insert.
export async function registerIntent(db: any, a: RegisterIntentArgs): Promise<{ id: string | null; deduped: boolean } | null> {
  try {
    // Guardrail 5 (test isolation): an intent registered DURING a harness/replay run
    // must NEVER become a 'live' row that later fires a test message at a real user.
    // isSandbox() is true throughout a sandboxed worker turn, so tag it 'harness';
    // the dispatcher only ever fires origin='live' rows.
    const origin = a.origin || (isSandbox() ? "harness" : (process.env.MAINTENANCE_MODE === "1" ? "maintenance" : "live"));
    const dedupKey = intentDedupKey(a.triggerType, a.triggerKey, a.actionType, String(a.payload?.body ?? ""), a.requesterWaId);
    const row = {
      trigger_type: a.triggerType,
      trigger_key: a.triggerKey,
      action_type: a.actionType,
      payload: a.payload,
      to_name: a.toName ?? null,
      status: "pending",
      origin,
      requester_wa_id: a.requesterWaId ?? null,
      requester_contact_id: a.requesterContactId ?? null,
      reason: a.reason ?? null,
      trace_id: a.traceId ?? null,
      dedup_key: dedupKey,
      expires_at: new Date(Date.now() + (a.ttlMs ?? DEFAULT_TTL_MS)).toISOString(),
    };
    const { data, error } = await db.from("pending_intents").insert(row).select("id").single();
    if (error) {
      // 23505 = the partial-unique dedup index fired: an identical live intent exists.
      if (String((error as any).code) === "23505") return { id: null, deduped: true };
      return null; // table missing / other error → best-effort no-op
    }
    await emit({ type: "sasa.intent_registered", source: "lib:pending-intents", actor: "system", subject_type: "contact", subject_id: a.requesterContactId ?? null, payload: { trigger_type: a.triggerType, key_last4: String(a.triggerKey).slice(-4), action: a.actionType, origin } }).catch(() => {});
    return { id: (data as any)?.id ?? null, deduped: false };
  } catch {
    return null;
  }
}

// Dispatch handler for trigger_type='window_open'. Called by the worker on a real
// inbound: the sender just (re)opened their 24h window, so any held send to them
// can go out now. Atomic per-row claim (no double-send), oldest-first, requester
// notified, fail-open. Returns the number actually delivered.
export async function dispatchWindowOpenFor(
  db: any,
  inboundWaId: string,
  opts: { isLive: boolean; senderContactId?: string | null; traceId?: string | null },
): Promise<number> {
  try {
    if (!opts.isLive) return 0; // guardrail 5+2: never fire on a test/maintenance/non-message inbound
    const key = phoneKey(inboundWaId);
    if (!key) return 0;
    const nowIso = new Date().toISOString();
    // Self-heal: a worker that crashed between claiming a row ('firing') and marking
    // it done leaves it stuck. Reclaim any 'firing' row for this key older than 10
    // minutes back to 'pending' so it retries. A rare duplicate relay beats a silent
    // drop. Best-effort; never blocks the flush.
    try {
      const staleCut = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      await db.from("pending_intents").update({ status: "pending" })
        .eq("trigger_type", "window_open").eq("trigger_key", key)
        .eq("status", "firing").lt("fired_at", staleCut);
    } catch { /* best-effort reaper */ }
    const { data: rows, error } = await db
      .from("pending_intents")
      .select("id,payload,to_name,requester_wa_id,requester_contact_id,trace_id,attempts")
      .eq("trigger_type", "window_open")
      .eq("trigger_key", key)
      .eq("status", "pending")
      .eq("origin", "live") // only live rows ever fire at a real user
      .gt("expires_at", nowIso) // expired rows are inert (guardrail 3)
      .order("created_at", { ascending: true })
      .limit(FLUSH_BATCH);
    if (error || !rows || !rows.length) return 0; // table missing / nothing pending → no-op
    let fired = 0;
    for (const r of rows as any[]) {
      // ATOMIC CLAIM: pending -> firing, guarded by status, so two concurrent
      // worker jobs for the same burst can never both deliver this row.
      const { data: claimed } = await db
        .from("pending_intents")
        .update({ status: "firing", attempts: (r.attempts || 0) + 1, fired_at: nowIso })
        .eq("id", r.id)
        .eq("status", "pending")
        .select("id");
      if (!claimed || !claimed.length) continue; // lost the claim race
      const body = String(r.payload?.body || "");
      let ok = false;
      let err = "empty body";
      if (body) {
        // The window is open NOW (this inbound opened it), so a free-form send lands.
        const res = await sendTextAndLog(db, key, body, { contactId: opts.senderContactId ?? null, handledBy: "sasa", trace_id: r.trace_id || opts.traceId || null });
        ok = !!res?.id;
        err = String(res?.error || "");
      }
      if (ok) {
        await db.from("pending_intents").update({ status: "done", resolved_at: new Date().toISOString() }).eq("id", r.id);
        fired++;
        await emit({ type: "sasa.intent_fired", source: "lib:pending-intents", actor: "system", subject_type: "contact", subject_id: r.requester_contact_id ?? null, payload: { trigger: "window_open", to_last4: key.slice(-4), intent_id: r.id } }).catch(() => {});
        // Requester notice (best-effort), only when the requester is a different
        // person than the recipient.
        const reqKey = phoneKey(r.requester_wa_id || "");
        if (reqKey && reqKey !== key) {
          void sendTextAndLog(db, reqKey, `${r.to_name || "They"} just messaged in, so I delivered your message to ${r.to_name || "them"}.`, { contactId: r.requester_contact_id ?? null, handledBy: "sasa", trace_id: r.trace_id || null }).catch(() => {});
        }
      } else {
        // Delivery failed this attempt (window flapped / Meta error). Re-open for the
        // next inbound, or dead-letter past the attempt cap. Never silent.
        const exhausted = (r.attempts || 0) + 1 >= MAX_ATTEMPTS;
        await db.from("pending_intents").update({ status: exhausted ? "failed" : "pending", last_error: err.slice(0, 300), fired_at: exhausted ? nowIso : null }).eq("id", r.id);
        if (exhausted) await emit({ type: "sasa.intent_failed", source: "lib:pending-intents", actor: "system", subject_type: "contact", subject_id: r.requester_contact_id ?? null, payload: { trigger: "window_open", to_last4: key.slice(-4), intent_id: r.id, error: err.slice(0, 160) } }).catch(() => {});
      }
    }
    return fired;
  } catch {
    return 0; // a flush fault must never block the inbound's normal reply
  }
}
