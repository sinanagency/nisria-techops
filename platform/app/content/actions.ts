"use server";
import { admin } from "../../lib/supabase-admin";
import { claude } from "../../lib/anthropic";
import { emit } from "../../lib/events";
import { revalidatePath } from "next/cache";

// Social-first: only Instagram + Facebook for now.
const ALLOWED_CHANNELS = ["instagram", "facebook"];

function base(fd: FormData) {
  const channels = fd.getAll("channels").map(String).filter((c) => ALLOWED_CHANNELS.includes(c));
  return {
    brand_id: String(fd.get("brand_id") || "") || null,
    channels: channels.length ? channels : ["instagram"],
    title: String(fd.get("title") || "") || null,
    scheduled_for: String(fd.get("scheduled_for") || "") || null,
  };
}

// Resolve a brand slug for the assets table (assets.brand is text: nisria|maisha|ahadi).
async function brandSlug(db: any, brand_id: string | null): Promise<string | null> {
  if (!brand_id) return null;
  const { data } = await db.from("brands").select("slug,name").eq("id", brand_id).single();
  return (data as any)?.slug || null;
}

// File a created/AI-drafted post into the Asset Library so all content lands there.
async function fileToLibrary(db: any, opts: { body: string; brandSlugVal: string | null; createdBy: string }) {
  const title = opts.body.slice(0, 60) || "Untitled post";
  await db.from("assets").insert({
    type: "post",
    title,
    description: opts.body,
    brand: opts.brandSlugVal,
    source: "content",
    created_by: opts.createdBy,
  });
}

export async function composePost(fd: FormData) {
  const db = admin();
  const f = base(fd);
  const body = String(fd.get("body") || "").trim();
  if (!body) return;

  // selected library asset (storage_path stored in image_url; the only media column that exists)
  const asset_path = String(fd.get("asset_path") || "") || null;

  await db.from("content_posts").insert({
    ...f,
    body,
    image_url: asset_path,
    status: f.scheduled_for ? "scheduled" : "draft",
  });

  const slug = await brandSlug(db, f.brand_id);
  await fileToLibrary(db, { body, brandSlugVal: slug, createdBy: "Nur" });
  await emit({ type: "content.created", source: "content", actor: "Nur", payload: { channels: f.channels, brand: slug, has_media: !!asset_path } });

  revalidatePath("/content");
  revalidatePath("/library");
}

export async function aiDraft(fd: FormData) {
  const db = admin();
  const f = base(fd);
  const brief = String(fd.get("body") || "").trim() || "a general post about our mission";
  const asset_path = String(fd.get("asset_path") || "") || null;

  let brand = "Nisria";
  if (f.brand_id) {
    const { data } = await db.from("brands").select("name").eq("id", f.brand_id).single();
    brand = (data as any)?.name || brand;
  }
  const body = await claude(
    `You write short, warm, dignified social captions for ${brand}, a nonprofit helping children/families in Kenya. No poverty-porn, no hype, 1-2 short sentences plus a soft call to action, tasteful emoji allowed. Target channels: ${f.channels.join(", ") || "instagram"}.`,
    `Write a caption for: ${brief}`,
    300
  );

  await db.from("content_posts").insert({
    ...f,
    body,
    image_url: asset_path,
    status: f.scheduled_for ? "scheduled" : "draft",
    created_by: "AI",
  });

  const slug = await brandSlug(db, f.brand_id);
  await fileToLibrary(db, { body, brandSlugVal: slug, createdBy: "AI" });
  await emit({ type: "content.created", source: "content", actor: "AI", payload: { channels: f.channels, brand: slug, ai: true, has_media: !!asset_path } });

  revalidatePath("/content");
  revalidatePath("/library");
}

export async function setPostStatus(fd: FormData) {
  const id = String(fd.get("id"));
  const status = String(fd.get("status"));
  const patch: any = { status };
  if (status === "posted") patch.posted_at = new Date().toISOString();
  await admin().from("content_posts").update(patch).eq("id", id);
  revalidatePath("/content");
}

// "Generate graphic" — Canva placeholder. Checks for an API key; if absent it
// persists a friendly note instead of erroring, so the button always succeeds.
// TODO(canva): wire to Canva Connect API here. Use process.env.CANVA_API_KEY,
// call the Canva autofill/design endpoint with brand + body, then store the
// rendered image path in content_posts.image_url and/or an assets row.
export async function generateGraphic(fd: FormData) {
  const db = admin();
  const f = base(fd);
  const brief = String(fd.get("body") || "").trim();

  let slug: string | null = null;
  if (f.brand_id) slug = await brandSlug(db, f.brand_id);

  if (!process.env.CANVA_API_KEY) {
    // No key: log a friendly "Canva connect pending" note. Never error.
    await emit({
      type: "content.created",
      source: "content",
      actor: "Nur",
      payload: { kind: "graphic", status: "canva_connect_pending", brand: slug, brief: brief || null },
    });
    revalidatePath("/content");
    return;
  }

  // --- Canva integration point (not yet wired) ---------------------------
  // const designImageUrl = await canvaRenderGraphic({ key: process.env.CANVA_API_KEY, brand: slug, brief });
  // ... upload to storage + attach to a content_posts/assets row, then:
  // await emit({ type: "content.created", source: "content", actor: "Nur", payload: { kind: "graphic", brand: slug } });
  revalidatePath("/content");
}
