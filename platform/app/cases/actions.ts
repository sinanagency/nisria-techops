"use server";
// Case lifecycle writes. A "case" is a potential beneficiary still in intake,
// stored on the beneficiaries table with intake_stage set and status='inactive'.
// These actions move a case along the pipeline. The gated AI intake that CREATES
// a case lives in ../beneficiaries/actions.ts (confirmCase) so all PII writes stay
// under the governed beneficiaries module. Service-role only, never a client path.
import { admin } from "../../lib/supabase-admin";
import { emit } from "../../lib/events";
import { remember } from "../../lib/memory";
import { revalidatePath } from "next/cache";

const CASE_STAGES = ["prospect", "under_review", "pending_funds", "declined"];

// Move a case between non-terminal intake stages (e.g. under_review -> pending_funds).
// Does not graduate or reject. Use approveCase / declineCase for those.
export async function setCaseStage(fd: FormData) {
  const id = String(fd.get("id") || "");
  const stage = String(fd.get("stage") || "").toLowerCase();
  if (!id || !CASE_STAGES.includes(stage)) return;

  const db = admin();
  // Only act on rows that are actually cases, so this can never mutate an accepted
  // beneficiary by id.
  const { data: row } = await db
    .from("beneficiaries")
    .select("id,ref_code,intake_stage")
    .eq("id", id)
    .not("intake_stage", "is", null)
    .single();
  if (!row) return;

  await db.from("beneficiaries").update({ intake_stage: stage }).eq("id", id);

  await emit({
    type: "beneficiary.case_stage_changed",
    source: "cases",
    actor: "Nur",
    subject_type: "beneficiary",
    subject_id: id,
    payload: { ref: row.ref_code, from: row.intake_stage, to: stage },
  });

  revalidatePath("/cases");
  revalidatePath(`/beneficiaries/${id}`);
}

// APPROVE a case -> graduate it into a real, active beneficiary. Clears the intake
// stage and flips status to 'active' so it now counts as a beneficiary everywhere.
// Mirrors the grounding write that confirmBeneficiary does, since the person is now
// accepted: their private case context enters the service-role brain (never the
// public view, consent_public stays false until Nur publishes).
export async function approveCase(fd: FormData) {
  const id = String(fd.get("id") || "");
  if (!id) return;

  const db = admin();
  const { data: row } = await db
    .from("beneficiaries")
    .select("id,ref_code,program,gender,region,needs,intake_stage")
    .eq("id", id)
    .not("intake_stage", "is", null)
    .single();
  if (!row) return;

  await db
    .from("beneficiaries")
    .update({ intake_stage: null, status: "active" })
    .eq("id", id);

  await remember({
    kind: "org_fact",
    title: `Beneficiary intake: ${row.ref_code}`,
    content: `A child entered the ${row.program || "other"} program${row.gender ? `, ${row.gender}` : ""}${row.region ? `, from ${row.region}` : ""}.${row.needs ? ` Needs: ${row.needs}.` : ""}`,
    source_type: "beneficiary",
    source_id: id,
  });

  await emit({
    type: "beneficiary.case_approved",
    source: "cases",
    actor: "Nur",
    subject_type: "beneficiary",
    subject_id: id,
    payload: { ref: row.ref_code, program: row.program || null, from: row.intake_stage },
  });

  revalidatePath("/cases");
  revalidatePath("/beneficiaries");
  revalidatePath(`/beneficiaries/${id}`);
}

// DECLINE a case -> terminal intake_stage='declined'. The record is kept (audit
// trail of who we could not take on, and why) but never surfaces as a beneficiary.
export async function declineCase(fd: FormData) {
  const id = String(fd.get("id") || "");
  if (!id) return;
  const reason = String(fd.get("reason") || "").trim() || null;

  const db = admin();
  const { data: row } = await db
    .from("beneficiaries")
    .select("id,ref_code,intake_stage,triage_notes")
    .eq("id", id)
    .not("intake_stage", "is", null)
    .single();
  if (!row) return;

  const triage_notes = reason
    ? [row.triage_notes, `Declined: ${reason}`].filter(Boolean).join("\n\n")
    : row.triage_notes;

  await db
    .from("beneficiaries")
    .update({ intake_stage: "declined", triage_notes })
    .eq("id", id);

  await emit({
    type: "beneficiary.case_declined",
    source: "cases",
    actor: "Nur",
    subject_type: "beneficiary",
    subject_id: id,
    payload: { ref: row.ref_code, reason },
  });

  revalidatePath("/cases");
  revalidatePath(`/beneficiaries/${id}`);
}

// REOPEN a declined case back to under_review (mistakes happen, funds free up).
export async function reopenCase(fd: FormData) {
  const id = String(fd.get("id") || "");
  if (!id) return;

  const db = admin();
  const { data: row } = await db
    .from("beneficiaries")
    .select("id,ref_code,intake_stage")
    .eq("id", id)
    .eq("intake_stage", "declined")
    .single();
  if (!row) return;

  await db.from("beneficiaries").update({ intake_stage: "under_review" }).eq("id", id);

  await emit({
    type: "beneficiary.case_stage_changed",
    source: "cases",
    actor: "Nur",
    subject_type: "beneficiary",
    subject_id: id,
    payload: { ref: row.ref_code, from: "declined", to: "under_review" },
  });

  revalidatePath("/cases");
  revalidatePath(`/beneficiaries/${id}`);
}
