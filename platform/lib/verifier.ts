// INDEPENDENT VERIFIER (the trust gate).
//
// After the main agent (Claude Sonnet) drafts a reply, a DIFFERENT model family
// (OpenAI gpt-4o-mini) checks that every committed-sounding fact in the reply is
// grounded in either the user's own words or a tool result from THIS turn. A
// different model catches what the generator is blind to (independent failure
// modes), which is the whole point of running two models together.
//
// It flags only the dangerous classes: a stated money amount, a payee/person tied
// to a payment or action, or a claim that an action was completed ("logged",
// "recorded", "created a task", "scheduled", "sent"). It ignores empathy,
// questions, and numbers the user themselves provided.
//
// FAIL-OPEN by design: if the key is missing or the check errors, it passes the
// reply through unchanged. The verifier must never be able to break the bot.

type ToolRun = { name: string; input?: any; result?: any };
// `unverified` is true when the check could NOT run (no key, HTTP error, parse
// error). It is distinct from grounded=true (checked and clean): the caller must
// be able to tell "verified clean" from "flew blind", because the second is when
// an invented figure can slip through. grounded stays true in both so the
// verifier can never block a reply (fail-open), but unverified flags the blind case.
export type VerifyResult = { grounded: boolean; problems: string[]; corrected?: string; unverified?: boolean };

const OPENAI_MODEL = "gpt-4o-mini";

const SYSTEM = `You are a strict grounding checker for a nonprofit's operations assistant.

You receive three things:
1. USER: what the user said.
2. TOOLS: the actions that REALLY ran this turn, each with its input and result. Treat every tool input and result as TRUE ground truth.
3. DRAFT: the assistant's proposed reply.

A statement in the DRAFT is SUPPORTED if the amount, name, or action it mentions appears in the USER message OR in any TOOL's input or SUCCESSFUL result. Restating what a tool did (its input or result) is always grounded and correct. A figure read from a tool result is grounded.

IMPORTANT about tool SUCCESS: each TOOL carries an "ok" field. ok=true means the action really happened; ok=false means it FAILED or found nothing and DID NOT happen (read its result/summary for why). A completion claim is supported ONLY by a tool whose name matches the action AND whose ok=true. A tool with ok=false does NOT support any claim that the action was done; it only supports an honest "I could not do it / I did not find it" statement.

Flag a problem ONLY for a concrete statement in the DRAFT that has NO support in the USER message and NO support in any SUCCESSFUL TOOL:
- an invented money amount,
- an invented person/payee name tied to a payment or action,
- a claim that an action was completed ("done", "marked done", "completed", "logged", "created a task", "scheduled", "sent", "reimbursed") when there is no matching tool with ok=true in the TOOLS list (no tool at all, OR only a matching tool with ok=false). Telling the user something is "done" / "marked as done" when the matching tool failed or was never called is the single worst failure: ALWAYS flag it.

Quote the exact offending phrase for each problem.

NEVER flag: a question (e.g. "how much did you pay him?"), empathy, a suggestion, or anything already present in the USER message or a TOOL. If every concrete claim in the draft traces to the user or a tool, return grounded=true with no problems.

If (and only if) you flag something, write CORRECTED: rewrite the draft to drop every unsupported amount and name, and turn any unsupported completion claim into an honest statement that you have NOT done it yet plus a short request for the missing detail. Add no new facts.

Return strict JSON: {"grounded": boolean, "problems": string[], "corrected": string}. If the draft is clean: grounded=true, problems=[], corrected="".`;

export async function verifyReply(opts: {
  userMessage: string;
  toolRuns: ToolRun[];
  reply: string;
}): Promise<VerifyResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!opts.reply.trim()) return { grounded: true, problems: [] };
  if (!key) {
    console.warn("[verifier] OPENAI_API_KEY missing: reply passed UNVERIFIED (grounding check skipped)");
    return { grounded: true, problems: [], unverified: true };
  }
  const payload = {
    USER: opts.userMessage,
    // Surface each tool's success explicitly so the checker can tell a real
    // completion (ok=true) from a failed/empty one (ok=false). A reply that
    // claims "done" while the matching tool returned ok=false must be flagged.
    TOOLS: opts.toolRuns.map((t) => ({ name: t.name, ok: (t.result as any)?.ok, input: t.input, result: t.result })),
    DRAFT: opts.reply,
  };
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: JSON.stringify(payload) },
        ],
      }),
    });
    if (!r.ok) {
      console.warn(`[verifier] OpenAI check failed (${r.status}): reply passed UNVERIFIED`);
      return { grounded: true, problems: [], unverified: true };
    }
    const j = await r.json();
    const txt = j?.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(txt);
    return {
      grounded: parsed.grounded !== false,
      problems: Array.isArray(parsed.problems) ? parsed.problems : [],
      corrected: typeof parsed.corrected === "string" && parsed.corrected.trim() ? parsed.corrected.trim() : undefined,
    };
  } catch (e: any) {
    console.warn(`[verifier] check errored (${e?.message || e}): reply passed UNVERIFIED`);
    return { grounded: true, problems: [], unverified: true };
  }
}
