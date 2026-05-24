"use server";
import { admin } from "../../lib/supabase-admin";
import { claude } from "../../lib/anthropic";
import { revalidatePath } from "next/cache";

export async function draftNewsletter() {
  const db = admin();
  const [{ data: posts }, { data: bens }, { data: camps }] = await Promise.all([
    db.from("content_posts").select("body").eq("status", "posted").order("created_at", { ascending: false }).limit(5),
    db.from("beneficiaries").select("public_name,public_story,category").eq("consent_public", true).limit(3),
    db.from("campaigns").select("name,goal_amount,raised_amount").eq("status", "live").limit(2),
  ]);
  const context = JSON.stringify({
    recent_posts: (posts || []).map((p: any) => p.body),
    consented_stories: bens || [],
    live_campaigns: camps || [],
  });
  const body = await claude(
    `You write Nisria's weekly donor newsletter. Warm, dignified, specific, transparent. Structure: a short opening, 1 impact story, where the money's going, 1 clear ask (link to donate), and a thank-you. Plain text, ~180-250 words. No poverty-porn, no hype.`,
    `Draft this week's newsletter from this material (use real items if present, otherwise write tasteful placeholders marked ⚑):\n${context}`,
    900
  );
  await db.from("content_posts").insert({ channels: ["newsletter"], title: "Weekly newsletter (draft)", body, status: "draft", created_by: "AI" });
  revalidatePath("/newsletter");
}

export async function queueSend(fd: FormData) {
  await admin().from("content_posts").update({ status: "scheduled" }).eq("id", String(fd.get("id")));
  revalidatePath("/newsletter");
}
