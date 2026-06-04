// The Action Gateway: agents emit INTENTS, the gateway gates them by autonomy
// lane and (when cleared) executes them against the real connector. Centralized,
// logged, idempotent. Money + PII actions always land in approve/escalate lanes.
import { admin } from "./supabase-admin";
import { emit } from "./events";
import { remember } from "./memory";
import { sendEmail } from "./email";
import { parseAttachRefs, resolveAttachments } from "./email-attachments";
import { pushApprovalRequest } from "./notify";
import { runBlast } from "./outreach";

export type Lane = "auto" | "approve" | "escalate";

// Read the autonomy dial for a scope (kind:x or connector:x). Default: approve.
export async function laneFor(scope: string): Promise<Lane> {
  const { data } = await admin().from("autonomy_rules").select("lane").eq("scope", scope).maybeSingle();
  return ((data?.lane as Lane) || "approve");
}

export async function createIntent(i: {
  connector: string;
  action: string;
  params: Record<string, any>;
  lane: Lane;
  risk?: string;
  requested_by?: string;
  correlation_id?: string | null;
  idempotency_key?: string;
}) {
  const status = i.lane === "auto" ? "approved" : "awaiting_approval";
  const { data, error } = await admin()
    .from("action_intents")
    .insert({
      connector: i.connector,
      action: i.action,
      params: i.params,
      lane: i.lane,
      risk: i.risk || "low",
      status,
      requested_by: i.requested_by || "system",
      correlation_id: i.correlation_id || null,
      idempotency_key: i.idempotency_key || null,
    })
    .select()
    .single();
  if (error && !/duplicate key/i.test(error.message)) throw new Error(error.message);
  return data;
}

// Idempotent approval insert. Before queuing ANY approval we check for an
// existing PENDING approval keyed to the same source (a message_id, a
// donation_id, or an explicit correlation key), and skip if one is already
// waiting. This is the single guard that kills duplicate "Needs You" cards —
// the email-reply path used to insert unconditionally (so a reopened-by-reject
// message got re-drafted into a second card), and a swallowed duplicate-key
// intent (data=null) used to still produce an orphan approval that couldn't send.
//
// Returns the existing approval if found (created=false), or the new one
// (created=true). Returns created=false with row=null when an insert is skipped
// because the linked intent was a swallowed duplicate (intentMissing).
export async function queueApproval(args: {
  kind: string;
  // dedupe scope: at least one must be set
  messageId?: string | null;
  donationId?: string | null;
  dedupeKey?: string | null; // free-form key stored at context.dedupe_key
  // the row to insert if none exists yet
  row: Record<string, any>;
  // if the linked intent came back null due to a swallowed duplicate key, skip
  intentMissing?: boolean;
}): Promise<{ created: boolean; row: any }> {
  const db = admin();

  // 1) already a pending approval for this exact source?
  let q = db.from("approvals").select("id,status").eq("kind", args.kind).eq("status", "pending");
  if (args.messageId) q = q.eq("context->>message_id", args.messageId);
  else if (args.donationId) q = q.eq("context->>donation_id", args.donationId);
  else if (args.dedupeKey) q = q.eq("context->>dedupe_key", args.dedupeKey);
  const { data: existing } = await q.limit(1);
  if (existing && existing.length) return { created: false, row: existing[0] };

  // 2) a swallowed duplicate-key intent means this work is already queued
  //    elsewhere — do NOT create an orphan approval with intent_id=null.
  if (args.intentMissing) return { created: false, row: null };

  const { data } = await db.from("approvals").insert(args.row).select().single();
  // A genuinely NEW Needs-You item: ping Nur in real time (best-effort, never
  // blocks the queue write). Covers every approval kind since all funnel here.
  if (data) await pushApprovalRequest(db, { id: data.id, title: data.title, kind: data.kind });
  return { created: true, row: data };
}

// Dispatch an intent to its real connector.
async function dispatch(intent: any): Promise<any> {
  const key = `${intent.connector}.${intent.action}`;
  const p = intent.params || {};
  switch (key) {
    case "email.send_email": {
      // account (sasa@ vs maisha@) picks the branded signature; attach refs
      // become real attachments (Studio doc -> PDF/HTML, Library asset -> file).
      const refs = parseAttachRefs(p.attach_refs);
      const { attachments, labels } = await resolveAttachments(refs);
      await sendEmail(p.to, p.subject, p.text, { account: p.account || null, attachments });
      return { sent: true, to: p.to, attachments: labels };
    }
    case "outreach.blast": {
      // A newsletter / email blast Nur approved in Needs You. Runs the one shared
      // send engine (capped, throttled, opt-out footer). A total failure throws so
      // the intent is marked failed; partial sends return their tally.
      const res = await runBlast({ subject: p.subject, body: p.body, audience: p.audience, actor: p.actor || "Nur" });
      if (!res.ok && res.sent === 0) throw new Error(res.message || "blast failed");
      return res;
    }
    default:
      throw new Error(`Connector "${key}" not enabled yet`);
  }
}

export async function executeIntent(intentId: string) {
  const db = admin();
  const { data: intent } = await db.from("action_intents").select("*").eq("id", intentId).single();
  if (!intent) throw new Error("intent not found");
  if (intent.status === "done") return { ok: true, already: true };
  await db.from("action_intents").update({ status: "executing" }).eq("id", intentId);
  try {
    const result = await dispatch(intent);
    await db.from("action_intents").update({ status: "done", result, executed_at: new Date().toISOString() }).eq("id", intentId);
    await emit({ type: "action.executed", source: `connector:${intent.connector}`, actor: "gateway", correlation_id: intent.correlation_id, payload: { intent_id: intentId, action: intent.action, result } });
    return { ok: true, result };
  } catch (e: any) {
    const error = e?.message || String(e);
    await db.from("action_intents").update({ status: "failed", error }).eq("id", intentId);
    await emit({ type: "action.failed", source: `connector:${intent.connector}`, actor: "gateway", correlation_id: intent.correlation_id, payload: { intent_id: intentId, error } });
    return { ok: false, error };
  }
}

// Nur approves a queued item from Mission Control. Optionally edited the draft.
export async function approveApproval(approvalId: string, opts: { edited?: Record<string, any>; decidedBy?: string } = {}) {
  const db = admin();
  const { data: ap } = await db.from("approvals").select("*").eq("id", approvalId).single();
  if (!ap) throw new Error("approval not found");
  if (ap.status !== "pending") return { ok: true, already: ap.status };

  const proposed = { ...(ap.proposed || {}), ...(opts.edited || {}) };

  // sync any edits into the linked intent's params before firing. We resync
  // even when only attachments were added (no subject/body edit), so the account
  // branding + attach refs always reach the connector.
  let result: any = { ok: true };
  if (ap.intent_id) {
    if (opts.edited) {
      const params = mapProposedToParams(ap.kind, proposed, ap.context || {});
      await db.from("action_intents").update({ params, status: "approved" }).eq("id", ap.intent_id);
    } else {
      await db.from("action_intents").update({ status: "approved" }).eq("id", ap.intent_id);
    }
    result = await executeIntent(ap.intent_id);
  }

  await db.from("approvals").update({
    status: opts.edited ? "edited" : "approved",
    proposed,
    decided_by: opts.decidedBy || "Nur",
    decided_at: new Date().toISOString(),
  }).eq("id", approvalId);

  // side-effects + learning loop per kind
  await onApproved(ap, proposed);
  await emit({ type: "approval.approved", source: "nur", actor: opts.decidedBy || "Nur", correlation_id: ap.context?.correlation_id, payload: { approval_id: approvalId, kind: ap.kind, result } });
  return result;
}

export async function rejectApproval(approvalId: string, opts: { decidedBy?: string; note?: string } = {}) {
  const db = admin();
  const { data: ap } = await db.from("approvals").select("*").eq("id", approvalId).single();
  if (!ap) throw new Error("approval not found");
  if (ap.intent_id) await db.from("action_intents").update({ status: "cancelled" }).eq("id", ap.intent_id);
  await db.from("approvals").update({ status: "rejected", decided_by: opts.decidedBy || "Nur", decided_at: new Date().toISOString(), decision_note: opts.note || null }).eq("id", approvalId);
  // reopen the source message so it's not lost
  if (ap.kind === "email_reply" && ap.context?.message_id) {
    await db.from("messages").update({ status: "new" }).eq("id", ap.context.message_id);
  }
  await emit({ type: "approval.rejected", source: "nur", actor: opts.decidedBy || "Nur", payload: { approval_id: approvalId, kind: ap.kind } });
  return { ok: true };
}

function mapProposedToParams(kind: string, proposed: any, context: any = {}): Record<string, any> {
  if (kind === "email_reply" || kind === "donor_thankyou") {
    return {
      to: proposed.to,
      subject: proposed.subject,
      text: proposed.body,
      // account drives the branded signature; the sender account lives in
      // context (sasa@ vs maisha@). attach_refs are picked by Nur on the card.
      account: proposed.account || context.account || null,
      attach_refs: proposed.attach_refs || null,
    };
  }
  return proposed;
}

// What happens after an approval fires: log the outbound, learn from it.
async function onApproved(ap: any, proposed: any) {
  const db = admin();
  if (ap.kind === "email_reply") {
    const ctx = ap.context || {};
    // record the outbound message on the thread
    await db.from("messages").insert({
      contact_id: ctx.contact_id || null,
      channel: "email",
      direction: "out",
      subject: proposed.subject || null,
      body: proposed.body || "",
      handled_by: "agent:comms",
      status: "replied",
    });
    if (ctx.message_id) await db.from("messages").update({ status: "replied", handled_by: "agent:comms" }).eq("id", ctx.message_id);
    // LEARNING LOOP: store the approved reply so future drafts sound like Nur
    await remember({
      kind: "approved_reply",
      brand: ctx.brand || null,
      title: `Reply: ${proposed.subject || ""}`.slice(0, 120),
      content: `When someone wrote about "${ctx.subject || ""}", the approved reply was:\n${proposed.body || ""}`,
      metadata: { from: ctx.from, edited: ap.status === "edited" },
      source_type: "approval",
      source_id: ap.id,
    });
  }
  if (ap.kind === "donor_thankyou") {
    const ctx = ap.context || {};
    await remember({
      kind: "approved_reply",
      title: `Thank-you: ${proposed.subject || ""}`.slice(0, 120),
      content: `Approved donor thank-you (gift ${ctx.amount || ""}):\n${proposed.body || ""}`,
      metadata: { donor: ctx.name, edited: ap.status === "edited" },
      source_type: "approval",
      source_id: ap.id,
    });
    if (ctx.donor_id) await db.from("donors").update({ notes: `Thanked ${new Date().toISOString().slice(0, 10)} by Donor Steward` }).eq("id", ctx.donor_id);
  }
}
