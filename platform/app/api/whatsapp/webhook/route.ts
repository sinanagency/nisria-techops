// WhatsApp Cloud API webhook (the bot's front door, P-bot).
//   GET  = Meta's one-time verification handshake (echoes hub.challenge when the
//          verify token matches WHATSAPP_VERIFY_TOKEN).
//   POST = inbound messages + delivery statuses. We verify Meta's signature (when
//          WHATSAPP_APP_SECRET is set), resolve the sender to a contact, store the
//          inbound message (deduped on the WhatsApp message id), then ENQUEUE a
//          whatsapp.reply job and return 200 immediately. A separate worker
//          (/api/whatsapp/worker) runs the slow brain + sends the reply, so Meta
//          never times out and never disables the webhook.
//
// This endpoint is public (Meta calls it unauthenticated) and is bypassed in
// middleware.ts. The reply (Sasa for operators, donor-comms for everyone else)
// is the worker's job; this is ingress + fast hand-off only.
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { admin } from "../../../../lib/supabase-admin";
import { emit } from "../../../../lib/events";
import { enqueueJob, triggerWorker } from "../../../../lib/jobs";
import { resolveContact, sendText, phoneKey } from "../../../../lib/whatsapp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// --- GET: verification handshake -------------------------------------------
export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const mode = sp.get("hub.mode");
  const token = sp.get("hub.verify_token");
  const challenge = sp.get("hub.challenge") || "";
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (mode === "subscribe" && expected && token === expected) {
    return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } });
  }
  return new NextResponse("forbidden", { status: 403 });
}

// constant-time compare that never throws on length mismatch
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

const digits = (s: string) => (s || "").replace(/\D/g, "");

// resolveContact now lives in lib/whatsapp.ts so the webhook (ingress) and the
// send chokepoint (egress) thread by the SAME contact_id. (One-brain law.)

// --- POST: inbound messages + statuses -------------------------------------
export async function POST(req: NextRequest) {
  const raw = await req.text();

  // Verify Meta's signature when the app secret is configured. If unset (early
  // setup), accept so the flow works; once the secret is in env, spoofed calls
  // are rejected.
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) {
    // L1 (2026-06-29): a MISSING app secret is a config error, not an attack. Returning
    // 500 here makes Meta retry then DISABLE the webhook subscription, which leaves the
    // bot permanently deaf even after the secret is restored (it needs a manual re-enable
    // in the Meta dashboard). Return 200 so the subscription survives, DROP the unverified
    // message (never process unsigned traffic), and fire a P0 so the gap is fixed fast.
    try {
      await emit({ type: "whatsapp.app_secret_missing", source: "api:whatsapp.webhook", actor: "system", subject_type: "config", subject_id: null, payload: { severity: "P0", note: "WHATSAPP_APP_SECRET unset; inbound dropped unverified to keep the Meta subscription alive" } });
    } catch { /* never block the 200 */ }
    return new NextResponse("ok", { status: 200 });
  }
  const sig = req.headers.get("x-hub-signature-256") || "";
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  if (!safeEqual(sig, expected)) {
    return new NextResponse("bad signature", { status: 401 });
  }

  let shouldTrigger = false;
  try {
    const body = JSON.parse(raw || "{}");
    const db = admin();

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const v = change.value || {};
        // Defense-in-depth: only accept payloads addressed to OUR WABA number.
        // (HMAC proves the caller knows the app secret but not that the message
        // targets us; this rejects a forged payload aimed at a different number.)
        const _pnid = v?.metadata?.phone_number_id;
        if (_pnid && process.env.WHATSAPP_PHONE_NUMBER_ID && String(_pnid) !== String(process.env.WHATSAPP_PHONE_NUMBER_ID)) continue;
        const contacts: any[] = v.contacts || [];
        for (const m of v.messages || []) {
          // Meta puts the REAL E.164 phone in contacts[].wa_id; m.from CAN be a
          // ~15-digit WhatsApp "lid" (linked-device / privacy identifier) that is
          // not a dialable number and false-spawns a DUPLICATE contact (the live
          // Nur lid 106274704363640, 2026-06-20, which blocked relays — KT #345).
          // In a 1:1 inbound there is exactly one contacts entry, so prefer its
          // wa_id; fall back to m.from only when there is no single contacts entry
          // (status-only payloads, or any non-1:1 fan-in). Group ingest is a
          // separate route, so this never touches group-JID handling.
          const waIdFromContacts = (v.contacts || []).length === 1 ? digits(v.contacts[0]?.wa_id) : "";
          const from = waIdFromContacts || digits(m.from);
          const waMsgId = m.id || null;

          // DEDUPE, ATOMIC (2026-06-12). Meta retries webhooks, and retries can
          // land CONCURRENTLY: the old select-then-skip raced (both invocations
          // miss the select, both insert, both enqueue → double reply). The
          // dedupe truth is now the partial UNIQUE INDEX on messages.external_id
          // (migration 2026-06-12_wall_and_efficiency.sql): we attempt the
          // insert FIRST; a unique violation means a sibling invocation already
          // owns this wamid, so we skip it entirely. One round trip, no race.

          const contactName = contacts.find((c) => digits(c.wa_id) === from)?.profile?.name || null;
          // The text we have on the message itself: a typed message, a button, or
          // the CAPTION on a media message (image/document captions carry text).
          const caption =
            m.text?.body ||
            m.button?.text ||
            m.interactive?.list_reply?.title ||
            m.interactive?.button_reply?.title ||
            m.image?.caption ||
            m.document?.caption ||
            m.video?.caption ||
            "";
          // Any attached media (image / document / audio / video / voice).
          const media = m.image || m.document || m.audio || m.video || m.voice || null;
          const mediaId: string | null = media?.id || null;
          const mediaMime: string | null = media?.mime_type || null;
          const mediaName: string | null = m.document?.filename || null;
          // Reaction payload (WhatsApp delivers reactions as type:"reaction" with
          // m.reaction.message_id = the wamid of the message being reacted to, and
          // m.reaction.emoji = the emoji). The worker's reaction handler reads
          // reaction_target_id off the enqueued job and the emoji off command,
          // so route both through.
          const reactionTargetId: string | null = m.type === "reaction" && m.reaction?.message_id ? String(m.reaction.message_id) : null;
          const reactionEmoji: string | null = m.type === "reaction" && m.reaction?.emoji ? String(m.reaction.emoji) : null;
          // Swipe-to-reply anchor (WhatsApp Cloud API). When the user reply-quotes
          // a specific prior message, Meta includes messages[].context.id = the
          // wamid of the quoted message. We persist it on the inbound row and
          // thread it to the worker so the LLM turn gets anchored to the same
          // subject Nur was pointing at (no fuzzy fragment match for "done",
          // "got it", or any partial verb-target phrase).
          const replyToExternalId: string | null = m.context?.id ? String(m.context.id) : null;
          // Show the filename for a document (so the thread reads "STP Report.pdf"
          // not "[document]"); fall back to the bare type tag for other media.
          const body = caption || mediaName || (m.type === "reaction" && reactionEmoji ? reactionEmoji : (m.type && m.type !== "text" ? `[${m.type}]` : ""));

          const contactId = await resolveContact(db, from, contactName);
          const traceId = crypto.randomUUID();

          const { error: insErr } = await db.from("messages").insert({
            channel: "whatsapp",
            direction: "in",
            body,
            handled_by: "whatsapp",
            status: "received",
            account: "whatsapp",
            external_id: waMsgId,
            contact_id: contactId,
            reply_to_external_id: replyToExternalId,
            trace_id: traceId,
          });
          // Mirror inbound into Chatwoot (Path B, read-only). Best-effort.
          try {
            const { mirrorToChatwoot } = await import("@/lib/chatwoot-mirror");
            mirrorToChatwoot("incoming", from, body).catch(() => {});
          } catch { /* never block */ }
          // Mirror inbound to the owner (Taona) so he sees every Sasa conversation.
          const taonaKey = phoneKey(process.env.OWNER_WHATSAPP?.split(",")[0] || "");
          const senderKey = phoneKey(from);
          if (taonaKey && senderKey && senderKey !== taonaKey) {
            const name = contactName ? `${contactName} (${from})` : from;
            sendText(taonaKey, `[Sasa mirror] ${name}: ${body}`).catch(() => {});
          }
          if (insErr) {
            if (/duplicate key|unique/i.test(insErr.message || "")) continue; // Meta retry: already owned
            // SCHEMA DRIFT (2026-06-15 cascade lesson): a missing column / table
            // / function is NOT a transient failure. The worker resolves the
            // message row lazily, so failing OPEN here means the agent runs the
            // turn on STALE history (its view of the conversation freezes at the
            // last successfully persisted inbound). On 2026-06-15 23:07-23:19,
            // 11 swipe-reply inbounds hit 42703 reply_to_external_id-missing,
            // ingress fail-opened, and the agent emitted 12 off-topic Mark
            // replies while the operator typed "I told you 10 times" + 😫. Hard
            // refuse to enqueue when the error code is a schema-class SQLSTATE.
            // Transient (timeout, network) errors keep the legacy lossless path
            // because the worker can recover from those without a stale-history
            // failure mode.
            const pgCode = String((insErr as any).code || "");
            const SCHEMA_DRIFT_CODES = /^(42703|42P01|42883|42704|23502|42P10)$/;
            if (SCHEMA_DRIFT_CODES.test(pgCode)) {
              try { await emit({ type: "whatsapp.schema_drift", source: "whatsapp", actor: "system", subject_type: "contact", subject_id: contactId, correlation_id: traceId, payload: { stage: "ingress_insert", pg_code: pgCode, error: String(insErr.message || insErr).slice(0, 300), wa_message_id: waMsgId, from } }); } catch {}
              try {
                const { pushIncident } = await import("@/lib/notify");
                await pushIncident("whatsapp.ingress", `Schema drift on messages insert: inbound from ${from} dropped, pg_code=${pgCode} ${String(insErr.message).slice(0, 200)}. Apply the missing migration.`);
              } catch {}
              continue; // do NOT enqueue worker; do NOT emit message_in
            }
            try { await emit({ type: "whatsapp.error", source: "whatsapp", actor: "system", correlation_id: traceId, payload: { stage: "ingress_insert", error: String(insErr.message || insErr).slice(0, 240), wa_message_id: waMsgId } }); } catch {}
          }

          await emit({
            type: "whatsapp.message_in",
            source: "whatsapp",
            actor: contactName || from,
            subject_type: "contact",
            subject_id: contactId,
            correlation_id: traceId,
            payload: { from, name: contactName, text: String(body).slice(0, 500), wa_message_id: waMsgId, type: m.type },
          });

          // Hand off to the worker. Text gets a reply; media (image/doc/audio/
          // video) gets read + processed there too. The worker enforces who may
          // get a response, so we enqueue for any meaningful inbound.
          if (body || mediaId || reactionTargetId) {
            await enqueueJob("whatsapp.reply", contactId, {
              from, name: contactName, text: reactionEmoji || caption, wa_message_id: waMsgId, contact_id: contactId,
              msg_type: m.type, media_id: mediaId, media_mime: mediaMime, media_name: mediaName,
              reaction_target_id: reactionTargetId, reaction_emoji: reactionEmoji,
              reply_to_external_id: replyToExternalId,
              trace_id: traceId,
            });
            shouldTrigger = true;
          }
        }
      }
    }
  } catch (e: any) {
    try { await emit({ type: "whatsapp.error", source: "whatsapp", actor: "system", payload: { stage: "ingress", error: String(e?.message || e).slice(0, 300) } }); } catch {}
  }

  // Fire-and-forget the worker so the brain runs off the webhook's response path.
  if (shouldTrigger) triggerWorker("/api/whatsapp/worker");
  return NextResponse.json({ received: true });
}
