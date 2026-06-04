// Outreach engine (newsletter / email blast). The single place that gathers an
// audience, personalizes, and sends. Both the /outreach portal action AND the
// gated Sasa tool (via the gateway "outreach.blast" connector) call runBlast, so
// there is one send path, not two (extend-beside / one-brain).
//
// SENDING: Gmail SMTP (lib/email.sendEmail), sequential, capped per blast because
// a serverless function has a wall-clock limit and Gmail throttles. This is the
// pragmatic channel for hundreds of recipients. A real high-volume newsletter
// program should move to an ESP (Resend) with one-click unsubscribe + a
// suppression list; until then the footer carries a reply-to opt-out (CAN-SPAM
// minimum) and we throttle between sends.
import { admin } from "./supabase-admin";
import { sendEmail } from "./email";
import { humanize } from "./humanize";
import { now } from "./now";
import { emit } from "./events";

export type Audience = "all" | "donors" | "contacts";
export type Recipient = { full_name: string | null; email: string };
export type RecipientCounts = { donors: number; contacts: number };
export type BlastResult = { ok: boolean; sent: number; failed: number; message: string };

// Cap per blast. Gmail SMTP sends sequentially and a serverless function has a
// wall-clock limit, so we send to at most this many per run. The UI/agent
// surfaces this honestly when the audience is larger.
export const SEND_CAP = 50;

// Small gap between sends so a burst does not trip Gmail's rate limiter.
const THROTTLE_MS = 250;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const firstName = (full?: string | null) => (full || "").trim().split(/\s+/)[0] || "there";
export const mergeName = (t: string, name: string) => (t || "").replace(/\{\{\s*first_name\s*\}\}/gi, name);

// Opt-out footer (CAN-SPAM minimum for a US nonprofit emailing its community).
// SMTP MVP: a monitored reply keyword. The ESP upgrade replaces this with a
// one-click unsubscribe header + suppression list.
const UNSUB_FOOTER =
  "\n\n—\nBy Nisria Inc. You are receiving this because you are part of the Nisria community.\nTo stop receiving these emails, reply with the word UNSUBSCRIBE and we will remove you.";

export function dedupe(list: Recipient[]): Recipient[] {
  const seen = new Set<string>();
  return list.filter((r) => {
    const key = (r.email || "").trim().toLowerCase();
    if (!key || !key.includes("@") || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Gather recipients for an audience. Donors carry `full_name`; contacts carry
// `name` (the contacts table has no full_name column — selecting full_name there
// errors, which is why the old single-file action returned nothing for contacts).
export async function gatherRecipients(audience: Audience): Promise<Recipient[]> {
  const db = admin();
  const out: Recipient[] = [];
  if (audience === "all" || audience === "donors") {
    const { data } = await db.from("donors").select("full_name,email").not("email", "is", null);
    if (data) out.push(...(data as any[]).map((d) => ({ full_name: d.full_name ?? null, email: d.email })));
  }
  if (audience === "all" || audience === "contacts") {
    const { data } = await db.from("contacts").select("name,email").not("email", "is", null);
    if (data) out.push(...(data as any[]).map((c) => ({ full_name: c.name ?? null, email: c.email })));
  }
  return dedupe(out);
}

// Live recipient counts for the picker (deduped within each segment).
export async function getRecipientCounts(): Promise<RecipientCounts> {
  const [donors, contacts] = await Promise.all([gatherRecipients("donors"), gatherRecipients("contacts")]);
  return { donors: donors.length, contacts: contacts.length };
}

// The one send path. Sequential, capped, throttled, with a per-recipient
// {{first_name}} merge and the opt-out footer. Best-effort per recipient: one
// bad address never aborts the run. Records the blast + emits the event.
export async function runBlast(args: { subject: string; body: string; audience: Audience; actor?: string | null }): Promise<BlastResult> {
  const subject = String(args.subject || "").trim();
  const body = String(args.body || "").trim();
  const audience: Audience = (["all", "donors", "contacts"].includes(args.audience) ? args.audience : "all") as Audience;
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
      const subj = humanize(mergeName(subject, name), { now: { long: n.long, today: n.today }, mergeValues: { first_name: name } });
      const text = humanize(mergeName(body, name), { now: { long: n.long, today: n.today }, mergeValues: { first_name: name } }) + UNSUB_FOOTER;
      await sendEmail(r.email, subj, text, { account: "sasa@nisria.co" });
      sent++;
    } catch {
      failures.push(r.email);
    }
    if (THROTTLE_MS) await sleep(THROTTLE_MS);
  }

  await admin().from("content_posts").insert({
    channels: ["outreach"],
    title: subject,
    body,
    status: "posted",
    posted_at: new Date().toISOString(),
    created_by: args.actor || "Nur",
  });
  await emit({
    type: "outreach.sent",
    source: "outreach",
    actor: args.actor || "Nur",
    payload: { subject, audience, recipients: recipients.length, sent, failed: failures.length, capped: all.length > SEND_CAP },
  });

  const message =
    failures.length === 0
      ? `Delivered to ${sent} ${sent === 1 ? "recipient" : "recipients"}${all.length > SEND_CAP ? ` (first ${SEND_CAP} of ${all.length})` : ""}`
      : `Sent ${sent}, ${failures.length} failed`;
  return { ok: failures.length === 0, sent, failed: failures.length, message };
}
