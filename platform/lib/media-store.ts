// Store an inbound WhatsApp attachment (receipt, screenshot, PDF) in the private
// assets bucket and register it as an asset, so it stays viewable in the portal
// (the message thread + as payment proof) instead of living only inside WhatsApp.
// Best-effort: never throws into the caller, a failed store must not break the reply.
import { admin } from "./supabase-admin";

function extFor(mime: string): string {
  const m = (mime || "").toLowerCase();
  if (m.includes("pdf")) return "pdf";
  if (m.includes("png")) return "png";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("sheet") || m.includes("excel")) return "xlsx";
  if (m.includes("webp")) return "webp";
  return "bin";
}

export async function storeMedia(opts: {
  base64: string; mime: string; name?: string | null; sourceRef?: string | null; title?: string | null;
}): Promise<{ assetId: string | null; storagePath: string | null }> {
  try {
    const db = admin();
    // idempotent: if this media id was already stored, reuse it
    if (opts.sourceRef) {
      const { data: prev } = await db.from("assets").select("id,storage_path").eq("source_ref", opts.sourceRef).limit(1);
      if (prev?.[0]) return { assetId: prev[0].id, storagePath: prev[0].storage_path };
    }
    const buf = Buffer.from(opts.base64, "base64");
    const path = `whatsapp/inbound/${opts.sourceRef || Date.now()}.${extFor(opts.mime)}`;
    const { error: upErr } = await db.storage.from("assets").upload(path, buf, { contentType: opts.mime, upsert: true });
    if (upErr) { console.error("storeMedia upload failed", upErr.message); return { assetId: null, storagePath: null }; }
    const { data: asset } = await db
      .from("assets")
      .insert({ type: "proof", title: (opts.title || opts.name || "WhatsApp attachment").slice(0, 120), storage_path: path, mime: opts.mime, size_bytes: buf.length, source: "whatsapp", source_ref: opts.sourceRef || null, created_by: "WhatsApp" })
      .select("id").single();
    return { assetId: asset?.id || null, storagePath: path };
  } catch (e: any) {
    console.error("storeMedia error", e?.message);
    return { assetId: null, storagePath: null };
  }
}
