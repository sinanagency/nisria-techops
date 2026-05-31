"use server";
import { admin } from "../../lib/supabase-admin";
import { sendEmail } from "../../lib/email";
import { humanize } from "../../lib/humanize";
import { now } from "../../lib/now";
import { emit } from "../../lib/events";
import { getOrgContext } from "../../lib/auth";
import { revalidatePath } from "next/cache";

// Cap per blast. Gmail SMTP sends sequentially and a serverless function has a
// wall-clock limit, so we send to at most this many per click (mirrors the prior
// newsletter cap). The UI surfaces this honestly when the audience is larger.
export const SEND_CAP = 50;

export type Audience = "all" | "donors" | "contacts";
export type RecipientCounts = { donors: number; contacts: number };
type Recipient = { full_name: string | null; email: string };
type SendResult = { ok: boolean; sent: number; failed: number; message: string };

const firstName = (full?: string | null) => (full || "").trim().split(/\s+/)[0] || "there";
const mergeName = (t: string, name: string) =>
  (t || "").replace(/\{\{\s*first_name\s*\}\}/gi, name);

function dedupe(list: Recipient[]): Recipient[] {
  const seen = new Set<string>();
  return list.filter((r) => {
    const key = (r.email || "").trim().toLowerCase();
    if (!key || !key.includes("@") || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function gatherRecipients(audience: Audience): Promise<Recipient[]> {
  const db = admin();
  const out: Recipient[] = [];

  if (audience === "all" || audience === "donors") {
    const { data } = await db.from("donors").select("full_name,email").not("email", "is", null);
    if (data) out.push(...(data as Recipient[]));
  }
  if (audience === "all" || audience === "contacts") {
    const { data } = await db.from("contacts").select("full_name,email").not("email", "is", null);
    if (data) out.push(...(data as Recipient[]));
  }
  return dedupe(out);
}

/** Live recipient counts for the audience picker (deduped within each segment). */
export async function getRecipientCounts(): Promise<RecipientCounts> {
  const [donors, contacts] = await Promise.all([
    gatherRecipients("donors"),
    gatherRecipients("contacts"),
  ]);
  return { donors: donors.length, contacts: contacts.length };
}

/** Send a single test copy to the logged-in user's own inbox. */
export async function sendTest(_prev: SendResult | null, fd: FormData): Promise<SendResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, sent: 0, failed: 0, message: "Not authenticated" };
  if (!ctx.email) return { ok: false, sent: 0, failed: 0, message: "No email on your account to test to" };

  const subject = String(fd.get("subject") || "").trim();
  const body = String(fd.get("body") || "").trim();
  if (!subject || !body) return { ok: false, sent: 0, failed: 0, message: "Add a subject and message first" };

  const n = await now();
  const name = firstName(ctx.name);
  const subj = humanize(mergeName(subject, name), { now: { long: n.long, today: n.today }, mergeValues: { first_name: name } });
  const text = humanize(mergeName(body, name), { now: { long: n.long, today: n.today }, mergeValues: { first_name: name } });

  try {
    await sendEmail(ctx.email, `[TEST] ${subj}`, text, { account: "sasa@nisria.co" });
    return { ok: true, sent: 1, failed: 0, message: `Test sent to ${ctx.email}` };
  } catch (e: any) {
    return { ok: false, sent: 0, failed: 1, message: e?.message || "Test send failed" };
  }
}

/** Mass send to the chosen audience (donors, contacts, or both). */
export async function sendOutreach(_prev: SendResult | null, fd: FormData): Promise<SendResult> {
  const ctx = await getOrgContext();
  if (!ctx) return { ok: false, sent: 0, failed: 0, message: "Not authenticated" };

  const subject = String(fd.get("subject") || "").trim();
  const body = String(fd.get("body") || "").trim();
  const audience = (String(fd.get("audience") || "all") as Audience);
  if (!subject || !body) return { ok: false, sent: 0, failed: 0, message: "Subject and message are required" };

  const all = await gatherRecipients(audience);
  if (all.length === 0) return { ok: false, sent: 0, failed: 0, message: "No recipients found for this audience" };
  const recipients = all.slice(0, SEND_CAP);

  const n = await now();
  let sent = 0;
  const failures: string[] = [];

  for (const r of recipients) {
    const name = firstName(r.full_name);
    try {
      // Resolve {{first_name}} per recipient, then humanize so what mails has no
      // raw token, no dash, no placeholder survivor (sendEmail also strips dashes).
      const subj = humanize(mergeName(subject, name), { now: { long: n.long, today: n.today }, mergeValues: { first_name: name } });
      const text = humanize(mergeName(body, name), { now: { long: n.long, today: n.today }, mergeValues: { first_name: name } });
      await sendEmail(r.email, subj, text, { account: "sasa@nisria.co" });
      sent++;
    } catch {
      failures.push(r.email);
    }
  }

  // Record the blast for the activity trail (field-nervous-system / one-brain).
  await admin().from("content_posts").insert({
    channels: ["outreach"],
    title: subject,
    body,
    status: "posted",
    posted_at: new Date().toISOString(),
    created_by: ctx.name || "Nur",
  });

  await emit({
    type: "outreach.sent",
    source: "outreach",
    actor: ctx.name || "Nur",
    payload: { subject, audience, recipients: recipients.length, sent, failed: failures.length },
  });

  revalidatePath("/outreach");

  const message =
    failures.length === 0
      ? `Delivered to ${sent} ${sent === 1 ? "recipient" : "recipients"}`
      : `Sent ${sent}, ${failures.length} failed`;
  return { ok: failures.length === 0, sent, failed: failures.length, message };
}
