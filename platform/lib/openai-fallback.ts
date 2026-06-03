// OPENAI FALLBACK — the bot never goes dark.
//
// Every Claude call in this app (the Sasa tool loop in agents/sasa.ts, and the
// askClaude/claudeJSON/vision paths in anthropic.ts) speaks Anthropic's Messages
// shape: a request of { system, messages, tools, max_tokens } and a response of
// { stop_reason, content: [ {type:"text"} | {type:"tool_use"} ] }. When Anthropic
// is rate-limited (the Tier-1 429 the bot kept surfacing), the key is dead/expired
// (401), or the API is overloaded (529) past our retries, we DO NOT want the user
// to see "That one tripped me up." Instead we transparently re-run the exact same
// turn on OpenAI and hand back a response in Anthropic's shape, so the caller's
// loop (tool-use parsing, finalize) is byte-for-byte unchanged.
//
// This is the single translator. It converts:
//   system  (string | [{type:"text",text}])              -> OpenAI system message
//   tools   ([{name,description,input_schema}])           -> OpenAI function tools
//   messages (Anthropic content blocks incl tool_use /     -> OpenAI chat messages
//             tool_result / image)                            (+ tool role msgs)
// and the OpenAI choice back into { stop_reason, content[] }.
//
// Tool-call IDs round-trip: OpenAI's tool_call id becomes the Anthropic tool_use
// block id, the caller echoes it back as tool_result.tool_use_id, and on the next
// turn we map it straight back to OpenAI's tool_call_id. No id rewriting needed.
//
// PDF "document" blocks have no OpenAI chat equivalent, so a payload containing one
// throws Unsupported here; the caller then rethrows the original Anthropic error
// rather than silently degrading. Text + images fall back cleanly.

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
// gpt-4o: strong tool use + vision, the right quality bar for the operator-facing
// agent. Overridable, e.g. to gpt-4o-mini for cheaper non-agent paths.
const FALLBACK_MODEL = () => process.env.OPENAI_FALLBACK_MODEL || "gpt-4o";

// GYM BRAIN-SWAP (eval-only, never set in production). When SASA_BRAIN_BASE_URL
// points at a local OpenAI-compatible endpoint (a DGX vLLM serve), the same
// translator routes there instead of api.openai.com, using SASA_BRAIN_KEY and
// SASA_BRAIN_MODEL. This lets the eval/gym run Sasa's REAL prompt + tools on a
// free local model with zero Anthropic/OpenAI spend. Unset => behaves exactly as
// the OpenAI fallback always has.
export function brainOverrideActive(): boolean {
  return !!(process.env.SASA_BRAIN_BASE_URL || "").trim();
}
const TARGET_URL = () => {
  const base = (process.env.SASA_BRAIN_BASE_URL || "").trim();
  return base ? `${base.replace(/\/$/, "")}/chat/completions` : OPENAI_URL;
};
const TARGET_MODEL = () => (brainOverrideActive() ? (process.env.SASA_BRAIN_MODEL || "gym") : FALLBACK_MODEL());
const TARGET_KEY = () => (brainOverrideActive() ? (process.env.SASA_BRAIN_KEY || "") : (process.env.OPENAI_API_KEY || "")).trim();

export function openAIConfigured(): boolean {
  return !!(process.env.OPENAI_API_KEY || "").trim();
}

function systemToText(system: any): string {
  if (!system) return "";
  if (typeof system === "string") return system;
  if (Array.isArray(system)) {
    return system.map((b: any) => (typeof b === "string" ? b : b?.text || "")).join("\n");
  }
  return String(system);
}

// Anthropic tool -> OpenAI function tool. input_schema IS a JSON Schema, which is
// exactly what OpenAI's parameters wants, so it passes through unchanged.
function toolsToOpenAI(tools: any[]): any[] | undefined {
  if (!Array.isArray(tools) || !tools.length) return undefined;
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description || "",
      parameters: t.input_schema || { type: "object", properties: {} },
    },
  }));
}

class UnsupportedFallback extends Error {}

// One Anthropic message (role + content) may expand into several OpenAI messages:
// an assistant turn with tool_use blocks becomes one assistant message carrying
// tool_calls, and a user turn made of tool_result blocks becomes one OpenAI "tool"
// message per result. Plain string content passes straight through.
function messagesToOpenAI(messages: any[]): any[] {
  const out: any[] = [];
  for (const m of messages || []) {
    const role = m.role;
    const content = m.content;

    if (typeof content === "string") {
      out.push({ role, content });
      continue;
    }
    if (!Array.isArray(content)) {
      out.push({ role, content: String(content ?? "") });
      continue;
    }

    if (role === "assistant") {
      const textParts: string[] = [];
      const toolCalls: any[] = [];
      for (const b of content) {
        if (b.type === "text") textParts.push(b.text || "");
        else if (b.type === "tool_use") {
          toolCalls.push({
            id: b.id,
            type: "function",
            function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
          });
        }
      }
      const msg: any = { role: "assistant", content: textParts.join("\n") || null };
      if (toolCalls.length) msg.tool_calls = toolCalls;
      out.push(msg);
      continue;
    }

    // user / tool-result turn
    const userParts: any[] = [];
    for (const b of content) {
      if (b.type === "tool_result") {
        const resultText = typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? "");
        out.push({ role: "tool", tool_call_id: b.tool_use_id, content: resultText });
      } else if (b.type === "text") {
        userParts.push({ type: "text", text: b.text || "" });
      } else if (b.type === "image") {
        const src = b.source || {};
        const url = src.type === "base64" ? `data:${src.media_type};base64,${src.data}` : src.url;
        userParts.push({ type: "image_url", image_url: { url } });
      } else if (b.type === "document") {
        // PDFs have no chat-completions equivalent; signal "cannot fall back here".
        throw new UnsupportedFallback("document block (PDF) not supported by OpenAI fallback");
      }
    }
    if (userParts.length) {
      // collapse a single text part to a plain string for tidiness
      const onlyText = userParts.length === 1 && userParts[0].type === "text";
      out.push({ role: "user", content: onlyText ? userParts[0].text : userParts });
    }
  }
  return out;
}

// Take an Anthropic-style request payload, run it on OpenAI, return an
// Anthropic-style response { stop_reason, content[] }. Throws if OpenAI is not
// configured, the payload can't be represented (PDF), or the OpenAI call fails,
// so the caller can rethrow the ORIGINAL Anthropic error and degrade honestly.
export async function anthropicViaOpenAI(payload: Record<string, any>): Promise<any> {
  const key = TARGET_KEY();
  if (!key) throw new UnsupportedFallback(brainOverrideActive() ? "SASA_BRAIN_KEY not set" : "OPENAI_API_KEY not set");

  const messages: any[] = [];
  const sys = systemToText(payload.system);
  if (sys) messages.push({ role: "system", content: sys });
  messages.push(...messagesToOpenAI(payload.messages || []));

  const body: Record<string, any> = {
    model: TARGET_MODEL(),
    max_tokens: payload.max_tokens ?? 1024,
    messages,
  };
  const tools = toolsToOpenAI(payload.tools);
  if (tools) body.tools = tools;

  const r = await fetch(TARGET_URL(), {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({} as any));
    throw new Error(j?.error?.message || `OpenAI fallback failed (${r.status})`);
  }
  const j = await r.json();
  const choice = j?.choices?.[0];
  const msg = choice?.message || {};

  // Rebuild Anthropic content[] : text block (if any) + a tool_use block per call.
  // Strip any <think>...</think> reasoning preamble (some open models, e.g. Qwen3,
  // emit it in content; OpenAI never does, so this is a no-op on the real fallback).
  const out: any[] = [];
  if (msg.content) {
    const text = String(msg.content).replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    if (text) out.push({ type: "text", text });
  }
  for (const tc of msg.tool_calls || []) {
    let input: any = {};
    try { input = JSON.parse(tc.function?.arguments || "{}"); } catch { input = {}; }
    out.push({ type: "tool_use", id: tc.id, name: tc.function?.name, input });
  }
  if (!out.length) out.push({ type: "text", text: "" });

  const stop_reason = (msg.tool_calls && msg.tool_calls.length) || choice?.finish_reason === "tool_calls"
    ? "tool_use"
    : "end_turn";

  return { content: out, stop_reason, model: body.model, _via: "openai" };
}
