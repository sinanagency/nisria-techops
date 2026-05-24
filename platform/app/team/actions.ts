"use server";
import { admin } from "../../lib/supabase-admin";
import { sendEmail } from "../../lib/email";
import { emit } from "../../lib/events";
import { revalidatePath } from "next/cache";

export async function addMember(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  if (!name) return;
  const role = String(formData.get("role") || "").trim() || null;
  const email = String(formData.get("email") || "").trim() || null;
  const phone = String(formData.get("phone") || "").trim() || null;

  const { data: member } = await admin()
    .from("team_members")
    .insert({ name, role, email, phone, status: "invited", activated: false })
    .select()
    .single();

  if (email) {
    try {
      await sendEmail(
        email,
        "Welcome to the Nisria team",
        `Hi ${name},\n\nYou've been added to the Nisria team${role ? ` as ${role}` : ""}. We'll be in touch shortly with next steps and to activate your access.\n\nWarmly,\nNisria`
      );
    } catch (err) {
      // email is best-effort; never block the add
      console.error("welcome email failed", err);
    }
  }

  await emit({
    type: "team.member_added",
    source: "team",
    actor: "Nur",
    subject_type: "team_member",
    subject_id: member?.id,
    payload: { name, role, email, phone },
  });
  revalidatePath("/team");
}

// Activate a member: flips activated=true (the hook for the WhatsApp bot once
// the number is live) and, for now, also sends an activation email.
export async function activateMember(formData: FormData) {
  const id = String(formData.get("id"));
  if (!id) return;

  const { data: member } = await admin()
    .from("team_members")
    .update({ activated: true, status: "active" })
    .eq("id", id)
    .select()
    .single();

  if (member?.email) {
    try {
      await sendEmail(
        member.email,
        "Your Nisria access is active",
        `Hi ${member.name},\n\nYour Nisria team access is now active. Once our WhatsApp line is live you'll be able to receive tasks and updates there too.\n\nWarmly,\nNisria`
      );
    } catch (err) {
      console.error("activation email failed", err);
    }
  }

  await emit({
    type: "team.activated",
    source: "team",
    actor: "Nur",
    subject_type: "team_member",
    subject_id: id,
    payload: { name: member?.name, phone: member?.phone },
  });
  revalidatePath("/team");
}

export async function toggleMember(formData: FormData) {
  const id = String(formData.get("id"));
  const status = String(formData.get("status"));
  await admin().from("team_members").update({ status }).eq("id", id);
  revalidatePath("/team");
}
