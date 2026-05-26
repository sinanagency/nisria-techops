// WhatsApp Cloud API webhook (the bot's front door, P-bot).
//   GET  = Meta's one-time verification handshake (echoes hub.challenge when the
//          verify token matches WHATSAPP_VERIFY_TOKEN).
//   POST = inbound messages + delivery statuses. We verify Meta's signature (when
//          WHATSAPP_APP_SECRET is set), store each inbound message (channel
//          'whatsapp', matched to the team member by phone), and emit an event so
//          the bot pipeline can act on it. We ALWAYS return 200 fast so Meta never
//          disables the webhook; processing failures are swallowed + logged.
//
// This endpoint is public (Meta calls it unauthenticated) and is bypassed in
// middleware.ts. Sending replies + parsing reports/invoices into the platform is
// the next layer (lib/whatsapp + the bot agent); this is the ingress only.
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { admin } from "../../../../lib/supabase-admin";
import { emit } from "../../../../lib/events";

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
    // Meta requires the raw challenge echoed back as text/plain.
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

// normalise a phone to digits-only for matching against team_members
const digits = (s: string) => (s || "").replace(/\D/g, "");

// --- POST: inbound messages + statuses -------------------------------------
export async function POST(req: NextRequest) {
  const raw = await req.text();

  // Verify Meta's signature when the app secret is configured. If it is not set
  // yet (early setup), we accept so the handshake/test flow works; once the
  // secret is in env, spoofed calls are rejected.
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (secret) {
    const sig = req.headers.get("x-hub-signature-256") || "";
    const expected = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
    if (!safeEqual(sig, expected)) {
      return new NextResponse("bad signature", { status: 401 });
    }
  }

  try {
    const body = JSON.parse(raw || "{}");
    const db = admin();
    const team: any[] = (await db.from("team_members").select("id,name,phone")).data || [];
    const byPhone = new Map<string, any>(team.map((t: any) => [digits(t.phone), t]));

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const v = change.value || {};
        const contacts: any[] = v.contacts || [];
        for (const m of v.messages || []) {
          const from = digits(m.from);
          const member: any = byPhone.get(from) || null;
          const contactName = contacts.find((c) => digits(c.wa_id) === from)?.profile?.name || null;
          const text =
            m.text?.body ||
            m.button?.text ||
            m.interactive?.list_reply?.title ||
            m.interactive?.button_reply?.title ||
            (m.type && m.type !== "text" ? `[${m.type} message]` : "");

          // store the inbound message so nothing is lost, even before the bot
          // pipeline parses it into a report / invoice / task update.
          await db.from("messages").insert({
            channel: "whatsapp",
            direction: "in",
            body: text,
            handled_by: "whatsapp",
            status: "received",
            account: "whatsapp",
          });

          await emit({
            type: "whatsapp.message_in",
            source: "whatsapp",
            actor: member?.name || contactName || from,
            subject_type: member ? "team_member" : "contact",
            subject_id: member?.id ?? null,
            payload: { from, name: member?.name || contactName, text: String(text).slice(0, 500), wa_message_id: m.id, type: m.type },
          });
        }
      }
    }
  } catch (e: any) {
    // never fail the webhook back to Meta; log and move on
    try { await emit({ type: "whatsapp.error", source: "whatsapp", actor: "system", payload: { error: String(e?.message || e).slice(0, 300) } }); } catch {}
  }

  return NextResponse.json({ received: true });
}
