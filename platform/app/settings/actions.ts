"use server";
import { admin } from "../../lib/supabase-admin";
import { emit } from "../../lib/events";
import { rememberUpsert } from "../../lib/memory";
import { BRAIN_SECTIONS, type SectionKey } from "../../lib/brain";
import { enqueueJobByPayload, triggerWorker, studioGenerateOpen } from "../../lib/jobs";
import { GRANT_DOC_SPECS, grantDocSpec, type GrantDocKind } from "../../lib/grant-docs";
import { MONTHLY_GOAL_DEFAULT } from "../../lib/org-settings";
import { revalidatePath } from "next/cache";

// Save the configurable monthly fundraising goal (the dashboard gauge target).
// Stored as one org_profile row (section = "monthly_goal"), so it is editable
// here like any other Brain field. Coerces to a positive integer; blanks/garbage
// fall back to the default so the gauge never divides by zero.
export async function saveMonthlyGoal(fd: FormData) {
  const raw = Math.round(Number(String(fd.get("goal") || "").replace(/[^0-9.]/g, "")));
  const goal = Number.isFinite(raw) && raw > 0 ? raw : MONTHLY_GOAL_DEFAULT;
  await admin()
    .from("org_profile")
    .upsert(
      { section: "monthly_goal", content: String(goal), data: {}, updated_by: "Nur", updated_at: new Date().toISOString() },
      { onConflict: "section" }
    );
  await emit({ type: "org.goal_updated", source: "settings", actor: "Nur", subject_type: "org_profile", payload: { goal } });
  revalidatePath("/settings");
  revalidatePath("/");
}

// R2-5 (#44): save the editable branded signature for ONE account. The signature
// is auto-appended to every outbound email from that account (sasa@ -> Nisria,
// maisha@ -> Maisha). Stored on email_accounts.signature_html.
export async function saveSignature(fd: FormData) {
  const address = String(fd.get("address") || "").trim().toLowerCase();
  const signature_html = String(fd.get("signature_html") || "");
  if (!address) return;
  await admin().from("email_accounts").update({ signature_html }).eq("address", address);
  await emit({ type: "account.signature_updated", source: "settings", actor: "Nur", payload: { address } });
  revalidatePath("/settings");
}

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

// Save ONE onboarding section of the Brain. Each section saves independently and
// is fully re-editable later (this overwrites in place, never piles up). Writes
// to org_profile (the editable source of truth) AND mirrors into agent_memory so
// the EXISTING recall() surfaces it to every agent. Empty content clears the
// section (and removes its grounding) so the completeness meter stays truthful.
export async function saveBrainSection(fd: FormData) {
  const section = String(fd.get("section") || "") as SectionKey;
  const spec = BRAIN_SECTIONS.find((s) => s.key === section);
  if (!spec) return;
  const content = String(fd.get("content") || "").trim();
  const db = admin();

  if (!content) {
    // cleared: drop the profile body + its memory grounding
    const { data: prof } = await db
      .from("org_profile")
      .select("memory_id")
      .eq("section", section)
      .maybeSingle();
    if (prof?.memory_id) await db.from("agent_memory").delete().eq("id", prof.memory_id);
    await db
      .from("org_profile")
      .upsert({ section, content: "", data: {}, memory_id: null, updated_by: "Nur", updated_at: new Date().toISOString() }, { onConflict: "section" });
    revalidatePath("/settings");
    return;
  }

  // mirror into the brain so agents can recall it (upsert by slug => no dup facts)
  const memId = await rememberUpsert({
    kind: spec.memKind,
    brand: section === "voice" ? "nisria" : null,
    title: spec.memTitle,
    content,
    source_type: "org_profile",
    slug: `org_profile:${section}`,
    metadata: { section },
  });

  await db
    .from("org_profile")
    .upsert(
      { section, content, data: {}, memory_id: memId, updated_by: "Nur", updated_at: new Date().toISOString() },
      { onConflict: "section" }
    );

  await emit({
    type: "brain.updated",
    source: "settings",
    actor: "Nur",
    subject_type: "org_profile",
    payload: { section, kind: spec.memKind },
  });
  revalidatePath("/settings");
}

// ---------------------------------------------------------------------------
// GRANT-READY DOCUMENTS (R2-4 / #37) — non-blocking generation.
//
// The "Generate" / "Regenerate" button calls this. It does ONE fast enqueue
// (deduped per doc kind) plus a detached worker trigger and returns instantly.
// The slow Claude composition runs on /api/studio/generate's own request, so the
// click never blocks navigation (the founder's hard rule). A quiet "preparing"
// chip polls getGrantDocStatus while the worker runs.
// ---------------------------------------------------------------------------
export async function queueGrantDoc(kind: GrantDocKind): Promise<{ ok: boolean; queued: boolean }> {
  if (!grantDocSpec(kind)) return { ok: false, queued: false };
  const { id, deduped } = await enqueueJobByPayload("studio.generate", "docKind", kind, {});
  if (!id) return { ok: false, queued: false };
  triggerWorker("/api/studio/generate");
  await emit({
    type: "studio.grant_doc_queued", source: "settings", actor: "Nur",
    subject_type: "studio_document", payload: { docKind: kind, deduped },
  });
  revalidatePath("/settings");
  return { ok: true, queued: !deduped };
}

// Queue the WHOLE grant-ready set in one tap. Each is deduped + capped by the
// worker, so this is safe to call repeatedly.
export async function queueAllGrantDocs(): Promise<{ queued: number }> {
  let queued = 0;
  for (const spec of GRANT_DOC_SPECS) {
    const { id, deduped } = await enqueueJobByPayload("studio.generate", "docKind", spec.kind, {});
    if (id && !deduped) queued++;
  }
  triggerWorker("/api/studio/generate");
  revalidatePath("/settings");
  return { queued };
}

// Live "preparing" status for the panel chips. Cheap; safe to poll. Returns the
// count of open generate jobs per doc kind (0 = idle).
export async function getGrantDocStatus(): Promise<Record<string, number>> {
  return studioGenerateOpen();
}
