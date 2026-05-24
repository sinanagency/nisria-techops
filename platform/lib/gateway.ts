// The Action Gateway: agents emit INTENTS, the gateway gates them by autonomy
// lane and (when cleared) executes them against the real connector. Centralized,
// logged, idempotent. Money + PII actions always land in approve/escalate lanes.
import { admin } from "./supabase-admin";
import { emit } from "./events";
import { remember } from "./memory";
import { sendEmail } from "./email";

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

// Dispatch an intent to its real connector.
async function dispatch(intent: any): Promise<any> {
  const key = `${intent.connector}.${intent.action}`;
  const p = intent.params || {};
  switch (key) {
    case "email.send_email":
      await sendEmail(p.to, p.subject, p.text);
      return { sent: true, to: p.to };
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

  // sync any edits into the linked intent's params before firing
  let result: any = { ok: true };
  if (ap.intent_id) {
    if (opts.edited) {
      const params = mapProposedToParams(ap.kind, proposed);
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

function mapProposedToParams(kind: string, proposed: any): Record<string, any> {
  if (kind === "email_reply" || kind === "donor_thankyou") return { to: proposed.to, subject: proposed.subject, text: proposed.body };
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
