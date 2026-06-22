// GYM RUNNER ENDPOINT (eval-only). Runs Sasa's REAL first-turn decision
// (evalSasa = real buildSystem + real SMART_TOOLS, ONE model call, NO DB writes)
// over a batch of adversarial scenarios. With SASA_BRAIN_BASE_URL set, the brain
// is the local DGX model, so the whole gym runs with zero Anthropic/OpenAI spend.
// Guarded by GROUP_BOT_SECRET (same as /api/evals). Never reachable without it.
import { NextRequest, NextResponse } from "next/server";
import { evalSasa, evalSasaMulti, __testing } from "../../../lib/agents/sasa";
import { intakeIsCase } from "../../../lib/intake-class.mjs";
import { commandReferencesGroup } from "../../../lib/group-tokens.mjs";
import { parseStateTransition, fuzzyMatchTasks } from "../whatsapp/worker/parseTaskOps.mjs";
import { proactiveSendsSince } from "../../../lib/proactive-sends.mjs";
import { admin } from "../../../lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const secret = process.env.GROUP_BOT_SECRET || "";
  if (!secret || req.headers.get("x-eval-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  // GUARDCHECK mode: run the REAL send-honesty guard (claimsSendWithoutSend) on a
  // constructed {reply, toolRuns}. Pure function, zero side effects (no DB, no send),
  // so it proves the DEPLOYED guard's verdict live without posting to a real group.
  if (body?.mode === "guardcheck") {
    const checks = Array.isArray(body?.checks) ? body.checks : null;
    if (!checks) return NextResponse.json({ error: "checks[] required" }, { status: 400 });
    // guard: "send" (default) = claimsSendWithoutSend, "completion" = claimsCompletionWithoutSuccess.
    // Both are pure (no DB, no send) so they prove the DEPLOYED guard's verdict live.
    const out = checks.map((c: any) => {
      const reply = String(c.reply || "");
      const toolRuns = Array.isArray(c.toolRuns) ? c.toolRuns : [];
      const guard = c.guard === "completion" ? "completion" : "send";
      const flagged = guard === "completion"
        ? __testing.claimsCompletionWithoutSuccess(reply, toolRuns)
        : __testing.claimsSendWithoutSend(reply, toolRuns);
      return { id: c.id, guard, flagged };
    });
    return NextResponse.json({ honest_no_send: __testing.HONEST_NO_SEND, results: out });
  }

  // INTAKECLASS mode: run the REAL intake classifier (case vs accepted beneficiary).
  // Pure string logic, no DB write, so it proves the DEPLOYED decision live without
  // creating a real case row. Returns "case" | "accepted" per command.
  if (body?.mode === "intakeclass") {
    const checks = Array.isArray(body?.checks) ? body.checks : null;
    if (!checks) return NextResponse.json({ error: "checks[] required" }, { status: 400 });
    const out = checks.map((c: any) => ({
      id: c.id,
      class: intakeIsCase(String(c.command || ""), c.isAdmin !== false) ? "case" : "accepted",
    }));
    return NextResponse.json({ results: out });
  }

  // GROUPVETO mode: would a post_to_group be VETOED (the operator's message did not
  // reference a group)? Pure, no side effects. Proves the deployed stray-post guard.
  if (body?.mode === "groupveto") {
    const checks = Array.isArray(body?.checks) ? body.checks : null;
    if (!checks) return NextResponse.json({ error: "checks[] required" }, { status: 400 });
    const out = checks.map((c: any) => ({ id: c.id, vetoed: !!c.command && !commandReferencesGroup(String(c.command || ""), String(c.group || "")) }));
    return NextResponse.json({ results: out });
  }

  // TASKOPS mode: does a message parse as a state TRANSITION, and does a fragment match a
  // task title? Proves the deployed wrong-task-match guard (the "already todo" hallucination).
  if (body?.mode === "taskops") {
    const checks = Array.isArray(body?.checks) ? body.checks : null;
    if (!checks) return NextResponse.json({ error: "checks[] required" }, { status: 400 });
    const out = checks.map((c: any) => {
      const st = parseStateTransition(String(c.command || ""));
      const matches = Array.isArray(c.openTitles)
        ? fuzzyMatchTasks(String(c.fragment ?? (st?.title_fragment || "")), c.openTitles.map((t: string, i: number) => ({ id: String(i), title: t }))).map((x: any) => x.title)
        : undefined;
      return { id: c.id, isStateTransition: st !== null, status: st?.status ?? null, matches };
    });
    return NextResponse.json({ results: out });
  }

  // SENDRECORD mode: the CANONICAL proactive-send record (KT #373) read from REAL prod events
  // over the last `mins` minutes. Proves the reader is clean (no replies) + complete (file/task
  // sends included). Read-only. Returns counts by `via` + de-identified rows (name + via + ts).
  if (body?.mode === "sendrecord") {
    const mins = Math.min(Number(body?.mins) || 60, 1800);
    const since = new Date(Date.now() - mins * 60 * 1000).toISOString();
    const rows = await proactiveSendsSince(admin(), since);
    const byVia: Record<string, number> = {};
    for (const r of rows) byVia[r.via] = (byVia[r.via] || 0) + 1;
    return NextResponse.json({ mins, total: rows.length, byVia, sample: rows.slice(0, 25).map((r) => ({ to_name: r.to_name, via: r.via, ts: r.ts })) });
  }

  const scenarios = Array.isArray(body?.scenarios) ? body.scenarios : null;
  if (!scenarios) return NextResponse.json({ error: "scenarios[] required" }, { status: 400 });
  const multi = body?.mode === "multi";

  const results = [];
  for (const s of scenarios) {
    const role = s.role === "team" ? "team" : "admin";
    try {
      if (multi) {
        const out = await evalSasaMulti({ history: s.history, command: s.command, role });
        // judge on the FINAL human-facing reply + every tool called across turns
        results.push({ id: s.id, text: out.finalText, toolCalls: out.allToolCalls, turns: out.turns });
      } else {
        const out = await evalSasa({ history: s.history, command: s.command, role });
        results.push({ id: s.id, text: out.text, toolCalls: out.toolCalls });
      }
    } catch (e: any) {
      results.push({ id: s.id, error: String(e?.message || e) });
    }
  }
  return NextResponse.json({ results });
}
