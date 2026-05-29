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

// Resolve (or create) the contact row for a WhatsApp sender, so the conversation
// threads by contact_id across messages. Returns the contact id or null.
async function resolveContact(db: any, waId: string, name: string | null): Promise<string | null> {
  const phone = digits(waId);
  if (!phone) return null;
  const { data: found } = await db.from("contacts").select("id").eq("phone", phone).eq("channel", "whatsapp").limit(1);
  if (found && found.length) return found[0].id;
  const { data: made } = await db
    .from("contacts")
    .insert({ name: name || phone, phone, channel: "whatsapp" })
    .select("id")
    .single();
  return made?.id ?? null;
}

// --- POST: inbound messages + statuses -------------------------------------
export async function POST(req: NextRequest) {
  const raw = await req.text();

  // Verify Meta's signature when the app secret is configured. If unset (early
  // setup), accept so the flow works; once the secret is in env, spoofed calls
  // are rejected.
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (secret) {
    const sig = req.headers.get("x-hub-signature-256") || "";
    const expected = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
    if (!safeEqual(sig, expected)) {
      return new NextResponse("bad signature", { status: 401 });
    }
  }

  let shouldTrigger = false;
  try {
    const body = JSON.parse(raw || "{}");
    const db = admin();

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const v = change.value || {};
        const contacts: any[] = v.contacts || [];
        for (const m of v.messages || []) {
          const from = digits(m.from);
          const waMsgId = m.id || null;

          // DEDUPE: Meta retries webhooks. If we already stored this message id,
          // skip it entirely so the bot never double-replies.
          if (waMsgId) {
            const { data: dupe } = await db.from("messages").select("id").eq("external_id", waMsgId).limit(1);
            if (dupe && dupe.length) continue;
          }

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
          // Show the filename for a document (so the thread reads "STP Report.pdf"
          // not "[document]"); fall back to the bare type tag for other media.
          const body = caption || mediaName || (m.type && m.type !== "text" ? `[${m.type}]` : "");

          const contactId = await resolveContact(db, from, contactName);

          await db.from("messages").insert({
            channel: "whatsapp",
            direction: "in",
            body,
            handled_by: "whatsapp",
            status: "received",
            account: "whatsapp",
            external_id: waMsgId,
            contact_id: contactId,
          });

          await emit({
            type: "whatsapp.message_in",
            source: "whatsapp",
            actor: contactName || from,
            subject_type: "contact",
            subject_id: contactId,
            payload: { from, name: contactName, text: String(body).slice(0, 500), wa_message_id: waMsgId, type: m.type },
          });

          // Hand off to the worker. Text gets a reply; media (image/doc/audio/
          // video) gets read + processed there too. The worker enforces who may
          // get a response, so we enqueue for any meaningful inbound.
          if (body || mediaId) {
            await enqueueJob("whatsapp.reply", contactId, {
              from, name: contactName, text: caption, wa_message_id: waMsgId, contact_id: contactId,
              msg_type: m.type, media_id: mediaId, media_mime: mediaMime, media_name: mediaName,
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
