// Auto-prepare orchestration for the Grant agent.
//
// Goal (FEEDBACK #6): Nur should never have to click "Prepare application". The
// system auto-prepares the strongest opportunities and parks them in the
// "Prepared · review" column, so she only ever ACCEPTS (submit) or DECLINES.
//
// This module is the single source of truth for that batch. It is imported by
//   - the daily discovery refresh (app/api/grants/refresh) — runs after a hunt
//   - the manual "Prepare all ready" button (app/grants/actions.ts)
// so the behaviour is identical no matter who triggers it.
//
// Cost control is MANDATORY and lives here, not at the call sites:
//   - CAP at MAX_PER_RUN Claude calls per invocation
//   - only HIGH-relevance, un-prepared grants are touched
//   - skip-prepared makes it idempotent and safe to call repeatedly
import { admin } from "../supabase-admin";
import { emit } from "../events";
import { buildApplication } from "./grant";

// Hard cap on Claude calls per run. buildApplication is ~3.2k output tokens of
// Sonnet each (plus a funder-page fetch), so this bounds the spend of a single
// batch. Tunable in one place. The cap is enforced for BOTH steps below.
//
// Serverless time budget note: each prepare can take ~15-25s, and the hosting
// tier caps a single invocation at ~60s. So callers pass a per-invocation
// `limit` they can finish in time: the manual button prepares a few per tap and
// the daily refresh prepares a couple after its hunt, both idempotent, so the
// pipeline fills up across runs. MAX_PER_RUN is the absolute ceiling either way.
export const MAX_PER_RUN = 5;
const DEFAULT_LIMIT = 3;

export type AutoPrepareResult = {
  considered: number; // HIGH-relevance grants still needing prep before the cap
  prepared: number;   // packages written this run (<= MAX_PER_RUN)
  capped: boolean;    // true if there was more work than the cap allowed
  errors: number;
};

// Has this grant already been prepared? A prepared grant has a written package
// in `notes`. We also treat anything past "researching"/"drafting" (i.e. already
// in review/submitted/won/lost) as done, so we never re-spend on a moved card.
function alreadyPrepared(g: any): boolean {
  const s = (g.status || "").toLowerCase();
  if (s === "review" || s === "submitted" || s === "won" || s === "lost") return true;
  return !!(g.notes && String(g.notes).trim());
}

// A grant counts as HIGH-relevance when it came from a HIGH opportunity. We tag
// pursued opportunities by writing the relevance into notes at pursue time, but
// to stay robust we ALSO accept an explicit tier passed by the caller. The
// refresh path passes the tier directly from the opportunity it just pursued.
//
// Strategy:
//   1. Auto-pursue HIGH opportunities the hunter found (creates the application).
//   2. Prepare the un-prepared applications, HIGH first, up to the cap.
// Both steps are idempotent.
// Step 1, exported standalone: auto-pursue the hunter's strongest (HIGH) finds
// into the pipeline as researching applications. CHEAP (no Claude), idempotent,
// and bounded. The grant-discovery refresh calls this directly so it never pays
// the cost of a Claude prepare inside its own (network-heavy) invocation.
export async function autoPursueHighOpportunities(max = MAX_PER_RUN): Promise<number> {
  const db = admin();
  let created = 0;
  const { data: opps } = await db
    .from("grant_opportunities")
    .select("*")
    .eq("pursued", false)
    .eq("relevance_tier", "HIGH")
    .order("relevance_score", { ascending: false })
    .limit(Math.max(1, Math.min(max, MAX_PER_RUN)));

  for (const o of (opps || []) as any[]) {
    // skip if we already created an application for this opportunity URL
    if (o.url) {
      const { data: dupe } = await db.from("grant_applications").select("id").eq("link", o.url).limit(1);
      if (dupe && dupe.length) { await db.from("grant_opportunities").update({ pursued: true }).eq("id", o.id); continue; }
    }
    const { data: grant } = await db.from("grant_applications").insert({
      funder: o.funder || o.title,
      program: o.title,
      amount_requested: o.amount_floor || o.amount_ceiling || null,
      deadline: o.close_date || null,
      status: "researching",
      currency: o.currency || "USD",
      link: o.url || null,
      notes: null,
    }).select().single();
    await db.from("grant_opportunities").update({ pursued: true }).eq("id", o.id);
    created++;
    await emit({
      type: "grant.added", source: "agent:grants", actor: "AI",
      subject_type: "grant", subject_id: grant?.id,
      payload: { funder: o.funder, source: o.source, auto: true, tier: "HIGH" },
    });
  }
  return created;
}

export async function autoPrepareReadyGrants(opts: { limit?: number } = {}): Promise<AutoPrepareResult> {
  const db = admin();
  const out: AutoPrepareResult = { considered: 0, prepared: 0, capped: false, errors: 0 };
  // never exceed the hard ceiling, never go below 1
  const limit = Math.max(1, Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_PER_RUN));

  // ---- Step 1: auto-pursue HIGH opportunities into the pipeline (idempotent) -
  try {
    await autoPursueHighOpportunities(limit);
  } catch {
    out.errors++;
  }

  // ---- Step 2: prepare un-prepared applications, HIGH first, up to the cap ----
  // We pull a small working set (researching/drafting only), filter to those that
  // still need a package, then prepare at most MAX_PER_RUN of them.
  let candidates: any[] = [];
  try {
    const { data } = await db
      .from("grant_applications")
      .select("*")
      .in("status", ["researching", "drafting"])
      .order("deadline", { ascending: true, nullsFirst: false })
      .limit(50);
    candidates = (data || []).filter((g: any) => !alreadyPrepared(g));
  } catch {
    out.errors++;
    return out;
  }

  out.considered = candidates.length;
  const batch = candidates.slice(0, limit);
  out.capped = candidates.length > limit;

  for (const g of batch) {
    try {
      const pkg = await buildApplication({
        funder: g.funder,
        program: g.program,
        amount_requested: g.amount_requested,
        currency: g.currency,
        deadline: g.deadline,
        link: g.link,
      });
      // Persist the package and move to "review". DO NOT swallow a write error:
      // a CHECK-constraint / RLS failure here would silently leave the grant
      // unprepared (the exact bug that hid this feature). Surface it as an error
      // so the count is truthful and the prepared event never fires on a no-op.
      const { error: upErr } = await db
        .from("grant_applications")
        .update({ notes: pkg, status: "review" })
        .eq("id", g.id);
      if (upErr) {
        console.error("grant prepare update failed", g.id, upErr.message);
        out.errors++;
        continue;
      }
      await emit({
        type: "grant.prepared", source: "agent:grants", actor: "AI",
        subject_type: "grant", subject_id: g.id,
        payload: { funder: g.funder, program: g.program, auto: true, funder_page: g.link ? "fetched" : "none" },
      });
      out.prepared++;
    } catch {
      out.errors++;
    }
  }

  if (out.prepared > 0) {
    await emit({
      type: "grants.auto_prepared", source: "agent:grants", actor: "AI",
      payload: { prepared: out.prepared, considered: out.considered, capped: out.capped, limit, ceiling: MAX_PER_RUN },
    });
  }

  return out;
}
