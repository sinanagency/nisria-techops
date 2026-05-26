"use server";
import { admin } from "../../lib/supabase-admin";
import { emit } from "../../lib/events";
import { revalidatePath } from "next/cache";
import { enqueueJob, triggerWorker, jobCounts } from "../../lib/jobs";
import { GRANT_DATE_TOKEN } from "../../lib/agents/grant";
import { now } from "../../lib/now";

export async function addGrant(fd: FormData) {
  const funder = String(fd.get("funder") || "").trim();
  if (!funder) return;
  const program = String(fd.get("program") || "").trim() || null;
  const amount_requested = fd.get("amount_requested") ? Number(fd.get("amount_requested")) : null;
  const deadline = String(fd.get("deadline") || "").trim() || null;

  const { data: grant } = await admin()
    .from("grant_applications")
    .insert({ funder, program, amount_requested, deadline, status: "researching", currency: "USD" })
    .select()
    .single();

  await emit({
    type: "grant.added",
    source: "grants",
    actor: "Nur",
    subject_type: "grant",
    subject_id: grant?.id,
    payload: { funder, program, amount_requested, deadline },
  });
  revalidatePath("/grants");
}

// Pursue a discovered opportunity (from the grant hunter) → create a pipeline
// application, then queue the (slow) AI prepare as a BACKGROUND job and return
// instantly. The click is one cheap insert + one enqueue: never the 15-80s
// Claude call, so navigation is never trapped behind it.
export async function pursueOpportunity(id: string): Promise<{ ok: boolean }> {
  if (!id) return { ok: false };
  const db = admin();
  const { data: o } = await db.from("grant_opportunities").select("*").eq("id", id).single();
  if (!o) return { ok: false };
  const { data: grant } = await db.from("grant_applications").insert({
    funder: o.funder || o.title, program: o.title,
    amount_requested: o.amount_floor || o.amount_ceiling || null,
    deadline: o.close_date || null, status: "researching",
    currency: o.currency || "USD", link: o.url || null,
    notes: o.description ? `Discovered via ${o.source} (relevance ${Math.round((o.relevance_score || 0) * 100)}%).\n${o.description}` : null,
  }).select().single();
  await db.from("grant_opportunities").update({ pursued: true }).eq("id", id);
  await emit({ type: "grant.added", source: "grant-hunter", actor: "Nur", subject_type: "grant", subject_id: grant?.id, payload: { funder: o.funder, source: o.source } });
  // Queue the prepare in the background; fire the worker so it starts now.
  if (grant?.id) { await enqueueJob("grant.prepare", grant.id, { funder: o.funder || o.title }); triggerWorker("/api/grants/prepare"); }
  revalidatePath("/grants");
  return { ok: true };
}

// Prepare a COMPLETE, submission-ready application package for a grant.
// The Grant agent (lib/agents/grant.ts) fetches the funder page (if a link is
// present) to infer priorities, then writes the full package grounded in the
// real org context + the RUNBOOK playbook. The package is saved into
// `notes` and the grant moves to `review` — only review + one-tap submit left.
//
// (Auto-fill / auto-submit to the funder's portal via a browser is the next
// phase; this v1 prepares 100% of the written package, nothing is submitted.)
//
// NON-BLOCKING: this no longer runs Claude inline. It enqueues a background
// prepare job and fires the worker, then returns immediately. The actual
// buildApplication runs on the worker's own request (/api/grants/prepare), so
// the click is instant and the founder can navigate away mid-prepare.
export async function prepareGrant(id: string): Promise<{ ok: boolean; queued: boolean }> {
  if (!id) return { ok: false, queued: false };
  const db = admin();
  const { data: g } = await db.from("grant_applications").select("id,funder,program").eq("id", id).single();
  if (!g) return { ok: false, queued: false };
  await enqueueJob("grant.prepare", g.id, { funder: g.funder, program: g.program });
  triggerWorker("/api/grants/prepare");
  await emit({
    type: "grant.prepare_queued", source: "grants", actor: "Nur",
    subject_type: "grant", subject_id: id, payload: { funder: g.funder, program: g.program },
  });
  revalidatePath("/grants");
  return { ok: true, queued: true };
}

// "Prepare all ready" — queue background prepare jobs for every un-prepared
// application (capped), then fire the worker once. Returns INSTANTLY with how
// many were queued; the worker drains them on its own requests and the daily
// cron is the backstop. Idempotent: enqueueJob skips grants that already have an
// open job, so tapping again never piles up duplicates.
export async function prepareAllReady(): Promise<{ queued: number; alreadyQueued: number; considered: number }> {
  const db = admin();
  const { data } = await db
    .from("grant_applications")
    .select("id,funder,program,notes,status")
    .in("status", ["researching", "drafting"])
    .order("deadline", { ascending: true, nullsFirst: false })
    .limit(50);
  const needs = (data || []).filter((g: any) => !(g.notes && String(g.notes).trim()));

  // Cap how many we queue per tap (matches the worker ceiling). Idempotent via
  // enqueueJob's open-job dedupe, so re-tapping continues the queue safely.
  const CAP = 5;
  let queued = 0, alreadyQueued = 0;
  const counts = await jobCounts("grant.prepare");
  const open = counts.queued + counts.running;
  for (const g of needs.slice(0, CAP)) {
    const before = await jobCounts("grant.prepare");
    const id = await enqueueJob("grant.prepare", g.id, { funder: g.funder, program: g.program });
    const after = await jobCounts("grant.prepare");
    if (id && after.queued + after.running > before.queued + before.running) queued++;
    else alreadyQueued++;
  }
  if (queued > 0 || open > 0) triggerWorker("/api/grants/prepare");
  revalidatePath("/grants");
  return { queued, alreadyQueued, considered: needs.length };
}

// Back-compat alias for any caller still referencing draftGrant.
export const draftGrant = prepareGrant;

// Live status for the quiet "preparing…" chip on the grants page (and the
// global activity chip). Cheap count query, safe to poll. NEVER drives a
// navigation-blocking transition: the client polls this and updates a chip only.
export async function getPrepareStatus(): Promise<{ queued: number; running: number; active: number }> {
  const { queued, running } = await jobCounts("grant.prepare");
  return { queued, running, active: queued + running };
}

// Decline a prepared grant: Nur looked at the prepared package and chose not to
// pursue it. Records the decision (status "lost", a declined-on note) so it
// leaves the review column and lands in Won/Lost, and is never auto-re-prepared.
export async function declineGrant(fd: FormData) {
  const id = String(fd.get("id"));
  if (!id) return;
  const db = admin();
  const { data: g } = await db.from("grant_applications").select("funder,program,notes").eq("id", id).single();
  const declineNote = `\n\n---\n_Declined by Nur on ${new Date().toISOString().slice(0, 10)}, not pursued._`;
  await db.from("grant_applications").update({
    status: "lost",
    decision_on: new Date().toISOString(),
    notes: g?.notes ? `${g.notes}${declineNote}` : declineNote.trim(),
  }).eq("id", id);
  await emit({
    type: "grant.declined", source: "grants", actor: "Nur",
    subject_type: "grant", subject_id: id,
    payload: { funder: g?.funder, program: g?.program },
  });
  revalidatePath("/grants");
}

// Move a grant along the pipeline: researching → drafting → submitted → won|lost.
export async function advanceStatus(fd: FormData) {
  const id = String(fd.get("id"));
  const status = String(fd.get("status"));
  if (!id || !status) return;
  const patch: any = { status };
  if (status === "submitted") {
    patch.submitted_on = new Date().toISOString();
    // Freeze the package date on submit: the live-date token stops rolling and
    // is stamped with the actual submission date (P4: rolls until submitted).
    try {
      const { data: g } = await admin().from("grant_applications").select("notes").eq("id", id).single();
      if (g?.notes && String(g.notes).indexOf(GRANT_DATE_TOKEN) !== -1) {
        const n = await now();
        patch.notes = String(g.notes).split(GRANT_DATE_TOKEN).join(n.long);
      }
    } catch {
      // best-effort: a stale token never blocks the submit
    }
  }
  if (status === "won" || status === "lost") patch.decision_on = new Date().toISOString();
  await admin().from("grant_applications").update(patch).eq("id", id);

  await emit({
    type: "grant.status_changed",
    source: "grants",
    actor: "Nur",
    subject_type: "grant",
    subject_id: id,
    payload: { status },
  });
  revalidatePath("/grants");
}
