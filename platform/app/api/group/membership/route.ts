// The group-bot publishes the REAL identity of every WhatsApp group it is in
// (subject + avatar + jid + participant count) here. We upsert it into the groups
// table so the portal can show proper group icons and the true subject, instead of
// deriving a name from messages.account and drawing one generic icon for all.
//
// Additive and safe: nothing else reads the groups table yet on live, so this can
// run before the redesign swaps in. Auth mirrors the ingest endpoint (shared
// secret header). Keyed by group name so it lines up with messages.account.
import { NextRequest, NextResponse } from "next/server";
import { admin } from "../../../../lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Incoming = {
  name?: string;
  subject?: string;
  jid?: string;
  avatar_url?: string | null;
  participant_count?: number | null;
};

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-group-secret") || "";
  if (!process.env.GROUP_BOT_SECRET || secret !== process.env.GROUP_BOT_SECRET) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: any = {};
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 }); }

  const list: Incoming[] = Array.isArray(body?.groups) ? body.groups : [];
  if (!list.length) return NextResponse.json({ ok: true, upserted: 0 });

  const rows = list
    .map((g) => {
      const name = String(g.subject || g.name || "").trim().slice(0, 200);
      if (!name) return null;
      return {
        name,
        subject: String(g.subject || g.name || "").trim().slice(0, 200) || null,
        jid: g.jid ? String(g.jid).slice(0, 120) : null,
        avatar_url: g.avatar_url ? String(g.avatar_url).slice(0, 1000) : null,
        participant_count: Number.isFinite(g.participant_count as number) ? Number(g.participant_count) : null,
        updated_at: new Date().toISOString(),
      };
    })
    .filter(Boolean) as any[];

  if (!rows.length) return NextResponse.json({ ok: true, upserted: 0 });

  const db = admin();
  const { error } = await db.from("groups").upsert(rows, { onConflict: "name" });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, upserted: rows.length });
}
