// Architecture 2 — INTENT CLASSIFIER.
//
// One cheap Haiku call. Structured output via forced tool use. Maps every
// inbound to a typed intent so the worker can route to the right
// deterministic handler instead of bouncing through brittle regex chains.
//
// Replaces "more dynamic regex" by promoting intent detection to a structured
// classification problem: new intents become new enum values, not new regex.
//
// Fail-open: classifier errors return { intent: "open_conversation",
// confidence: "low" } so the existing LLM path still runs. The classifier is
// observation-first — its output is logged via emit so we can grade accuracy
// against real conversations before making it load-bearing for routing.

import { HAIKU } from "./anthropic";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

export type Intent =
  | "task_create"        // explicit task creation: "remind me", "log a task: X", bullet list
  | "task_title_reply"   // bare title following Sasa's "What's the task?" — Layer 0 owns
  | "payment_record"     // "pay X", "logged 5000 to Y", forwarded M-Pesa receipt
  | "case_create"        // new beneficiary case: "this is a new case", "add this person"
  | "confirm_yes"        // "yes", "go ahead", "ok", "✓", "yas", typo-tolerant
  | "confirm_no"         // "no", "cancel", "stop", "hapana", "scrap"
  | "question_read"      // "what's on my plate", "how many beneficiaries", read-only lookup
  | "meta_capability"    // "what can you do?", capability question
  | "open_conversation"; // everything else — LLM handles with full toolset

export type Confidence = "high" | "medium" | "low";

export interface ClassifyResult {
  intent: Intent;
  confidence: Confidence;
  reason: string;
  /** If the classifier hit an error or fell open, this is the original error. */
  error?: string;
}

const INTENTS: Intent[] = [
  "task_create",
  "task_title_reply",
  "payment_record",
  "case_create",
  "confirm_yes",
  "confirm_no",
  "question_read",
  "meta_capability",
  "open_conversation",
];

const SYSTEM = `You are an intent classifier for Sasa, the Nisria operations bot on WhatsApp. You read ONE inbound message plus up to 4 prior turns of context and return EXACTLY ONE intent + a confidence + a one-sentence reason.

Decision rules (in priority order):
1. confirm_yes / confirm_no: a short reply (under 20 chars) that is a yes/no/cancel variant in English, Swahili, or emoji. Examples: "yes", "yeah", "yas", "go ahead", "ok", "👍", "✓", "sawa", "ndio" → confirm_yes. "no", "cancel", "stop", "hapana", "👎" → confirm_no.
2. task_title_reply: short message AND the PRIOR bot turn ended with a clarifying question about a task ("What's the task?", "Which task?"). The reply IS the task title.
3. payment_record: mentions money + a person + an action verb (paid, sent, logged, gave). Forwarded M-Pesa / SendWave receipts qualify.
4. task_create: imperative task creation. "Remind me", "add a task", "log a task:", bullet list of tasks, "@Name do X".
5. case_create: "this is a new case", "add this person", "new beneficiary", a paragraph describing someone needing help.
6. question_read: read-only questions. "what's on my plate", "how many", "show me", "did I", "what is".
7. meta_capability: "what can you do", "what are your features", "are you able to".
8. open_conversation: anything else — feedback, observations, multi-step instructions, ambiguous.

Confidence:
- high = the rules above match cleanly
- medium = the message is plausible but ambiguous
- low = you guessed; the worker should treat this as open_conversation`;

export async function classifyIntent(
  command: string,
  history: { role: "user" | "assistant"; content: string }[] = [],
  opts: { timeoutMs?: number } = {}
): Promise<ClassifyResult> {
  const fallback: ClassifyResult = { intent: "open_conversation", confidence: "low", reason: "classifier_unavailable" };
  if (!command || !command.trim()) return { ...fallback, reason: "empty_command" };

  const KEY = process.env.ANTHROPIC_API_KEY;
  if (!KEY) return { ...fallback, reason: "no_api_key" };

  const tool = {
    name: "classify_intent",
    description: "Return the single best intent for this inbound message.",
    input_schema: {
      type: "object" as const,
      properties: {
        intent: { type: "string", enum: INTENTS },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
        reason: { type: "string", description: "One short sentence (under 120 chars) explaining the choice." },
      },
      required: ["intent", "confidence", "reason"],
    },
  };

  // Build context: last 4 turns then the current command, as a single string.
  // Keep it compact — classifier doesn't need full history, just enough for
  // task_title_reply to detect a prior clarifying question.
  const last4 = history.slice(-4);
  const ctxLines = last4.map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 240)}`).join("\n");
  const user = `${ctxLines ? ctxLines + "\n" : ""}USER (current): ${command.slice(0, 1000)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 4000);
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: HAIKU,
        max_tokens: 200,
        system: SYSTEM,
        tools: [tool],
        tool_choice: { type: "tool", name: "classify_intent" },
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { ...fallback, reason: "classifier_http_error", error: `${res.status}: ${t.slice(0, 200)}` };
    }
    const j: any = await res.json();
    const block = (j?.content || []).find((b: any) => b?.type === "tool_use" && b?.name === "classify_intent");
    const input = block?.input;
    if (!input || !INTENTS.includes(input.intent)) {
      return { ...fallback, reason: "classifier_no_tool_use" };
    }
    const conf: Confidence = ["high", "medium", "low"].includes(input.confidence) ? input.confidence : "medium";
    return {
      intent: input.intent,
      confidence: conf,
      reason: String(input.reason || "").slice(0, 200),
    };
  } catch (err: any) {
    return { ...fallback, reason: "classifier_exception", error: String(err?.message || err).slice(0, 200) };
  } finally {
    clearTimeout(timeout);
  }
}
