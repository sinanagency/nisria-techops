// ORCHESTRATOR (mesh v1) — the "one Sasa, many hands" layer, FLAG-GATED.
//
// Fixes the multi-step gap the gym found: when one message contains several
// chained actions ("schedule the meeting AND update the beneficiary AND tell the
// team"), the monolith runSasa loop tends to do the first and stall. This wraps
// the SAME runSasa: decompose the message into ordered atomic sub-instructions,
// run each through runSasa sequentially (threading history so context carries),
// then synthesize ONE first-person Sasa reply.
//
// OFF by default. Only active when SASA_MESH=on. The monolith stays the live path
// until the 727 regression / gym validates the mesh. Reuses the real prompt+tools
// (each sub-step is a full runSasa turn), so no behavior is reinvented — just
// sequenced. A single-step message is a pure passthrough (one extra decompose call).
import { runSasa, type SasaTurn, type SasaResult } from "./sasa";
import { claudeJSON } from "../anthropic";

export function meshEnabled(): boolean {
  return (process.env.SASA_MESH || "").toLowerCase() === "on";
}

type OrchestratorOpts = Parameters<typeof runSasa>[0];

export async function runOrchestrated(opts: OrchestratorOpts): Promise<SasaResult> {
  // 1) DECOMPOSE — split into ordered atomic sub-instructions (single action/question each).
  let steps: string[] = [];
  try {
    const out = await claudeJSON<{ steps: string[] }>(
      "You split an operator's WhatsApp instruction to an ops assistant into an ordered list of ATOMIC sub-instructions, each exactly one action or one question, in the order they should run. If the message is already a single action/question, return ONE item. Keep each step in the operator's own words. Return JSON {\"steps\":[\"...\"]}.",
      String((opts as any).command || ""),
      600,
    );
    steps = (out?.steps || []).map((s) => String(s).trim()).filter(Boolean).slice(0, 6);
  } catch { steps = []; }

  // Single-step (or decompose failed): pure passthrough to the monolith.
  if (steps.length <= 1) return await runSasa(opts);

  // 2) RUN each sub-step through the real Sasa loop, threading history for context.
  const history: SasaTurn[] = [...((opts as any).history || [])];
  const replies: string[] = [];
  const actions: SasaResult["actions"] = [];
  for (const step of steps) {
    const r = await runSasa({ ...opts, history, command: step });
    if (r.reply) {
      history.push({ role: "user", content: step });
      history.push({ role: "assistant", content: r.reply });
      replies.push(r.reply);
    }
    if (r.actions?.length) actions.push(...r.actions);
  }

  // 3) SYNTHESIZE one warm first-person Sasa reply confirming the whole thing.
  let reply = replies.join("\n");
  try {
    const syn = await claudeJSON<{ reply: string }>(
      "Combine these step results into ONE short, warm, first-person Sasa reply (1-4 sentences) that confirms what was done across all the steps. Never claim a step succeeded if its result says it did not. No em-dashes. Return JSON {\"reply\":\"...\"}.",
      `Original request: ${String((opts as any).command || "")}\n\nStep results:\n${replies.map((r, i) => `${i + 1}. ${r}`).join("\n")}`,
      500,
    );
    if (syn?.reply) reply = syn.reply;
  } catch { /* keep the joined replies */ }

  return { reply, actions };
}
