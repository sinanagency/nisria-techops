"use server";
import { admin } from "../../lib/supabase-admin";
import { claude } from "../../lib/anthropic";
import { sendEmail } from "../../lib/email";
import { emit } from "../../lib/events";
import { revalidatePath } from "next/cache";

// Manual reply sent by Nur from the reading pane.
export async function sendReply(fd: FormData) {
  const to = String(fd.get("to") || "");
  const subject = String(fd.get("subject") || "Re: your message to Nisria");
  const body = String(fd.get("body") || "");
  const contact_id = String(fd.get("contact_id") || "") || null;
  let status = "replied";
  if (to && body) {
    try { await sendEmail(to, subject, body); }
    catch (e: any) { status = "failed"; }
  }
  await admin().from("messages").insert({ contact_id, channel: "email", direction: "out", subject, body, handled_by: "nur", status });
  if (contact_id) await admin().from("messages").update({ status: "replied" }).eq("contact_id", contact_id).eq("direction", "in").eq("status", "new");
  await emit({ type: "action.executed", source: "connector:email", actor: "nur", subject_type: "contact", subject_id: contact_id, payload: { action: "send_email", to } });
  revalidatePath("/inbox");
}

export async function aiReply(fd: FormData) {
  const id = String(fd.get("id"));
  const contact_id = String(fd.get("contact_id") || "") || null;
  const channel = String(fd.get("channel") || "whatsapp");
  const db = admin();
  const { data: msg } = await db.from("messages").select("body").eq("id", id).single();
  const reply = await claude(
    `You are Nisria's friendly support assistant replying on ${channel}. Nisria is a nonprofit helping children/families in Kenya; people can donate (monthly or one-time), sponsor a child, volunteer, or shop The Folklore. Be warm, brief (2-4 sentences), genuinely helpful, and guide them to a clear next step. Don't invent specific figures.`,
    `Their message: "${(msg as any)?.body || ""}". Write the reply.`,
    280
  );

  // EMAIL channel → actually send it from sasa@nisria.co
  let note = "";
  if (channel === "email" && contact_id) {
    const { data: c } = await db.from("contacts").select("email").eq("id", contact_id).single();
    const to = (c as any)?.email;
    if (to) {
      try {
        await sendEmail(to, "Re: your message to Nisria", reply);
        note = " (sent)";
      } catch (e: any) {
        note = ` (send failed: ${e?.message || "error"})`;
      }
    }
  }

  await db.from("messages").insert({ contact_id, channel, direction: "out", body: reply + note, handled_by: "ai", status: "replied" });
  await db.from("messages").update({ status: "replied", handled_by: "ai" }).eq("id", id);
  revalidatePath("/inbox");
}

export async function closeThread(fd: FormData) {
  const contact_id = String(fd.get("contact_id"));
  await admin().from("messages").update({ status: "closed" }).eq("contact_id", contact_id);
  revalidatePath("/inbox");
}
