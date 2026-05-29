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

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const KEY = "group_link";

function bySecret(req: NextRequest) {
  return (req.headers.get("x-group-secret") || "") === (process.env.GROUP_BOT_SECRET || "\0");
}
function bySession(req: NextRequest) {
  return (req.cookies.get("nisria_session")?.value || "") === (process.env.SESSION_TOKEN || "\0");
}

export async function POST(req: NextRequest) {
  if (!bySecret(req)) return NextResponse.json({ ok: false }, { status: 401 });
  let b: any; try { b = await req.json(); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }
  const value = { qr: b.qr || null, connected: !!b.connected, ts: b.ts || new Date().toISOString() };
  await admin().from("bot_status").upsert({ key: KEY, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest) {
  if (!bySession(req) && !bySecret(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const { data } = await admin().from("bot_status").select("value,updated_at").eq("key", KEY).maybeSingle();
  const v: any = data?.value || {};
  // stale if the bot stopped pushing for >90s (QR no longer valid / bot down)
  const ageMs = data?.updated_at ? Date.now() - new Date(data.updated_at).getTime() : Infinity;
  return NextResponse.json({ ok: true, connected: !!v.connected, qr: v.qr || null, stale: ageMs > 90_000, updated_at: data?.updated_at || null });
}
