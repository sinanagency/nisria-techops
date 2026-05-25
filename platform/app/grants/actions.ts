"use server";
import { admin } from "../../lib/supabase-admin";
import { claude } from "../../lib/anthropic";
import { emit } from "../../lib/events";
import { revalidatePath } from "next/cache";

const ORG_CONTEXT = `Nisria Inc is a US (Florida) registered nonprofit helping children and families in Kenya. It runs two sister brands: Maisha (handmade goods) and AHADI. Real programs include "One of 500" and rescuing abandoned children. Nisria is TechSoup verified.`;

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

// Pursue a discovered opportunity (from the grant hunter) → create a pipeline application.
export async function pursueOpportunity(fd: FormData) {
  const id = String(fd.get("id"));
  if (!id) return;
  const db = admin();
  const { data: o } = await db.from("grant_opportunities").select("*").eq("id", id).single();
  if (!o) return;
  const { data: grant } = await db.from("grant_applications").insert({
    funder: o.funder || o.title, program: o.title,
    amount_requested: o.amount_floor || o.amount_ceiling || null,
    deadline: o.close_date || null, status: "researching",
    currency: o.currency || "USD", link: o.url || null,
    notes: o.description ? `Discovered via ${o.source} (relevance ${Math.round((o.relevance_score || 0) * 100)}%).\n${o.description}` : null,
  }).select().single();
  await db.from("grant_opportunities").update({ pursued: true }).eq("id", id);
  await emit({ type: "grant.added", source: "grant-hunter", actor: "Nur", subject_type: "grant", subject_id: grant?.id, payload: { funder: o.funder, source: o.source } });
  revalidatePath("/grants");
}

// Draft a grant narrative grounded in Nisria's real org context, following the
// RUNBOOK playbook: research funder fit → narrative (problem, solution,
// measurable impact, simple budget, org credibility) → review → submit.
export async function draftGrant(fd: FormData) {
  const id = String(fd.get("id"));
  if (!id) return;
  const db = admin();
  const { data: g } = await db.from("grant_applications").select("*").eq("id", id).single();
  if (!g) return;

  const narrative = await claude(
    `You are a senior grant writer for nonprofits. ${ORG_CONTEXT}

Follow this grant playbook: (1) assess funder fit, (2) write a narrative covering Problem, Solution, Measurable Impact, a simple Budget, and Org Credibility, (3) keep it review-ready and concise. Write in clear, confident, non-hype prose. Use the funder's likely priorities to frame the ask. Output a structured draft with clear headings (Funder Fit, Problem, Solution, Measurable Impact, Budget, Organizational Credibility). Do not invent specific financials beyond the requested amount; keep the budget illustrative and high-level.`,
    `Draft a grant application narrative for this opportunity.
Funder: ${g.funder}
Program: ${g.program || "—"}
Amount requested: ${g.amount_requested ? `${g.currency || "USD"} ${g.amount_requested}` : "to be determined"}
Deadline: ${g.deadline || "—"}`,
    1800
  );

  await db.from("grant_applications").update({ notes: narrative, status: "drafting" }).eq("id", id);

  await emit({
    type: "grant.drafted",
    source: "grants",
    actor: "AI",
    subject_type: "grant",
    subject_id: id,
    payload: { funder: g.funder, program: g.program },
  });
  revalidatePath("/grants");
}

// Move a grant along the pipeline: researching → drafting → submitted → won|lost.
export async function advanceStatus(fd: FormData) {
  const id = String(fd.get("id"));
  const status = String(fd.get("status"));
  if (!id || !status) return;
  const patch: any = { status };
  if (status === "submitted") patch.submitted_on = new Date().toISOString();
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
