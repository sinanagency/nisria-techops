"use server";
import { admin } from "../../lib/supabase-admin";
import { claude } from "../../lib/anthropic";
import { revalidatePath } from "next/cache";

export async function aiReply(fd: FormData) {
  const id = String(fd.get("id"));
  const contact_id = String(fd.get("contact_id") || "") || null;
  const channel = String(fd.get("channel") || "whatsapp");
  const { data: msg } = await admin().from("messages").select("body").eq("id", id).single();
  const reply = await claude(
    `You are Nisria's friendly support assistant replying on ${channel}. Nisria is a nonprofit helping children/families in Kenya; people can donate (monthly or one-time), sponsor a child, volunteer, or shop The Folklore. Be warm, brief (2-4 sentences), genuinely helpful, and guide them to a clear next step. Don't invent specific figures.`,
    `Their message: "${(msg as any)?.body || ""}". Write the reply.`,
    280
  );
  await admin().from("messages").insert({ contact_id, channel, direction: "out", body: reply, handled_by: "ai", status: "replied" });
  await admin().from("messages").update({ status: "replied", handled_by: "ai" }).eq("id", id);
  revalidatePath("/inbox");
}

export async function closeThread(fd: FormData) {
  const contact_id = String(fd.get("contact_id"));
  await admin().from("messages").update({ status: "closed" }).eq("contact_id", contact_id);
  revalidatePath("/inbox");
}
