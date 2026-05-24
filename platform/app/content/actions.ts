"use server";
import { admin } from "../../lib/supabase-admin";
import { claude } from "../../lib/anthropic";
import { revalidatePath } from "next/cache";

function base(fd: FormData) {
  return {
    brand_id: String(fd.get("brand_id") || "") || null,
    channels: fd.getAll("channels").map(String),
    title: String(fd.get("title") || "") || null,
    scheduled_for: String(fd.get("scheduled_for") || "") || null,
  };
}

export async function composePost(fd: FormData) {
  const f = base(fd);
  const body = String(fd.get("body") || "").trim();
  if (!body) return;
  await admin().from("content_posts").insert({ ...f, body, status: f.scheduled_for ? "scheduled" : "draft" });
  revalidatePath("/content");
}

export async function aiDraft(fd: FormData) {
  const f = base(fd);
  const brief = String(fd.get("body") || "").trim() || "a general post about our mission";
  let brand = "Nisria";
  if (f.brand_id) {
    const { data } = await admin().from("brands").select("name").eq("id", f.brand_id).single();
    brand = (data as any)?.name || brand;
  }
  const body = await claude(
    `You write short, warm, dignified social captions for ${brand}, a nonprofit helping children/families in Kenya. No poverty-porn, no hype, 1-2 short sentences plus a soft call to action, tasteful emoji allowed. Target channels: ${f.channels.join(", ") || "instagram"}.`,
    `Write a caption for: ${brief}`,
    300
  );
  await admin().from("content_posts").insert({ ...f, body, status: f.scheduled_for ? "scheduled" : "draft", created_by: "AI" });
  revalidatePath("/content");
}

export async function setPostStatus(fd: FormData) {
  const id = String(fd.get("id"));
  const status = String(fd.get("status"));
  const patch: any = { status };
  if (status === "posted") patch.posted_at = new Date().toISOString();
  await admin().from("content_posts").update(patch).eq("id", id);
  revalidatePath("/content");
}
