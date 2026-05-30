// GROUP LINK QR relay. The userbot can't show its QR to Nur directly (it runs on
// a laptop / Railway), and a WhatsApp QR only lives ~30s. So the bot pushes its
// CURRENT QR here every time it refreshes, and the portal's Groups page shows a
// live, auto-refreshing QR that Nur can scan whenever Mark is back. No babysitting.
//
// POST  (x-group-secret): the bot upserts { qr dataURL, connected, ts }
// GET   (logged-in session OR x-group-secret): returns the current link state
// The QR is a WhatsApp linking secret, so GET requires the portal session cookie.
import { NextRequest, NextResponse } from "next/server";
import { admin } from "../../../../lib/supabase-admin";
import { emit } from "../../../../lib/events";
import { sendText } from "../../../../lib/whatsapp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const KEY = "group_link";

// States where the group eyes have gone dark. When the bot transitions INTO one
// of these, Nur gets an urgent 727 text once (latched, so a flapping connection
// does not spam her). The latch clears when the bot reports "connected" again.
const DOWN = new Set(["banned", "logged_out"]);
const DOWN_MSG: Record<string, string> = {
  banned:
    "Urgent: the Nisria group number looks blocked by WhatsApp, so the team groups are not being watched right now. Nothing said in them is being captured. Reply here and we will move it onto a fresh number.",
  logged_out:
    "Urgent: the Nisria group number was logged out, so the team groups are not being watched right now. It needs to be re-linked. Reply here and we will sort it.",
};

async function alertOperators(status: string) {
  const text = DOWN_MSG[status] || "Urgent: the Nisria group bot is offline, the team groups are not being watched right now.";
  const nums = (process.env.WHATSAPP_OPERATORS || "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const n of nums) { try { await sendText(n, text); } catch {} }
  await emit({ type: "group.bot_down", source: "group-bot", actor: "group-bot", subject_type: "job", subject_id: null, payload: { status, notified: nums.length } });
}

function bySecret(req: NextRequest) {
  return (req.headers.get("x-group-secret") || "") === (process.env.GROUP_BOT_SECRET || "\0");
}
function bySession(req: NextRequest) {
  return (req.cookies.get("nisria_session")?.value || "") === (process.env.SESSION_TOKEN || "\0");
}

export async function POST(req: NextRequest) {
  if (!bySecret(req)) return NextResponse.json({ ok: false }, { status: 401 });
  let b: any; try { b = await req.json(); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }
  // status: "connected" | "banned" | "logged_out" | "waiting". The bot sets it; we
  // derive a sane default for older payloads that only send `connected`.
  const status = b.status || (b.connected ? "connected" : "waiting");
  const db = admin();

  // compare against the prior state so we only alert on the DOWN transition, and
  // only once per outage (alerted_status latches until we are connected again).
  const { data: prevRow } = await db.from("bot_status").select("value").eq("key", KEY).maybeSingle();
  const prev: any = prevRow?.value || {};
  let alertedStatus = prev.alerted_status || null;

  if (DOWN.has(status) && prev.status !== status && alertedStatus !== status) {
    await alertOperators(status);
    alertedStatus = status;
  }
  if (status === "connected") alertedStatus = null; // re-arm for the next outage

  const value = { qr: b.qr || null, connected: !!b.connected, status, ts: b.ts || new Date().toISOString(), alerted_status: alertedStatus };
  await db.from("bot_status").upsert({ key: KEY, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest) {
  if (!bySession(req) && !bySecret(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const { data } = await admin().from("bot_status").select("value,updated_at").eq("key", KEY).maybeSingle();
  const v: any = data?.value || {};
  const ageMs = data?.updated_at ? Date.now() - new Date(data.updated_at).getTime() : Infinity;

  // LIVENESS (#10): the bot writes a poll heartbeat every ~4s while it is running
  // (see /api/group/outbox). If that heartbeat is fresh, the bot is ALIVE, so report
  // connected and hide the QR, even if a stale or ghost-replica write left the flag
  // on "waiting". The QR only returns when the bot truly stops polling.
  const { data: hb } = await admin().from("bot_status").select("updated_at").eq("key", "group_poll").maybeSingle();
  const pollAgeMs = hb?.updated_at ? Date.now() - new Date(hb.updated_at).getTime() : Infinity;
  const alive = pollAgeMs < 60_000;

  const connected = alive || !!v.connected;
  const status = connected ? "connected" : (v.status || "waiting");
  return NextResponse.json({ ok: true, connected, status, qr: connected ? null : (v.qr || null), stale: !connected && ageMs > 90_000, alive, updated_at: data?.updated_at || null });
}
