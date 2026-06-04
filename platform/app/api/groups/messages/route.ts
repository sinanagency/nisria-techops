// Read-only feed for the Groups chat UI. Returns the recent messages of one
// group, each resolved to its sender and flagged `mine` (the owner, Nur, or the
// bot) so the client can render WhatsApp-style: owner right, everyone else left.
// Powers both the inline chat and each FocusSheet sibling (so switching groups is
// client-side and smooth, no page reload).
import { NextRequest, NextResponse } from "next/server";
import { admin } from "../../../../lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OWNER = /nur|sasa/i; // renders on the right (the owner / the bot)

// WhatsApp system notices that shouldn't render as chat bubbles (WhatsApp itself
// hides them). Dropped from the feed so the conversation reads clean.
const SYSTEM = /(security code (with .+ )?changed|Messages and calls are end-to-end encrypted|created this group|created group|joined using|changed the subject to|changed this group's icon|changed the group description|You're now an admin|changed their phone number|pinned a message|This message was deleted|deleted this group|turned on admin|turned off admin|changed the group settings)/i;

export async function GET(req: NextRequest) {
  const group = new URL(req.url).searchParams.get("g") || "";
  if (!group) return NextResponse.json({ messages: [] });
  const db = admin();

  const { data: raw } = await db
    .from("messages")
    .select("id,body,direction,created_at,media_path,media_mime,contact:contacts(id,name)")
    .eq("channel", "whatsapp").eq("sender_type", "group").eq("account", group)
    .order("created_at", { ascending: false }).limit(500);

  // map sender name -> team profile so the name can deep-link to where you assign
  const { data: team } = await db.from("team_members").select("id,name");
  const byName = new Map<string, string>();
  for (const t of (team || []) as any[]) byName.set(String(t.name || "").toLowerCase(), t.id);

  // sign the stored media so photos/docs posted in the group render inline in the
  // chat (private bucket). One batched signing call for every message that carries
  // a media_path, keyed back by path.
  const paths = [...new Set(((raw || []) as any[]).map((m) => m.media_path).filter(Boolean))] as string[];
  const urlByPath = new Map<string, string>();
  if (paths.length) {
    const { data: signed } = await db.storage.from("assets").createSignedUrls(paths, 3600);
    for (const s of (signed || []) as any[]) if (s?.signedUrl && s?.path) urlByPath.set(s.path, s.signedUrl);
  }

  const messages = ((raw || []) as any[]).reverse().filter((m) => {
    const b = (m.body || "").trim();
    // keep a message if it has real text OR a media attachment (a bare "[image]"
    // with a media_path is now a real, renderable photo, not noise).
    return (b && !SYSTEM.test(b)) || !!m.media_path;
  }).map((m) => {
    const c = Array.isArray(m.contact) ? m.contact[0] : m.contact;
    const out = m.direction === "out";
    const name = out && !c?.name ? "Sasa" : (c?.name || "Unknown");
    const mine = out || OWNER.test(name);
    const tid = byName.get(String(name).toLowerCase());
    const href = mine ? null : (tid ? `/team/${tid}` : c?.id ? `/contacts/${c.id}` : null);
    const url = m.media_path ? urlByPath.get(m.media_path) || null : null;
    const media = url ? { url, mime: m.media_mime || "" } : null;
    return { id: m.id, body: m.body || "", name, mine, at: m.created_at, href, media };
  });

  return NextResponse.json({ group, messages });
}
