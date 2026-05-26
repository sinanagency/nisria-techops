// Dedicated grant-preparation WORKER. Runs on its own request, so the slow
// Claude prepares (15-80s each) never sit on the founder's navigation path.
//
// Two responsibilities, both bounded + idempotent:
//   1) DRAIN THE QUEUE — claim queued `grant.prepare` jobs (enqueued instantly
//      by the "Prepare all ready" / per-grant click) and build each package.
//      This is the path the detached fire-and-forget trigger hits right after a
//      click, so the work starts immediately without blocking the click.
//   2) BACKSTOP TOP-UP — also run the original auto-prepare batch (auto-pursue
//      HIGH opportunities + prepare un-queued applications), so the daily cron
//      keeps the pipeline full even when nobody clicked anything.
//
// Either way the cap + skip-prepared keep Claude cost bounded and make this safe
// to call repeatedly (cron, the button's detached trigger, or a manual poke).
import { NextRequest, NextResponse } from "next/server";
import { admin } from "../../../../lib/supabase-admin";
import { emit } from "../../../../lib/events";
import { buildApplication } from "../../../../lib/agents/grant";
import { autoPrepareReadyGrants } from "../../../../lib/agents/grant-autoprepare";
import { claimJobs, markJobDone, markJobError } from "../../../../lib/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A single buildApplication (funder-page fetch + a long-form Claude generation)
// can run well past 60s, so this dedicated worker asks for the longer budget.
// On plans that cap below this, Vercel clamps it; the helper is still capped +
// idempotent, so a clamp just means fewer prepares land per call.
export const maxDuration = 300;

function authed(req: NextRequest): boolean {
  const agent = process.env.AGENT_TICK_SECRET, cron = process.env.CRON_SECRET;
  const h = req.headers.get("x-agent-secret");
  const auth = req.headers.get("authorization") || "";
  const qs = new URL(req.url).searchParams.get("key");
  return Boolean((agent && (h === agent || qs === agent)) || (cron && auth === `Bearer ${cron}`));
}

// limit clamp: how many prepares this invocation may run. A full prepare
// (funder-page fetch + long-form Claude generation) measures ~80s, so even with
// the extended budget we cap at 3 per call to stay well inside maxDuration. The
// queue + cron drain the rest across calls.
function clampLimit(req: NextRequest): number {
  const raw = Number(new URL(req.url).searchParams.get("limit") || "3");
  return Math.max(1, Math.min(isNaN(raw) ? 3 : raw, 3));
}

// Drain queued grant.prepare jobs: claim, build the package, persist, mark done.
// Returns how many packages landed this invocation.
async function drainQueue(limit: number): Promise<{ drained: number; errors: number }> {
  const db = admin();
  const jobs = await claimJobs("grant.prepare", limit);
  let drained = 0, errors = 0;

  for (const job of jobs) {
    const gid = job.subject_id;
    if (!gid) { await markJobError(job.id, "no subject_id"); errors++; continue; }
    try {
      const { data: g } = await db.from("grant_applications").select("*").eq("id", gid).single();
      if (!g) { await markJobError(job.id, "grant not found"); errors++; continue; }
      // Idempotent: if it was prepared/moved since the job was queued, no-op.
      const s = (g.status || "").toLowerCase();
      const done = ["review", "submitted", "won", "lost"].includes(s) || !!(g.notes && String(g.notes).trim());
      if (done) { await markJobDone(job.id); continue; }

      const pkg = await buildApplication({
        funder: g.funder, program: g.program, amount_requested: g.amount_requested,
        currency: g.currency, deadline: g.deadline, link: g.link,
      });
      const { error: upErr } = await db
        .from("grant_applications")
        .update({ notes: pkg, status: "review" })
        .eq("id", gid);
      if (upErr) { await markJobError(job.id, upErr.message); errors++; continue; }

      await emit({
        type: "grant.prepared", source: "agent:grants", actor: "AI",
        subject_type: "grant", subject_id: gid,
        payload: { funder: g.funder, program: g.program, via: "job", funder_page: g.link ? "fetched" : "none" },
      });
      await markJobDone(job.id);
      drained++;
    } catch (e: any) {
      await markJobError(job.id, e?.message || "prepare failed");
      errors++;
    }
  }
  return { drained, errors };
}

async function run(req: NextRequest) {
  const limit = clampLimit(req);
  // 1) drain explicitly-queued work first (the click path)
  const queue = await drainQueue(limit);
  // 2) backstop: if the queue had room left, top up from the auto-prepare batch
  //    (auto-pursue HIGH opportunities + prepare any un-queued applications).
  const remaining = Math.max(0, limit - queue.drained);
  const auto = remaining > 0 ? await autoPrepareReadyGrants({ limit: remaining }) : { considered: 0, prepared: 0, capped: false, errors: 0 };
  return { queue, auto };
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await run(req));
}

export async function GET(req: NextRequest) {
  if (authed(req)) return NextResponse.json(await run(req));
  return NextResponse.json({ ok: true, note: "POST with x-agent-secret to drain the grant.prepare queue (capped)" });
}
