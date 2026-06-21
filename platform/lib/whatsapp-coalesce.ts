// Durable per-sender WhatsApp turn COALESCING (the fix for the double-reply bug).
//
// LIVE BUG: a contact sent "you're cool" then "thanks" as two separate WhatsApp
// messages and got TWO separate replies. Every inbound message enqueues its own
// whatsapp.reply job -> its own runSasa -> its own reply. brain-core's
// shouldProcess (lib/brain-core/webhook-guard.js) had a per-sender lock, but it
// was an IN-MEMORY Map (PROCESSING_LOCKS = new Map()), which does NOT survive
// across Vercel serverless invocations, so it could not coalesce the separate
// function calls. The coalescer here is DURABLE (Postgres-backed) instead.
//
// MECHANISM (Approach B — the jobs table has no scheduled_for/run_after column,
// so a debounce-by-reschedule is impossible without rewiring claimJobs; we use a
// durable claim lock + a brief in-worker settle instead):
//
//   1. The first whatsapp.reply job for a contact INSERTs a row into
//      wa_turn_claim. The PRIMARY KEY on contact_id makes a concurrent second
//      insert a 23505 unique_violation = the LOSER. Exactly one winner per burst.
//   2. The WINNER settles briefly (SETTLE_MS) so a rapid burst lands, then
//      re-reads ALL unhandled inbound (messages.status='received') from this
//      contact SINCE the last outbound, concatenates them in order, and returns
//      that assembled text as the turn input. The worker runs the brain ONCE on
//      it, sends ONE reply, then calls finishTurn() to mark the whole burst
//      handled (status='coalesced') and release the claim.
//   3. The LOSER marks its OWN inbound handled and returns { proceed:false } so
//      the worker no-ops without sending. The winner already covers its text.
//
// FAIL-OPEN (honesty law: never drop a turn, never leave a human un-replied):
// every DB touch is wrapped. If anything throws (table missing, query error),
// coalesceTurn returns { proceed:true, failOpen:true } with NO claim held, so the
// worker falls straight through to the EXISTING single-message reply path. A
// coalescer bug can never make the bot go silent.

import { admin } from "./supabase-admin";
import { emit } from "./events";

// How long the winner waits for the rest of a human's burst to land before it
// assembles the turn. WhatsApp bursts (two-three quick lines) land within a few
// seconds; 7s comfortably covers "you're cool" + "thanks" without making the
// reply feel laggy.
const SETTLE_MS = 7000;
// Claim TTL. A crashed winner's claim is ignored/overwritable past this, so a
// dropped invocation can never wedge a sender into permanent silence.
const CLAIM_TTL_MS = 90_000;
// Cap on how much burst text we feed the brain as one turn (defensive).
const MAX_BURST_CHARS = 6000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const isUniqueViolation = (e: any): boolean => {
  const code = String(e?.code || "");
  const msg = String(e?.message || "");
  return code === "23505" || /duplicate key|unique/i.test(msg);
};

export type CoalesceOutcome = {
  // proceed: the worker should run the brain on this job.
  proceed: boolean;
  // winner: true only when this job won the durable claim and assembled the
  // burst. false here means either a loser (proceed:false) OR a fail-open
  // (proceed:true, winner:false, failOpen:true).
  winner: boolean;
  // failOpen: the coalescer degraded to the legacy single-message path because
  // of an error. The worker proceeds normally; no claim is held.
  failOpen?: boolean;
  // command: when winner, the assembled burst text (all unhandled inbound from
  // this sender since the last outbound, concatenated in order). The worker uses
  // this as the turn input so the single reply reflects everything they said.
  command?: string;
  // claimedMessageIds: the inbound rows folded into this turn (winner only).
  claimedMessageIds?: string[];
};

// Mark the claimed burst handled and release the durable claim. The worker calls
// this AFTER the reply is sent so a crash mid-brain leaves the claim to expire
// (TTL) and the messages still 'received' for the next drain to recover. Best
// effort: a failure here only risks a later harmless re-coalesce, never silence.
export async function finishTurn(contactId: string | null, messageIds: string[]): Promise<void> {
  if (!contactId) return;
  const db = admin();
  try {
    if (messageIds && messageIds.length) {
      await db.from("messages").update({ status: "coalesced" }).in("id", messageIds);
    }
  } catch { /* best effort */ }
  try {
    await db.from("wa_turn_claim").delete().eq("contact_id", contactId);
  } catch { /* best effort: the TTL sweep / next acquire overwrite covers it */ }
}

// Acquire the durable per-sender claim. Returns true if THIS job won it.
async function acquireClaim(db: any, contactId: string, traceId: string | null): Promise<boolean> {
  const now = Date.now();
  const expiresAt = new Date(now + CLAIM_TTL_MS).toISOString();
  // Fast path: try to insert. The PRIMARY KEY on contact_id rejects a concurrent
  // sibling (unique_violation) => that sibling is the loser.
  const { error } = await db
    .from("wa_turn_claim")
    .insert({ contact_id: contactId, claimed_at: new Date(now).toISOString(), expires_at: expiresAt, claimed_by: "whatsapp.worker", trace_id: traceId });
  if (!error) return true;
  if (!isUniqueViolation(error)) throw error; // schema-class error -> fail-open upstream
  // A row already exists. If it is EXPIRED (a crashed prior winner), steal it so
  // the sender is never wedged into silence. The steal is itself raced-safe: the
  // update is guarded on expires_at < now, so only one stealer wins.
  const { data: stolen } = await db
    .from("wa_turn_claim")
    .update({ claimed_at: new Date(now).toISOString(), expires_at: expiresAt, claimed_by: "whatsapp.worker", trace_id: traceId })
    .eq("contact_id", contactId)
    .lt("expires_at", new Date(now).toISOString())
    .select("contact_id");
  return Boolean(stolen && stolen.length);
}

// Assemble the burst: ALL unhandled inbound (status='received') from this contact
// SINCE the last outbound message, in chronological order, concatenated.
async function assembleBurst(db: any, contactId: string): Promise<{ command: string; ids: string[] }> {
  // Find the last OUTBOUND to bound the window to "since the last reply".
  const { data: lastOut } = await db
    .from("messages")
    .select("created_at")
    .eq("contact_id", contactId)
    .eq("channel", "whatsapp")
    .eq("direction", "out")
    .order("created_at", { ascending: false })
    .limit(1);
  const sinceISO: string | null = lastOut && lastOut[0] ? lastOut[0].created_at : null;

  let q = db
    .from("messages")
    .select("id,body,created_at")
    .eq("contact_id", contactId)
    .eq("channel", "whatsapp")
    .eq("direction", "in")
    .eq("status", "received")
    .order("created_at", { ascending: true })
    .limit(20);
  if (sinceISO) q = q.gt("created_at", sinceISO);
  const { data } = await q;
  const rows = (data || []) as { id: string; body: string | null }[];
  const ids = rows.map((r) => r.id);
  const command = rows
    .map((r) => String(r.body || "").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_BURST_CHARS);
  return { command, ids };
}

// The gate. Called by the worker inside processJob, BEFORE the brain.
//   - winner  -> { proceed:true, winner:true, command, claimedMessageIds }
//   - loser   -> { proceed:false, winner:false }  (worker marks job done, no send)
//   - failOpen-> { proceed:true, winner:false, failOpen:true } (worker uses the
//                 single message it already has and replies normally)
//
// `fallbackCommand` is the single-message text the worker already resolved, used
// only on the fail-open / empty-burst paths so the bot always has something to
// say. NOTE: this function does try/catch its own DB work and NEVER throws; the
// worker still wraps the call defensively per the fail-open seam.
export async function coalesceTurn(
  contactId: string | null,
  traceId: string | null,
  fallbackCommand: string,
): Promise<CoalesceOutcome> {
  // No contact to key the claim on -> nothing durable to coalesce against.
  // Process this message normally (fail-open, never silent).
  if (!contactId) return { proceed: true, winner: false, failOpen: true, command: fallbackCommand };

  const db = admin();
  let won = false;
  try {
    won = await acquireClaim(db, contactId, traceId);
  } catch (e: any) {
    // Schema-class error (e.g. wa_turn_claim table not yet migrated). FAIL-OPEN:
    // process this one message and reply, exactly like the pre-coalescer flow.
    try { await emit({ type: "whatsapp.coalesce_fail_open", source: "whatsapp", actor: "system", subject_type: "contact", subject_id: contactId, correlation_id: traceId || undefined, payload: { stage: "acquire", error: String(e?.message || e).slice(0, 240) } }); } catch {}
    return { proceed: true, winner: false, failOpen: true, command: fallbackCommand };
  }

  if (!won) {
    // LOSER. Another job for this sender holds the claim and will coalesce this
    // message's text into its turn. Mark THIS inbound handled so the burst read
    // does not double-count, and return without replying (exactly-once).
    try {
      const { data: mine } = await db
        .from("messages")
        .select("id")
        .eq("contact_id", contactId)
        .eq("channel", "whatsapp")
        .eq("direction", "in")
        .eq("status", "received")
        .eq("trace_id", traceId)
        .limit(1);
      // Do NOT flip to 'coalesced' here: the winner re-reads 'received' rows to
      // assemble the burst, so the loser's message must stay visible to the
      // winner. We only emit a no-op signal; the winner's finishTurn marks it.
      try { await emit({ type: "whatsapp.coalesce_noop", source: "whatsapp", actor: "system", subject_type: "contact", subject_id: contactId, correlation_id: traceId || undefined, payload: { reason: "another job holds the claim", had_row: Boolean(mine && mine.length) } }); } catch {}
    } catch { /* best effort */ }
    return { proceed: false, winner: false };
  }

  // WINNER. Settle so the rest of the human's burst lands, then assemble.
  try {
    await sleep(SETTLE_MS);
    const { command, ids } = await assembleBurst(db, contactId);
    // If the burst read came back empty (e.g. the rows were already marked by a
    // prior turn, or a transient read miss), fall back to the single message we
    // already have so we still reply. Never go silent.
    const finalCommand = command && command.trim() ? command : fallbackCommand;
    try { await emit({ type: "whatsapp.coalesced", source: "whatsapp", actor: "system", subject_type: "contact", subject_id: contactId, correlation_id: traceId || undefined, payload: { burst: ids.length, chars: finalCommand.length } }); } catch {}
    return { proceed: true, winner: true, command: finalCommand, claimedMessageIds: ids };
  } catch (e: any) {
    // Assembly failed AFTER we won the claim. Release it so the next drain can
    // recover, and fail-open on the single message (never silent).
    try { await db.from("wa_turn_claim").delete().eq("contact_id", contactId); } catch {}
    try { await emit({ type: "whatsapp.coalesce_fail_open", source: "whatsapp", actor: "system", subject_type: "contact", subject_id: contactId, correlation_id: traceId || undefined, payload: { stage: "assemble", error: String(e?.message || e).slice(0, 240) } }); } catch {}
    return { proceed: true, winner: false, failOpen: true, command: fallbackCommand };
  }
}
