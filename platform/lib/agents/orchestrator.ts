// ORCHESTRATOR (mesh) — deterministic routing + domain-scoped delegation.
//
// The ONLY agent entry from the worker. Flow:
// 1. media -> intake-pipeline -> domain ; text -> router.routeMessage
// 2. low confidence -> decomposeMessage into per-domain steps
// 3. runSpecialist(domain): the shared engine, HARD-scoped to that domain's tools
// 4. multi-step -> synthesize
// 5. finalizeWithGuard: cross-domain leakage check on the REAL tools that ran
//
// There is NO monolith fallback. A specialist failure returns an honest error and
// emits mesh.specialist_error; it never re-runs the engine with the full toolset.

import { runSasa, type SasaTurn, type SasaResult } from "./sasa";
import { routeMessage, decomposeMessage, type Domain } from "./router";
import { runSpecialist } from "./specialists";
import { processIntake } from "./intake-pipeline";
import { TOOL_TO_DOMAIN, checkDomainLeakage } from "./manifests";
import { claudeJSON } from "../anthropic";
import { emit } from "../events";

// Kept as a kill-switch hook. The worker no longer branches on it (the mesh is
// the only path); when off, routing simply collapses everyone to the engine via
// the general specialist. Never re-enables a full-tool monolith brain.
export function meshEnabled(): boolean {
  return (process.env.SASA_MESH || "").toLowerCase() === "on";
}

// Mesh telemetry. Awaited (emit() swallows its own errors) so the insert flushes
// before the serverless worker suspends; un-awaited inserts get dropped.
async function emitMesh(type: string, payload: Record<string, any>): Promise<void> {
  try {
    await emit({
      type,
      source: "agent:orchestrator",
      actor: "system",
      subject_type: "domain",
      subject_id: null, // events.subject_id is uuid; domain lives in payload
      payload,
    });
  } catch {}
}

type OrchestratorOpts = Parameters<typeof runSasa>[0];

const HONEST_ERROR = "I hit a snag handling that just now. I have flagged it and will pick it back up. Mind sending it again in a moment?";

export async function runOrchestrated(opts: OrchestratorOpts): Promise<SasaResult> {
  const command = String((opts as any).command || "");
  const history: SasaTurn[] = [...((opts as any).history || [])];
  const tier = (opts as any).operatorRole === "team" ? "team" : "admin";

  const isMedia = command.includes("[Media attachment") || command.includes("[document attachment") || command.includes("[image attachment");

  let steps: { domain: Domain; text: string }[] = [];

  if (isMedia) {
    const extractedMatch = command.match(/\[Media attachment.*?\]\n([\s\S]*?)\n\n/);
    const extractedText = extractedMatch ? extractedMatch[1] : "";
    const originalCommand = command.split("\n\n")[0] || "";
    const intakeResult = await processIntake({
      extractedText,
      originalCommand,
      mediaType: command.includes("[document") ? "document" : command.includes("[image") ? "image" : "voice",
      history,
    });
    steps = [{ domain: intakeResult.domain, text: intakeResult.routedCommand }];
    await emitMesh("mesh.routed", { domain: intakeResult.domain, confidence: 1, reason: "media_intake", command: command.slice(0, 200) });
  } else {
    const routeResult = await routeMessage(command, history);
    if (routeResult.confidence < 0.7) {
      const decomposed = await decomposeMessage(command);
      // Cap fan-out: a single message can't explode into unbounded specialist runs
      // (cost/DoS amplification + per-step domain smuggling). Handle the first few.
      steps = decomposed.length > 1 ? decomposed.slice(0, 3) : [{ domain: routeResult.domain, text: command }];
    } else {
      steps = [{ domain: routeResult.domain, text: command }];
    }
  }

  // Single step: run the specialist directly.
  if (steps.length === 1) {
    const step = steps[0];
    try {
      const result = await runSpecialist({
        domain: step.domain,
        command: step.text,
        history,
        tier,
        operatorName: (opts as any).operatorName,
        base: opts as any,
      });
      const finalReply = await finalizeWithGuard(result.reply, result.toolsRan.map((n) => ({ name: n, result: null })), step.domain);
      await emitMesh("mesh.completed", { domain: step.domain, toolsRan: result.toolsRan, steps: 1 });
      return {
        reply: finalReply,
        actions: result.toolsRan.map((n) => ({ ok: true as const, summary: `${n} called`, affordance: undefined })),
        toolsRan: result.toolsRan,
      };
    } catch (err) {
      await emitMesh("mesh.specialist_error", { domain: step.domain, error: String((err as any)?.message || err).slice(0, 300) });
      console.error(`[orchestrator] specialist failed for ${step.domain}:`, err);
      return { reply: HONEST_ERROR, actions: [], toolsRan: [] };
    }
  }

  // Multi-step: run each specialist sequentially. No monolith fallback.
  const replies: string[] = [];
  const actions: SasaResult["actions"] = [];
  const allToolsRan: string[] = [];

  for (const step of steps) {
    try {
      const result = await runSpecialist({
        domain: step.domain,
        command: step.text,
        history,
        tier,
        operatorName: (opts as any).operatorName,
        base: opts as any,
      });
      if (result.reply) {
        history.push({ role: "user", content: step.text });
        history.push({ role: "assistant", content: result.reply });
        replies.push(result.reply);
      }
      if (result.toolsRan.length) {
        allToolsRan.push(...result.toolsRan);
        actions.push(...result.toolsRan.map((n) => ({ ok: true as const, summary: `${n} called`, affordance: undefined })));
      }
    } catch (err) {
      await emitMesh("mesh.specialist_error", { domain: step.domain, error: String((err as any)?.message || err).slice(0, 300) });
      console.error(`[orchestrator] specialist failed for ${step.domain}:`, err);
      replies.push("One part of that tripped me up and I have flagged it.");
    }
  }

  let reply = replies.join("\n");
  if (replies.length > 1) {
    try {
      const syn = await claudeJSON<{ reply: string }>(
        "Combine these step results into ONE short, warm, first-person Sasa reply (1-4 sentences) that confirms what was done across all the steps. Never claim a step succeeded if its result says it did not. No em-dashes. Return JSON {\"reply\":\"...\"}.",
        `Original request: ${command}\n\nStep results:\n${replies.map((r, i) => `${i + 1}. ${r}`).join("\n")}`,
        500,
      );
      if (syn?.reply) reply = syn.reply;
    } catch {}
  }

  const finalReply = await finalizeWithGuard(reply, allToolsRan.map((n) => ({ name: n, result: null })), steps[0]?.domain || "general");
  await emitMesh("mesh.completed", { domain: steps.map((s) => s.domain).join("+"), toolsRan: allToolsRan, steps: steps.length });
  return { reply: finalReply, actions, toolsRan: allToolsRan };
}

// Cross-domain leakage check lives in ./manifests (single source, pure, testable).
// Imported above for the runtime guard; re-exported here for existing callers.
export { checkDomainLeakage } from "./manifests";

export async function finalizeWithGuard(
  reply: string,
  toolRuns: { name: string; result: any }[],
  expectedDomain: Domain,
): Promise<string> {
  const leakage = checkDomainLeakage(reply, toolRuns, expectedDomain);
  if (leakage.leakage) {
    console.warn(`[orchestrator:guard] domain leakage: ${leakage.details}`);
    await emitMesh("mesh.domain_leakage", {
      domain: expectedDomain,
      details: leakage.details,
      tools: toolRuns.map((t) => t.name),
    });
  }
  return reply;
}
