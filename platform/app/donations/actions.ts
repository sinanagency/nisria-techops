"use server";
// Donor Steward — on-demand. Lets Nur queue a personalized thank-you for any
// gift straight from the Donations table (one row, or all un-thanked recent
// gifts at once). Mirrors the steward section of app/api/agents/tick/route.ts:
// every thank-you DRAFTS into the approvals queue with a gated email intent, so
// it surfaces in "Needs You" and the gateway sends it only on approve. Nothing
// here ever auto-sends — money + PII stay behind the approval gate.
import { admin, money } from "../../lib/supabase-admin";
import { emit } from "../../lib/events";
import { recall, groundingText } from "../../lib/memory";
import { draftThankYou } from "../../lib/agents/steward";
import { laneFor, createIntent } from "../../lib/gateway";
import { revalidatePath } from "next/cache";

// Has this gift already been drafted/queued for a thank-you? We dedupe two ways:
//  1) the intent idempotency_key `thankyou:<donation_id>` (the gateway's own key)
//  2) any approval whose context.donation_id matches (covers manual + auto runs)
async function alreadyQueued(db: any, donationId: string): Promise<boolean> {
  const { data: intent } = await db
    .from("action_intents")
    .select("id")
    .eq("idempotency_key", `thankyou:${donationId}`)
    .maybeSingle();
  if (intent) return true;
  const { data: ap } = await db
    .from("approvals")
    .select("id")
    .eq("kind", "donor_thankyou")
    .eq("context->>donation_id", donationId)
    .limit(1);
  return !!(ap && ap.length);
}

// Core: draft a single thank-you for a loaded gift + donor into the approve queue.
// Returns true if a new approval was created, false if skipped (no email / dup).
async function queueThankYou(db: any, gift: any, donor: any): Promise<boolean> {
  if (!donor?.email) return false;
  if (await alreadyQueued(db, gift.id)) return false;

  const tyLane = await laneFor("kind:donor_thankyou");
  const amount = money(gift.amount);
  const mem = await recall(`thank you donor ${donor.full_name || ""}`, {
    kinds: ["approved_reply", "brand_voice"],
  });
  const ty = await draftThankYou({
    name: donor.full_name || "friend",
    amount,
    recurring: !!gift.is_recurring,
    grounding: groundingText(mem),
  });
  if (!ty) return false;

  const intent = await createIntent({
    connector: "email",
    action: "send_email",
    params: { to: donor.email, subject: ty.subject, text: ty.body },
    lane: tyLane,
    requested_by: "agent:steward",
    correlation_id: gift.id,
    idempotency_key: `thankyou:${gift.id}`,
  });

  const { data: ap } = await db
    .from("approvals")
    .insert({
      kind: "donor_thankyou",
      title: `Thank ${donor.full_name || "donor"}`,
      summary: ty.body.slice(0, 140),
      agent: "agent:steward",
      lane: tyLane,
      proposed: { to: donor.email, subject: ty.subject, body: ty.body, from: donor.full_name },
      context: { donation_id: gift.id, donor_id: donor.id, name: donor.full_name, amount },
      related_contact_id: null,
      intent_id: intent?.id || null,
    })
    .select()
    .single();

  await db.from("agent_runs").insert({
    agent: "agent:steward",
    correlation_id: gift.id,
    decision: tyLane === "auto" ? "auto" : "draft",
    input: { donor: donor.full_name, amount },
    output: { lane: tyLane, requested_by: "nur" },
    model: "claude-sonnet-4-5",
    status: "ok",
  });

  await emit({
    type: "agent.decided",
    source: "agent:steward",
    actor: "agent:steward",
    subject_type: "donor",
    subject_id: donor.id,
    correlation_id: gift.id,
    payload: { kind: "donor_thankyou", lane: tyLane, from: donor.full_name },
  });
  await emit({
    type: "approval.created",
    source: "agent:steward",
    actor: "agent:steward",
    subject_type: "approval",
    subject_id: ap?.id,
    correlation_id: gift.id,
    payload: { kind: "donor_thankyou", title: `Thank ${donor.full_name}`, lane: tyLane },
  });

  return true;
}

// Draft a thank-you for ONE gift (per-row button on /donations).
export async function draftThankYouFor(fd: FormData) {
  const donationId = String(fd.get("donation_id") || "");
  if (!donationId) return;
  const db = admin();

  const { data: gift } = await db
    .from("donations")
    .select("id,amount,is_recurring,donor:donors(id,full_name,email)")
    .eq("id", donationId)
    .single();
  if (!gift) return;

  await queueThankYou(db, gift, (gift as any).donor || {});

  revalidatePath("/donations");
  revalidatePath("/");
}

// Draft thank-yous for ALL recent succeeded gifts that still have no thank-you
// queued and whose donor has an email. Capped at 10 per run to stay within the
// serverless time budget and avoid flooding the approve queue.
export async function draftAllThankYous() {
  const db = admin();
  const since = new Date(Date.now() - 14 * 86400e3).toISOString();

  const { data: gifts } = await db
    .from("donations")
    .select("id,amount,is_recurring,donated_at,donor:donors(id,full_name,email)")
    .eq("status", "succeeded")
    .gte("donated_at", since)
    .order("donated_at", { ascending: false })
    .limit(60);

  let drafted = 0;
  for (const g of (gifts || []) as any[]) {
    if (drafted >= 10) break;
    const donor = g.donor || {};
    if (!donor.email) continue;
    const ok = await queueThankYou(db, g, donor);
    if (ok) drafted++;
  }

  revalidatePath("/donations");
  revalidatePath("/");
}
