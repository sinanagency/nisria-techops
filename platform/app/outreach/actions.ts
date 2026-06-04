"use server";
import { sendEmail } from "../../lib/email";
import { humanize } from "../../lib/humanize";
import { now } from "../../lib/now";
import { getCurrentUser } from "../../lib/auth";
import { revalidatePath } from "next/cache";
import {
  type Audience,
  type RecipientCounts,
  firstName,
  mergeName,
  getRecipientCounts as gatherCounts,
  runBlast,
} from "../../lib/outreach";

export type { Audience, RecipientCounts };
type SendResult = { ok: boolean; sent: number; failed: number; message: string };

/** Live recipient counts for the audience picker (deduped within each segment). */
export async function getRecipientCounts(): Promise<RecipientCounts> {
  return gatherCounts();
}

/** Send a single test copy to the logged-in user's own inbox. */
export async function sendTest(_prev: SendResult | null, fd: FormData): Promise<SendResult> {
  const ctx = getCurrentUser();
  if (!ctx) return { ok: false, sent: 0, failed: 0, message: "Not authenticated" };
  if (!ctx.teamEmail) return { ok: false, sent: 0, failed: 0, message: "No email on your account to test to" };

  const subject = String(fd.get("subject") || "").trim();
  const body = String(fd.get("body") || "").trim();
  if (!subject || !body) return { ok: false, sent: 0, failed: 0, message: "Add a subject and message first" };

  const n = await now();
  const name = firstName(ctx.name);
  const subj = humanize(mergeName(subject, name), { now: { long: n.long, today: n.today }, mergeValues: { first_name: name } });
  const text = humanize(mergeName(body, name), { now: { long: n.long, today: n.today }, mergeValues: { first_name: name } });

  try {
    await sendEmail(ctx.teamEmail, `[TEST] ${subj}`, text, { account: "sasa@nisria.co" });
    return { ok: true, sent: 1, failed: 0, message: `Test sent to ${ctx.teamEmail}` };
  } catch (e: any) {
    return { ok: false, sent: 0, failed: 1, message: e?.message || "Test send failed" };
  }
}

/** Mass send to the chosen audience (donors, contacts, or both). One send path
 * shared with the gated Sasa newsletter tool, so behaviour never diverges. */
export async function sendOutreach(_prev: SendResult | null, fd: FormData): Promise<SendResult> {
  const ctx = getCurrentUser();
  if (!ctx) return { ok: false, sent: 0, failed: 0, message: "Not authenticated" };

  const subject = String(fd.get("subject") || "").trim();
  const body = String(fd.get("body") || "").trim();
  const audience = (String(fd.get("audience") || "all") as Audience);
  if (!subject || !body) return { ok: false, sent: 0, failed: 0, message: "Subject and message are required" };

  const res = await runBlast({ subject, body, audience, actor: ctx.name || "Nur" });
  revalidatePath("/outreach");
  return res;
}
