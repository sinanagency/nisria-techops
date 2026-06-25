// ORCHESTRATOR (mesh v2) — deterministic routing + specialist delegation.
//
// Replaces the v1 orchestrator (which just decomposed and ran monolith runSasa).
// Now: route to domain → delegate to specialist → synthesize reply.
//
// FLAG-GATED: Only active when SASA_MESH=on. The monolith stays the live path
// until the gym validates the mesh. Backward compatible.
//
// Flow:
// 1. Route message to domain (deterministic + Haiku fallback)
// 2. If multi-domain: decompose → route each step
// 3. Delegate to specialist (focused prompt + tool subset)
// 4. Synthesize final reply
// 5. Guard runs (honesty + PII + capability check)

import { runSasa, type SasaTurn, type SasaResult } from "./sasa";
import { routeMessage, decomposeMessage, type Domain } from "./router";
import { runSpecialist } from "./specialists";
import { processIntake } from "./intake-pipeline";
import { MANIFESTS, getToolsForDomain, TOOL_TO_DOMAIN } from "./manifests";
import { claudeJSON } from "../anthropic";

export function meshEnabled(): boolean {
  return (process.env.SASA_MESH || "").toLowerCase() === "on";
}

type OrchestratorOpts = Parameters<typeof runSasa>[0];

export async function runOrchestrated(opts: OrchestratorOpts): Promise<SasaResult> {
  const command = String((opts as any).command || "");
  const history: SasaTurn[] = [...((opts as any).history || [])];
  const tier = (opts as any).operatorRole === "team" ? "team" : "admin";

  // Check if this is a media message (has extracted text)
  const isMedia = command.includes("[Media attachment") || command.includes("[document attachment") || command.includes("[image attachment");

  let domain: Domain;
  let steps: { domain: Domain; text: string }[] = [];

  if (isMedia) {
    // Media message: run through intake pipeline
    const extractedMatch = command.match(/\[Media attachment.*?\]\n([\s\S]*?)\n\n/);
    const extractedText = extractedMatch ? extractedMatch[1] : "";
    const originalCommand = command.split("\n\n")[0] || "";

    const intakeResult = await processIntake({
      extractedText,
      originalCommand,
      mediaType: command.includes("[document") ? "document" : command.includes("[image") ? "image" : "voice",
      history,
    });

    domain = intakeResult.domain;
    steps = [{ domain, text: intakeResult.routedCommand }];
  } else {
    // Text message: route directly
    const routeResult = await routeMessage(command, history);
    domain = routeResult.domain;

    // Check if multi-domain (low confidence or ambiguous)
    if (routeResult.confidence < 0.7) {
      const decomposed = await decomposeMessage(command);
      if (decomposed.length > 1) {
        steps = decomposed;
      } else {
        steps = [{ domain, text: command }];
      }
    } else {
      steps = [{ domain, text: command }];
    }
  }

  // Single step: run specialist directly
  if (steps.length === 1) {
    const step = steps[0];
    try {
      const result = await runSpecialist({
        domain: step.domain,
        command: step.text,
        history,
        tier,
        operatorName: (opts as any).operatorName,
      });

      return {
        reply: result.reply,
        actions: result.toolCalls.map((tc) => ({ ok: true as const, summary: `${tc.name} called`, affordance: undefined })),
      };
    } catch (err) {
      // Fallback to monolith if specialist fails
      console.error(`[orchestrator] specialist failed for ${step.domain}:`, err);
      return await runSasa(opts);
    }
  }

  // Multi-step: run each specialist sequentially
  const replies: string[] = [];
  const actions: SasaResult["actions"] = [];

  for (const step of steps) {
    try {
      const result = await runSpecialist({
        domain: step.domain,
        command: step.text,
        history,
        tier,
        operatorName: (opts as any).operatorName,
      });

      if (result.reply) {
        history.push({ role: "user", content: step.text });
        history.push({ role: "assistant", content: result.reply });
        replies.push(result.reply);
      }
      if (result.toolCalls.length) {
        actions.push(...result.toolCalls.map((tc) => ({ ok: true as const, summary: `${tc.name} called`, affordance: undefined })));
      }
    } catch (err) {
      console.error(`[orchestrator] specialist failed for ${step.domain}:`, err);
      // Fallback to monolith for this step
      const fallback = await runSasa({ ...opts, history, command: step.text });
      if (fallback.reply) replies.push(fallback.reply);
      if (fallback.actions) actions.push(...fallback.actions);
    }
  }

  // Synthesize final reply
  let reply = replies.join("\n");
  if (replies.length > 1) {
    try {
      const syn = await claudeJSON<{ reply: string }>(
        "Combine these step results into ONE short, warm, first-person Sasa reply (1-4 sentences) that confirms what was done across all the steps. Never claim a step succeeded if its result says it did not. No em-dashes. Return JSON {\"reply\":\"...\"}.",
        `Original request: ${command}\n\nStep results:\n${replies.map((r, i) => `${i + 1}. ${r}`).join("\n")}`,
        500,
      );
      if (syn?.reply) reply = syn.reply;
    } catch {
      // Keep joined replies if synthesis fails
    }
  }

  return { reply, actions };
}

// Guard enhancement: check for cross-domain leakage
export function checkDomainLeakage(
  reply: string,
  toolRuns: { name: string; result: any }[],
  expectedDomain: Domain,
): { leakage: boolean; details: string } {
  // Check if any tool calls belong to a different domain
  for (const toolRun of toolRuns) {
    const toolDomain = TOOL_TO_DOMAIN[toolRun.name];
    if (toolDomain && toolDomain !== expectedDomain) {
      // Allow cross-cutting tools
      if (!["lookup_contact", "search_history", "remember_fact", "flag_for_clarity", "agent_activity"].includes(toolRun.name)) {
        return {
          leakage: true,
          details: `Tool ${toolRun.name} belongs to ${toolDomain} domain, but specialist is ${expectedDomain}`,
        };
      }
    }
  }

  return { leakage: false, details: "" };
}

// Enhanced finalize with capability check
export async function finalizeWithGuard(
  reply: string,
  toolRuns: { name: string; result: any }[],
  expectedDomain: Domain,
): Promise<string> {
  // Check for cross-domain leakage
  const leakage = checkDomainLeakage(reply, toolRuns, expectedDomain);
  if (leakage.leakage) {
    // Log the leakage but don't block — the specialist prompt should prevent this
    console.warn(`[orchestrator:guard] domain leakage detected: ${leakage.details}`);
    // Emit event for observability
    try {
      const { emit } = await import("../events");
      emit({
        type: "sasa.domain_leakage",
        source: "agent:orchestrator",
        actor: "system",
        subject_type: "domain",
        subject_id: expectedDomain,
        payload: {
          details: leakage.details,
          reply: reply.slice(0, 200),
          tools: toolRuns.map((t) => t.name),
        },
      }).catch(() => {});
    } catch {}
  }

  return reply;
}
