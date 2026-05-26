// Dedicated grant-preparation worker. Runs the bounded, idempotent auto-prepare
// batch (lib/agents/grant-autoprepare) in ITS OWN invocation, so it gets the
// full serverless time budget for the (slow) Claude prepares without competing
// with the grant hunt (api/grants/refresh) or the agent tick (comms + steward).
//
// FEEDBACK #6: the strongest opportunities are auto-pursued by the hunt, then
// prepared here into "Prepared · review", so Nur only accepts (Submit) or
// declines. The cap + skip-prepared in the helper keep Claude cost bounded and
// make this safe to call repeatedly (cron, the "Prepare all ready" button, or
// a manual poke).
import { NextRequest, NextResponse } from "next/server";
import { autoPrepareReadyGrants } from "../../../../lib/agents/grant-autoprepare";

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

// limit clamp: how many to prepare this invocation. A full prepare (funder-page
// fetch + long-form Claude generation) measures ~80s, so even with the extended
// budget we cap at 3 per call to stay inside maxDuration. The helper's own
// MAX_PER_RUN (5) is the absolute ceiling; the queue fills across calls.
function clampLimit(req: NextRequest): number {
  const raw = Number(new URL(req.url).searchParams.get("limit") || "3");
  return Math.max(1, Math.min(isNaN(raw) ? 3 : raw, 3));
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const res = await autoPrepareReadyGrants({ limit: clampLimit(req) });
  return NextResponse.json(res);
}

export async function GET(req: NextRequest) {
  if (authed(req)) {
    const res = await autoPrepareReadyGrants({ limit: clampLimit(req) });
    return NextResponse.json(res);
  }
  return NextResponse.json({ ok: true, note: "POST with x-agent-secret to prepare the next ready grants (capped)" });
}
