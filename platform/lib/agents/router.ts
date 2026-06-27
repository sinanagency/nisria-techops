// DOMAIN ROUTER — deterministic classification + Haiku fallback.
//
// Routes every inbound message to a domain (work/money/people/comms/knowledge/general).
// Two-stage: rule-based fast path (regex patterns from transcript analysis), then
// Haiku fallback for ambiguous cases. Multi-domain messages are decomposed into
// per-domain steps.
//
// Replaces the observation-only intent-classifier with a load-bearing router.
// The intent-classifier still runs for logging/grading but does not affect routing.

import { HAIKU } from "../anthropic";
import { MANIFESTS, type Domain } from "./manifests";
import { admin } from "../supabase-admin";

export type { Domain };

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

// Telemetry: emit the routing decision. Awaited inside try/catch so it flushes
// in the serverless worker (un-awaited inserts get dropped when the function
// suspends), while a caught error can never break the reply path.
async function emitRouterTelemetry(
  domain: Domain,
  confidence: number,
  reason: string,
  command: string,
): Promise<void> {
  // AWAIT the insert (inside try/catch) so it actually flushes before the
  // serverless worker suspends. A caught error can never break the reply path.
  try {
    const { error } = await admin().from("events").insert({
      type: "mesh.routed",
      source: "agent:router",
      actor: "system",
      subject_type: "domain",
      subject_id: null, // events.subject_id is uuid; domain lives in payload

      payload: { domain, confidence, reason: reason.slice(0, 200), command: command.slice(0, 200) },
    });
    if (error) console.error("mesh.routed insert error:", error);
  } catch (e) {
    console.error("emitRouterTelemetry threw:", e);
  }
}

export type RouterResult = {
  domain: Domain;
  confidence: number; // 0-1
  reason: string;
  steps?: { domain: Domain; text: string }[]; // for multi-domain messages
};

// The keyword scorer and DOMAIN_PATTERNS live in ./router-patterns (a pure module
// with no model-client import), so the routing logic is testable under plain node.
// Imported for internal fast-lane use and re-exported for existing callers.
import { scoreDomains, DOMAIN_PATTERNS } from "./router-patterns";
export { scoreDomains, DOMAIN_PATTERNS } from "./router-patterns";

// Haiku fallback for ambiguous cases.
async function haikuClassify(
  text: string,
  history: { role: "user" | "assistant"; content: string }[] = [],
): Promise<{ domain: Domain; confidence: number; reason: string }> {
  const KEY = process.env.ANTHROPIC_API_KEY;
  if (!KEY) return { domain: "general", confidence: 0.5, reason: "no_api_key" };

  const domains = Object.keys(MANIFESTS).join(", ");
  const system = `You are a domain router for Sasa, the Nisria operations bot. Classify the inbound message into ONE of these domains: ${domains}.

Decision rules:
- work: tasks, reminders, calendar, scheduling, deadlines
- money: payments, donations, finance, salaries, receipts, invoices
- comms: messaging, email, newsletters, posting to groups, outbound
- people: team members, contacts, beneficiaries, cases, intake
- knowledge: org documents, files, Brain facts, grants, memory, search
- programs: Maisha inventory (stock, quantities, Folklore listing) and the donor wishlist (fundable needs and funded counts)
- library: saving and recalling LINKS / articles / clips / resources to keep ("save this link", "remember this article", "find/send me the X again", "the sample pics")
- general: greetings, meta-questions, ambiguous, or multi-domain

If the message touches multiple domains, pick the PRIMARY one (the action that needs to happen first).

Return JSON: {"domain": "...", "confidence": 0.0-1.0, "reason": "one short sentence"}`;

  const last4 = history.slice(-4);
  const ctxLines = last4.map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 200)}`).join("\n");
  const user = `${ctxLines ? ctxLines + "\n" : ""}USER (current): ${text.slice(0, 1000)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: HAIKU,
        max_tokens: 150,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });

    if (!res.ok) {
      return { domain: "general", confidence: 0.3, reason: `haiku_error_${res.status}` };
    }

    const j: any = await res.json();
    const textBlock = (j?.content || []).find((b: any) => b?.type === "text");
    if (!textBlock?.text) return { domain: "general", confidence: 0.3, reason: "haiku_no_text" };

    // Try to parse JSON from the response
    const jsonMatch = textBlock.text.match(/\{[^}]+\}/);
    if (!jsonMatch) return { domain: "general", confidence: 0.3, reason: "haiku_no_json" };

    const parsed = JSON.parse(jsonMatch[0]);
    const domain = Object.keys(MANIFESTS).includes(parsed.domain) ? parsed.domain : "general";
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0.5;
    const reason = typeof parsed.reason === "string" ? parsed.reason.slice(0, 200) : "";

    return { domain: domain as Domain, confidence, reason };
  } catch (err: any) {
    return { domain: "general", confidence: 0.3, reason: `haiku_exception: ${String(err?.message || err).slice(0, 100)}` };
  } finally {
    clearTimeout(timeout);
  }
}

// Main router function.
export async function routeMessage(
  text: string,
  history: { role: "user" | "assistant"; content: string }[] = [],
): Promise<RouterResult> {
  if (!text || !text.trim()) {
    return { domain: "general", confidence: 0, reason: "empty_message" };
  }

  // UNDERSTAND-FIRST router (2026-06-26, KT #411). The model reads and understands EVERY
  // message; keywords are no longer the primary decision. Rationale (operator directive):
  // keyword-matching flails on messy/multilingual/context messages, and at Nisria's volume
  // the per-message cost of letting the model understand is negligible. SAFETY: routing is
  // the safest possible LLM use — the model picks ONE of a FIXED set of domains (validated
  // in haikuClassify against MANIFESTS, so it cannot invent a lane), and a wrong pick only
  // mis-files to a specialist that says "not my lane"; it can never act, send, or spend.
  const scored = scoreDomains(text);
  const top = scored[0];
  const second = scored[1];

  // FAST-LANE (cost/latency only): a dead-obvious, unambiguous keyword hit skips the model.
  // Requires an overwhelming top score AND a clear gap over the runner-up, so an ambiguous
  // message is NEVER fast-laned — it always goes to the model to understand.
  if (top && top.score >= 1.5 && (!second || top.score - second.score >= 0.8)) {
    const result: RouterResult = {
      domain: top.domain,
      confidence: Math.min(top.score, 1),
      reason: `fast_lane: ${top.matches} unambiguous pattern(s)`,
    };
    await emitRouterTelemetry(result.domain, result.confidence, result.reason, text);
    return result;
  }

  // The model understands the message and picks one domain.
  const llm = await haikuClassify(text, history);
  const LLM_FAILED = /^(no_api_key|haiku_error_|haiku_no_text|haiku_no_json|haiku_exception)/.test(llm.reason);
  if (!LLM_FAILED) {
    const result: RouterResult = {
      domain: llm.domain,
      confidence: llm.confidence,
      reason: `understood: ${llm.reason}`,
    };
    await emitRouterTelemetry(result.domain, result.confidence, result.reason, text);
    return result;
  }

  // SAFETY NET: the model was unreachable (no key / timeout / error). Fall back to the
  // keyword score so routing still works, never a hard dependency on the model being up.
  const fb: RouterResult = top && top.score >= 0.4
    ? { domain: top.domain, confidence: top.score * 0.7, reason: `regex_fallback (model down): ${top.matches} pattern(s)` }
    : { domain: "general", confidence: 0.3, reason: `regex_fallback_general (model down): best=${top?.domain}(${top?.score ?? 0})` };
  await emitRouterTelemetry(fb.domain, fb.confidence, fb.reason, text);
  return fb;
}

// Decompose multi-domain messages into per-domain steps.
export async function decomposeMessage(
  text: string,
): Promise<{ domain: Domain; text: string }[]> {
  const KEY = process.env.ANTHROPIC_API_KEY;
  if (!KEY) return [{ domain: "general", text }];

  const domains = Object.keys(MANIFESTS).join(", ");
  const system = `You split an operator's WhatsApp instruction into per-domain sub-instructions. Each sub-instruction handles ONE domain (${domains}). If the message is single-domain, return ONE item. Keep each step in the operator's own words.

Return JSON: {"steps": [{"domain": "...", "text": "..."}]}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: HAIKU,
        max_tokens: 300,
        system,
        messages: [{ role: "user", content: text.slice(0, 1500) }],
      }),
    });

    if (!res.ok) return [{ domain: "general", text }];

    const j: any = await res.json();
    const textBlock = (j?.content || []).find((b: any) => b?.type === "text");
    if (!textBlock?.text) return [{ domain: "general", text }];

    const jsonMatch = textBlock.text.match(/\{[^}]+\}/);
    if (!jsonMatch) return [{ domain: "general", text }];

    const parsed = JSON.parse(jsonMatch[0]);
    const steps = (parsed.steps || []).map((s: any) => ({
      domain: Object.keys(MANIFESTS).includes(s.domain) ? s.domain : "general",
      text: String(s.text || "").trim(),
    })).filter((s: any) => s.text);

    return steps.length > 0 ? steps : [{ domain: "general", text }];
  } catch {
    return [{ domain: "general", text }];
  } finally {
    clearTimeout(timeout);
  }
}
