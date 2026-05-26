"use server";
// Beneficiary writes. Service-role only (server actions), never a client path.
// PII stays server-side. The ONLY field that crosses into the public,
// donor-facing surface is via the consent_public flag -> public_beneficiary_profiles
// view, which the toggle below flips. Every write revalidates the affected pages
// and logs an event so it shows up in Mission Control.
import { admin } from "../../lib/supabase-admin";
import { emit } from "../../lib/events";
import { revalidatePath } from "next/cache";

// Publish / unpublish a beneficiary's PUBLIC donor-facing profile.
// consent_public=true exposes ONLY the consent-gated view fields (alias, program,
// sanitized story, public photo). The DB trigger stamps/clears consent_date.
export async function toggleConsent(fd: FormData) {
  const id = String(fd.get("id") || "");
  if (!id) return;
  const to = String(fd.get("to") || "").toLowerCase();
  const next = to === "on" ? true : to === "off" ? false : null;

  const db = admin();
  const { data: b } = await db
    .from("beneficiaries")
    .select("id,consent_public,public_name,ref_code")
    .eq("id", id)
    .single();
  if (!b) return;

  const value = next === null ? !b.consent_public : next;

  await db
    .from("beneficiaries")
    .update({ consent_public: value, consent_date: value ? new Date().toISOString() : null })
    .eq("id", id);

  await emit({
    type: value ? "beneficiary.consent_granted" : "beneficiary.consent_withdrawn",
    source: "beneficiaries",
    actor: "Nur",
    subject_type: "beneficiary",
    subject_id: id,
    payload: { ref: b.ref_code || null, public: value },
  });

  revalidatePath("/beneficiaries");
  revalidatePath(`/beneficiaries/${id}`);
}

// Move a beneficiary through the program lifecycle from the 360 view.
const STATUSES = ["active", "graduated", "transitioned", "paused", "exited", "inactive"];
export async function setStatus(fd: FormData) {
  const id = String(fd.get("id") || "");
  const status = String(fd.get("status") || "").toLowerCase();
  if (!id || !STATUSES.includes(status)) return;

  const db = admin();
  await db.from("beneficiaries").update({ status }).eq("id", id);

  await emit({
    type: "beneficiary.status_changed",
    source: "beneficiaries",
    actor: "Nur",
    subject_type: "beneficiary",
    subject_id: id,
    payload: { status },
  });

  revalidatePath("/beneficiaries");
  revalidatePath(`/beneficiaries/${id}`);
}
