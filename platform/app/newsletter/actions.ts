"use server";
import { admin } from "../../lib/supabase-admin";
import { claude } from "../../lib/anthropic";
import { sendEmail } from "../../lib/email";
import { emit } from "../../lib/events";
import { revalidatePath } from "next/cache";

// Cap per send (fine for now — donor list is small).
const SEND_CAP = 50;

const firstName = (full?: string | null) => (full || "").trim().split(/\s+/)[0] || "there";
const mergeName = (text: string, name: string) => (text || "").replace(/\{\{\s*first_name\s*\}\}/gi, name);

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
    `You write Nisria's weekly donor newsletter. Warm, dignified, specific, transparent. Open with a greeting line that uses the literal token {{first_name}} (e.g. "Hi {{first_name}},"). Structure: greeting, a short opening, 1 impact story, where the money's going, 1 clear ask (link to donate), and a thank-you. Plain text, ~180-250 words. No poverty-porn, no hype. Keep the {{first_name}} token exactly as written — it gets merged per donor.`,
    `Draft this week's newsletter from this material (use real items if present, otherwise write tasteful placeholders marked ⚑):\n${context}`,
    900
  );
  await db.from("content_posts").insert({
    channels: ["newsletter"],
    title: "Weekly newsletter (draft)",
    body,
    status: "draft",
    created_by: "AI",
  });
  revalidatePath("/newsletter");
}

// The headline feature: a real blast that still personalizes each greeting.
// Loops donors with an email, merges {{first_name}} from full_name, sends
// sequentially via sasa@nisria.co, counts sends, emits newsletter.sent.
export async function sendNewsletter(fd: FormData) {
  const db = admin();
  const subject = String(fd.get("subject") || "").trim();
  const body = String(fd.get("body") || "").trim();
  if (!subject || !body) return { ok: false as const, sent: 0, error: "Subject and body are required." };

  const { data: donors } = await db
    .from("donors")
    .select("id,full_name,email")
    .not("email", "is", null)
    .order("created_at", { ascending: false })
    .limit(SEND_CAP);
  const recipients = (donors || []).filter((d: any) => (d.email || "").includes("@"));

  if (recipients.length === 0) return { ok: false as const, sent: 0, error: "No donors with an email." };

  let sent = 0;
  const failures: string[] = [];
  for (const d of recipients as any[]) {
    const name = firstName(d.full_name);
    try {
      await sendEmail(d.email, mergeName(subject, name), mergeName(body, name));
      sent++;
    } catch (e: any) {
      failures.push(d.email);
    }
  }

  // Keep a record of the send in the content/newsletter stream.
  await db.from("content_posts").insert({
    channels: ["newsletter"],
    title: subject,
    body,
    status: "posted",
    posted_at: new Date().toISOString(),
    created_by: "Nur",
  });

  await emit({
    type: "newsletter.sent",
    source: "newsletter",
    actor: "Nur",
    payload: { subject, recipients: recipients.length, sent, failed: failures.length },
  });

  revalidatePath("/newsletter");
  return { ok: true as const, sent, failed: failures.length };
}
