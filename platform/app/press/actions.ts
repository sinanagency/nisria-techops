"use server";
import { revalidatePath } from "next/cache";
import { admin } from "../../lib/supabase-admin";
import { remember } from "../../lib/memory";
import { emit } from "../../lib/events";

const MEDIA_TYPES = ["interview", "article", "podcast", "video", "social", "feature", "award", "mention"];
const BRANDS = ["nisria", "maisha", "ahadi", "personal", "other"];

export async function addPressItem(fd: FormData) {
  const title = String(fd.get("title") || "").trim();
  if (!title) return;
  const url = String(fd.get("url") || "").trim() || null;
  const outlet = String(fd.get("outlet") || "").trim() || null;
  const media_type = MEDIA_TYPES.includes(String(fd.get("media_type"))) ? String(fd.get("media_type")) : "feature";
  const brand = BRANDS.includes(String(fd.get("brand"))) ? String(fd.get("brand")) : null;
  const subject = String(fd.get("subject") || "").trim() || null;
  const published_on = /^\d{4}-\d{2}-\d{2}$/.test(String(fd.get("published_on"))) ? String(fd.get("published_on")) : null;
  const description = String(fd.get("description") || "").trim() || null;
  const tags = String(fd.get("tags") || "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);

  const { data: item, error } = await admin().from("press_items").insert({
    title, url, outlet, media_type, brand, subject, published_on, description, tags,
    source_type: "dashboard", created_by: "Nur",
  }).select("id").single();
  if (error || !item) return; // table may not exist pre-migration; fail soft

  await remember({
    kind: "press", brand: brand === "personal" || brand === "other" ? null : brand, title,
    content: `Press/media: "${title}"${outlet ? ` in ${outlet}` : ""}${url ? ` — ${url}` : ""} (${media_type}${subject ? `, featuring ${subject}` : ""}).`,
    source_type: "press", source_id: item.id,
  });
  await emit({ type: "press.added", source: "dashboard", actor: "Nur", subject_type: "press", subject_id: item.id, payload: { title, outlet, media_type, brand } });
  revalidatePath("/press");
}

export async function deletePressItem(fd: FormData) {
  const id = String(fd.get("id") || "");
  if (!id) return;
  await admin().from("press_items").delete().eq("id", id);
  revalidatePath("/press");
}
