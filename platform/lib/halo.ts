// HALO client — Sasa's social publishing goes through Halo (Taona's social-OS),
// which owns the connected FB/IG channels + per-brand learned voice. We never call
// Meta directly. Bot API: POST /api/bot/draft (multipart) + /api/bot/publish (JSON),
// authed with x-halo-key. See HALO-SASA-INTEGRATION-TASK.md.
const BASE = () => (process.env.HALO_BASE_URL || "https://halo-production-43df.up.railway.app").replace(/\/$/, "");
const KEY = () => process.env.HALO_API_KEY || "";

export type HaloDraft = { postId: string; brand: string; platforms: string[]; summary?: string; question?: string | null; drafts: { platform: string; caption: string; hashtags?: string; bestSlot?: string }[]; mediaUrl?: string };

// Draft a caption in the brand's learned voice. Pass a text `note` (an idea) and/or
// a `mediaUrl` (we fetch + forward the media as the file part).
export async function haloDraft(opts: { tenant: string; note?: string; mediaUrl?: string; platforms?: string; hint?: string }): Promise<HaloDraft> {
  if (!KEY()) throw new Error("HALO_API_KEY not set");
  const fd = new FormData();
  fd.set("tenant", opts.tenant);
  if (opts.note) fd.set("note", opts.note);
  if (opts.platforms) fd.set("platforms", opts.platforms);
  if (opts.hint) fd.set("hint", opts.hint);
  if (opts.mediaUrl) {
    const m = await fetch(opts.mediaUrl);
    if (!m.ok) throw new Error(`could not fetch media (${m.status})`);
    const buf = await m.arrayBuffer();
    const ct = m.headers.get("content-type") || "application/octet-stream";
    fd.set("file", new Blob([buf], { type: ct }), "media");
  }
  const r = await fetch(`${BASE()}/api/bot/draft`, { method: "POST", headers: { "x-halo-key": KEY() }, body: fd, cache: "no-store" });
  if (!r.ok) throw new Error((await r.json().catch(() => ({} as any)))?.error || `Halo draft failed (${r.status})`);
  return r.json();
}

export async function haloPublish(opts: { postId: string; caption?: string; hashtags?: string }): Promise<{ status: string; results: { platform: string; ok: boolean; externalPostId?: string; error?: string; draftOnly?: boolean }[] }> {
  if (!KEY()) throw new Error("HALO_API_KEY not set");
  const r = await fetch(`${BASE()}/api/bot/publish`, { method: "POST", headers: { "x-halo-key": KEY(), "content-type": "application/json" }, body: JSON.stringify(opts), cache: "no-store" });
  if (!r.ok) throw new Error((await r.json().catch(() => ({} as any)))?.error || `Halo publish failed (${r.status})`);
  return r.json();
}
