// SANDBOX MESH REPLAY (eval only, zero side effects). Replays a historical message
// through the NEW mesh: routeMessage -> scoped toolset + domain focus -> the REAL
// agent loop with STUBBED tools (no DB writes, no WhatsApp sends). Used to grade
// the new architecture against the real transcript. Gated by x-eval-secret.
//
// POST { command, history?, role?, routeOnly? }
//   routeOnly:true  -> { domain, confidence, reason }            (cheap, routing only)
//   else            -> { domain, confidence, reason, reply, toolCalls }
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { evalSasaMulti } from "../../../../lib/agents/sasa";
import { routeMessage } from "../../../../lib/agents/router";
import { getToolsForDomain } from "../../../../lib/agents/manifests";
import { DOMAIN_FOCUS } from "../../../../lib/agents/specialists";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const h = Buffer.from(req.headers.get("x-eval-secret") || "");
  const e = Buffer.from(process.env.GROUP_BOT_SECRET || "\0");
  if (h.length !== e.length || !timingSafeEqual(h, e)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body: any = {};
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 }); }
  const command = String(body.command || "").slice(0, 4000);
  if (!command.trim()) return NextResponse.json({ ok: false, error: "no command" }, { status: 400 });
  const role: "admin" | "team" = body.role === "team" ? "team" : "admin";
  const history = Array.isArray(body.history) ? body.history.slice(-8) : [];

  try {
    const routed = await routeMessage(command, history);
    if (body.routeOnly) {
      return NextResponse.json({ ok: true, domain: routed.domain, confidence: routed.confidence, reason: routed.reason });
    }
    // LIVE mode: run the REAL mesh with REAL tools so state actually evolves.
    // HARD-GATED: only runs when REPLAY_LIVE_OK=1 (set ONLY on the isolated sandbox
    // deployment whose SUPABASE points at the throwaway DB + whose WhatsApp creds are
    // blanked). On prod this env is absent, so live:true is refused — real writes can
    // NEVER hit prod through this endpoint.
    if (body.live) {
      if (process.env.REPLAY_LIVE_OK !== "1") {
        return NextResponse.json({ ok: false, error: "live mode disabled here (not the sandbox instance)" }, { status: 403 });
      }
      const { runOrchestrated } = await import("../../../../lib/agents/orchestrator");
      const out = await runOrchestrated({
        command, history,
        operatorRole: role,
        operatorName: body.operatorName,
        operatorRank: body.operatorRank,
        speakerPhone: body.speakerPhone,
        contactId: body.contactId,
        confirmWrites: true,
      } as any);
      return NextResponse.json({
        ok: true, mode: "live", domain: routed.domain, confidence: routed.confidence, reason: routed.reason,
        reply: out.reply, toolsRan: (out as any).toolsRan || [],
      });
    }
    const allowedToolNames = getToolsForDomain(routed.domain, role);
    const domainFocus = DOMAIN_FOCUS[routed.domain];
    const res = await evalSasaMulti({ command, history, role, allowedToolNames, domainFocus, maxTurns: 4 });
    return NextResponse.json({
      ok: true,
      domain: routed.domain,
      confidence: routed.confidence,
      reason: routed.reason,
      reply: res.finalText,
      toolCalls: res.allToolCalls,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message || err).slice(0, 300) }, { status: 500 });
  }
}
