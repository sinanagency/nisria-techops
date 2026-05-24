"use server";
import { admin } from "../../lib/supabase-admin";
import { revalidatePath } from "next/cache";

export async function addMember(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  if (!name) return;
  await admin().from("team_members").insert({
    name,
    role: String(formData.get("role") || "") || null,
    email: String(formData.get("email") || "") || null,
  });
  revalidatePath("/team");
}

export async function toggleMember(formData: FormData) {
  const id = String(formData.get("id"));
  const status = String(formData.get("status"));
  await admin().from("team_members").update({ status }).eq("id", id);
  revalidatePath("/team");
}
