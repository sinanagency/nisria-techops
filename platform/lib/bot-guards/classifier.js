// Intent classifier, v0.2. One HTTPS call to Anthropic, no DB, no global state.
//
// Returns a typed intent from config.intentEnum + confidence + one line reason.
// Fail open: errors return { intent: <fallback>, confidence: "low" }.
// v0.2 change: an UNRECOGNIZED confidence from the model coerces to "low"
// (the fail safe direction), not "medium". A malformed response must never
// be promoted toward actionable.
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const SYSTEM_PROMPT_TEMPLATE = `You are an intent classifier. You read ONE inbound message plus up to 4 prior turns of context and return EXACTLY ONE intent name from the allowed list, plus a confidence (high|medium|low), plus a one-sentence reason.

The allowed intents for THIS bot are:
{INTENT_LIST}

Decision rules:
- high = the rules match cleanly with little ambiguity
- medium = plausible but ambiguous
- low = you guessed; the caller will fall back to a generic intent
- Pick the SINGLE best intent. Do not return multiple.
- If none of the listed intents fits, pick the LAST intent in the list (treated as "open" by convention).`;
export async function classifyIntent(command, history, config, opts = {}) {
    const fallback = (opts.fallbackIntent || config.intentEnum[config.intentEnum.length - 1] || "open_conversation");
    const make = (reason, error) => ({ intent: fallback, confidence: "low", reason, error });
    if (!command || !command.trim())
        return make("empty_command");
    if (!config.anthropicApiKey)
        return make("no_api_key");
    if (!config.intentEnum.length)
        return make("no_intents_configured");
    const system = SYSTEM_PROMPT_TEMPLATE.replace("{INTENT_LIST}", config.intentEnum.map((i) => `  - ${i}`).join("\n"));
    const tool = {
        name: "classify_intent",
        description: "Return the single best intent for this inbound message.",
        input_schema: {
            type: "object",
            properties: {
                intent: { type: "string", enum: [...config.intentEnum] },
                confidence: { type: "string", enum: ["high", "medium", "low"] },
                reason: { type: "string", description: "One short sentence (under 120 chars) explaining the choice." },
            },
            required: ["intent", "confidence", "reason"],
        },
    };
    const last4 = history.slice(-4);
    const ctxLines = last4.map((m) => `${m.role.toUpperCase()}: ${(m.content || "").slice(0, 240)}`).join("\n");
    const user = `${ctxLines ? ctxLines + "\n" : ""}USER (current): ${command.slice(0, 1000)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 4000);
    try {
        const res = await fetch(ANTHROPIC_URL, {
            method: "POST",
            headers: { "x-api-key": config.anthropicApiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
                model: config.classifierModel || DEFAULT_MODEL,
                max_tokens: 200,
                system,
                tools: [tool],
                tool_choice: { type: "tool", name: "classify_intent" },
                messages: [{ role: "user", content: user }],
            }),
        });
        if (!res.ok) {
            const t = await res.text().catch(() => "");
            return make("classifier_http_error", `${res.status}: ${t.slice(0, 200)}`);
        }
        const j = await res.json();
        const block = (j?.content || []).find((b) => b?.type === "tool_use" && b?.name === "classify_intent");
        const input = block?.input;
        if (!input || !config.intentEnum.includes(input.intent)) {
            return make("classifier_no_tool_use");
        }
        // v0.2: unknown confidence coerces DOWN to "low", never up.
        const conf = ["high", "medium", "low"].includes(input.confidence) ? input.confidence : "low";
        return {
            intent: input.intent,
            confidence: conf,
            reason: String(input.reason || "").slice(0, 200),
        };
    }
    catch (err) {
        return make("classifier_exception", String(err?.message || err).slice(0, 200));
    }
    finally {
        clearTimeout(timeout);
    }
}
//# sourceMappingURL=classifier.js.map