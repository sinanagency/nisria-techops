"use server";
import { admin } from "../../lib/supabase-admin";
import { claude } from "../../lib/anthropic";
import { withHumanSystem, humanize } from "../../lib/humanize";
import { now } from "../../lib/now";
import { sendEmail } from "../../lib/email";
import { emit } from "../../lib/events";
import { revalidatePath } from "next/cache";

// Send a message from the Workspace portal. Email actually sends (from sasa@);
// WhatsApp and other channels are QUEUED until that channel is connected — nothing
// fires externally before the token is in. Either way the outbound message is
// stored so the thread shows it.
export async function sendChat(fd: FormData) {
  const contact_id = String(fd.get("contact_id") || "") || null;
  const channel = String(fd.get("channel") || "whatsapp");
  const body = String(fd.get("body") || "").trim();
  const to = String(fd.get("to") || "");
  if (!body) return;
  let status = "queued";
  if (channel === "email" && to) {
    try { await sendEmail(to, String(fd.get("subject") || "Re: your message to Nisria"), body, { account: "sasa@nisria.co" }); status = "replied"; }
    catch { status = "failed"; }
  }
  await admin().from("messages").insert({ contact_id, channel, direction: "out", body, handled_by: "nur", status });
  if (contact_id) await admin().from("messages").update({ status: "replied" }).eq("contact_id", contact_id).eq("direction", "in").eq("status", "new");
  await emit({ type: "action.executed", source: "workspace", actor: "nur", subject_type: "contact", subject_id: contact_id, payload: { action: "send_chat", channel } });
  revalidatePath("/workspace");
}

// Assign a task from the portal. source is constrained to manual|ai, so the
// conversation origin lives in the description; the link is still explicit.
export async function assignTask(fd: FormData) {
  const title = String(fd.get("title") || "").trim();
  const assignee_id = String(fd.get("assignee_id") || "") || null;
  const due_on = String(fd.get("due_on") || "") || null;
  const fromName = String(fd.get("from_name") || "").trim();
  if (!title) return;
  const description = fromName ? `From conversation with ${fromName} (Workspace).` : "Assigned from the Workspace.";
  await admin().from("tasks").insert({ title, description, assignee_id, due_on, status: "todo", priority: "medium", source: "manual", created_by: "nur" });
  await emit({ type: "task.assigned", source: "workspace", actor: "nur", payload: { title, assignee_id } });
  // When WhatsApp is live, Sasa dispatches this to the assignee's phone here.
  revalidatePath("/workspace");
}

// Sasa drafts a reply for the latest inbound message in a thread. Returns the text
// to the client (does not send); Nur edits then hits Send.
export async function sasaDraft(contactId: string, channel: string): Promise<string> {
  const db = admin();
  const { data: msgs } = await db.from("messages").select("body,direction").eq("contact_id", contactId).order("created_at", { ascending: false }).limit(8);
  const lastIn = (msgs || []).find((m: any) => m.direction === "in");
  const n = await now();
  const raw = await claude(
    withHumanSystem(`You are Nisria's warm, brief staffer replying on ${channel}. Nisria is a nonprofit helping children and families in Gilgil, Kenya. Be helpful, 2-4 sentences, guide to a clear next step, never invent figures. Today is ${n.long}.`),
    `Their message: "${(lastIn as any)?.body || ""}". Write the reply.`,
    280,
  );
  return humanize(raw, { now: { long: n.long, today: n.today } });
}
