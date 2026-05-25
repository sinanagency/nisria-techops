"use server";
import { admin } from "../../lib/supabase-admin";
import { emit } from "../../lib/events";
import { revalidatePath } from "next/cache";

export async function addAccount(fd: FormData) {
  const address = String(fd.get("address") || "").trim().toLowerCase();
  const label = String(fd.get("label") || "") || null;
  const brand = String(fd.get("brand") || "nisria");
  const channel = String(fd.get("channel") || "email");
  if (!address) return;
  await admin().from("email_accounts").upsert({ address, label, brand, channel, active: true }, { onConflict: "address" });
  await emit({ type: "account.added", source: "settings", actor: "Nur", payload: { address, channel } });
  revalidatePath("/settings");
  revalidatePath("/inbox");
}
