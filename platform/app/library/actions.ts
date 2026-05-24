"use server";
import { admin } from "../../lib/supabase-admin";
import { captionImage } from "../../lib/anthropic";
import { remember } from "../../lib/memory";
import { emit } from "../../lib/events";
import { revalidatePath } from "next/cache";

function classify(mime: string): string {
  if (mime.startsWith("image/")) return "image";
  if (mime.includes("pdf")) return "pdf";
  if (mime.startsWith("video/")) return "video";
  if (mime.includes("word") || mime.includes("document") || mime.includes("text")) return "document";
  return "other";
}

// Drop files into the library: store in Supabase Storage, ingest (caption + learn).
export async function uploadAsset(fd: FormData) {
  const brand = String(fd.get("brand") || "") || null;
  const files = fd.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  const db = admin();

  for (const file of files) {
    const buf = Buffer.from(await file.arrayBuffer());
    const safe = file.name.replace(/[^a-z0-9._-]/gi, "_");
    const path = `${brand || "nisria"}/${Date.now()}-${safe}`;
    const type = classify(file.type);

    const { error: upErr } = await db.storage.from("assets").upload(path, buf, { contentType: file.type, upsert: false });
    if (upErr) { await emit({ type: "asset.failed", source: "library", actor: "Nur", payload: { name: file.name, error: upErr.message } }); continue; }

    // ingest: caption images (best-effort), flag beneficiary consent
    let description = "";
    let consent_required = false;
    if (type === "image" && buf.length < 4_500_000) {
      try { description = await captionImage(buf.toString("base64"), file.type || "image/jpeg"); } catch {}
      if (/^BENEFICIARY:/i.test(description)) consent_required = true;
    }

    const { data: asset } = await db.from("assets").insert({
      brand, type, title: file.name, description, storage_path: path, mime: file.type,
      size_bytes: file.size, source: "upload", consent_required, created_by: "Nur",
    }).select().single();

    // learn it: assets become retrievable memory the agents can pull when composing
    await remember({ kind: "asset", brand, title: file.name, content: `${type} asset "${file.name}". ${description}`, source_type: "asset", source_id: asset?.id });
    await emit({ type: "asset.ingested", source: "library", actor: "Nur", subject_type: "asset", subject_id: asset?.id, payload: { title: file.name, type, brand } });
  }
  revalidatePath("/library");
}
