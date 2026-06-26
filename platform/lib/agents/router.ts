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

// Rule-based patterns derived from transcript analysis (1,755 messages).
// Order matters: more specific patterns first.
const DOMAIN_PATTERNS: { domain: Domain; patterns: RegExp[] }[] = [
  {
    domain: "work",
    patterns: [
      /\bassign\s+(?:this|that|it|the)?\s*(?:task|reminder|to\s+me|to\s+[A-Z][a-z]+)/i, // "assign this task to me: Pay X" → work, not money
      /\b(?:remind\s+me|set\s+(?:a\s+)?reminder|remind\s+(?:me\s+)?to)\b/i, // "remind me to send X at 2pm" → work, NOT comms (the "send" is the reminder body, not an outbound)
      /\badd\s+(?:this|a|the)?\s*(?:task|reminder)\b/i,
      /\b(remind|reminder|task|todo|assign|deadline|due\s+(?:on|date|time))\b/i,
      /\b(done\s+with|completed|finished|mark\s+(?:as\s+)?done|reopen)\b/i,
      /\b(open\s+tasks|pending\s+tasks|my\s+tasks|what.*task)\b/i,
      /\b(meeting|calendar|schedule|event|appointment|travel)\b/i,
      /\b(create\s+(?:a\s+)?task|add\s+(?:a\s+)?task|log\s+(?:a\s+)?task)\b/i,
      /\b(check\s+(?:conflicts|calendar)|what'?s\s+(?:on\s+)?(?:this\s+)?(?:week|month|today))\b/i,
    ],
  },
  {
    domain: "money",
    patterns: [
      /\b(paid|payment|kes|usd|ksh|\$)\s*\d/i,
      /\b(salary|rent|mpesa|receipt|invoice|budget)\b/i,
      /\b(log\s+(?:a\s+)?payment|record\s+(?:a\s+)?payment|donation|donor)\b/i,
      /\b(finance|financial|money\s+in|money\s+out|raised|campaign)\b/i,
      /\b(how\s+much|total|balance|payroll|bank\s+(?:statement|transaction))\b/i,
    ],
  },
  {
    domain: "comms",
    patterns: [
      /\b(message|send|tell|notify|ping|whatsapp|text|dm)\b[\s\S]{0,25}\bto\s+[A-Z][a-z]+/i, // "send a message to Violet"
      /\b(send|message|tell|notify|ping)\s+(?:me|them|him|her|[A-Z][a-z]+)\b/i,
      /\bsend\s+(?:a\s+|an\s+)?(?:whatsapp\s+|text\s+)?(?:message|msg|note|reply)\b/i,
      /\b(email|newsletter|thank[\s-]?you|draft)\b/i,
      /\b(post\s+to\s+(?:group|facebook|instagram)|social\s+post|publish\s+(?:the\s+)?post)\b/i,
      /\b(flag\s+to\s+nur|relay\s+to|group\s+digest|reply\s+to|inbox)\b/i,
      /\b(outbound|sent|delivered)\b/i,
    ],
  },
  {
    domain: "people",
    patterns: [
      /\b(beneficiary|child|case|intake|ob\s+number)\b/i,
      /\b(contact\s+details|phone\s+number|reach)\s+(?:for\s+)?(?:me|them|him|her|[A-Z][a-z]+)\b/i,
      /\b(team\s+member|roster|add\s+(?:a\s+)?(?:team\s+)?member|update\s+(?:team\s+)?member|activate\s+[A-Z])/i,
      /\b(who\s+is|find\s+(?:a\s+)?(?:person|contact|beneficiary)|look\s+up)\b/i,
      /\b(approve|decline|merge)\s+(?:case|beneficiary)\b/i,
    ],
  },
  {
    domain: "programs",
    patterns: [
      /\b(inventory|stock|folklore|maisha)\b/i,
      /\b(wishlist|wish\s+list|needs?\s+funded|fund(?:ed)?\s+(?:the\s+)?(?:school\s+kit|bed|laptop|fees|item))\b/i,
      /\b(school\s+kits?|sewing|fabric|garment)\b/i,
      /\b(add|list|update)\s+(?:an?\s+)?(?:inventory|wishlist)\b/i,
    ],
  },
  {
    domain: "knowledge",
    patterns: [
      /\b(document|file|pdf|upload|attach)\b/i,
      /\b(remember|note\s+that|keep\s+in\s+mind|brain|fact)\b/i,
      /\b(search\s+(?:for\s+)?(?:document|file)|find\s+(?:a\s+)?(?:document|file))\b/i,
      /\b(grant|opportunity|funder|application)\b/i,
      /\b(what\s+(?:did|do)\s+(?:we|you)\s+(?:say|discuss|agree|talk)\s+about)\b/i,
    ],
  },
];

// Score a message against all domain patterns. Returns {domain, score, matches}.
function scoreDomains(text: string): { domain: Domain; score: number; matches: number }[] {
  const results: { domain: Domain; score: number; matches: number }[] = [];

  for (const { domain, patterns } of DOMAIN_PATTERNS) {
    let score = 0;
    let matches = 0;
    for (const pattern of patterns) {
      const m = text.match(pattern);
      if (m) {
        matches++;
        // Weight by specificity: longer matches = more specific
        score += m[0].length * 0.1;
      }
    }
    results.push({ domain, score, matches });
  }

  return results.sort((a, b) => b.score - a.score);
}

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
- knowledge: documents, files, Brain facts, grants, memory, search
- programs: Maisha inventory (stock, quantities, Folklore listing) and the donor wishlist (fundable needs and funded counts)
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

  // Stage 1: Rule-based classification
  const scored = scoreDomains(text);
  const topScore = scored[0];

  // High confidence (>0.8): route direct
  if (topScore.score >= 0.8) {
    const result: RouterResult = {
      domain: topScore.domain,
      confidence: Math.min(topScore.score, 1),
      reason: `rule_match: ${topScore.matches} pattern(s) matched`,
    };
    await emitRouterTelemetry(result.domain, result.confidence, result.reason, text);
    return result;
  }

  // Medium confidence (0.4-0.8): Haiku verify
  if (topScore.score >= 0.4) {
    const haiku = await haikuClassify(text, history);
    // If Haiku agrees with rule-based, use that
    if (haiku.domain === topScore.domain && haiku.confidence >= 0.7) {
      const result: RouterResult = {
        domain: haiku.domain,
        confidence: (topScore.score + haiku.confidence) / 2,
        reason: `rule+haiku_agree: ${haiku.reason}`,
      };
      await emitRouterTelemetry(result.domain, result.confidence, result.reason, text);
      return result;
    }
    // If Haiku disagrees but has high confidence, trust Haiku
    if (haiku.confidence >= 0.8) {
      const result: RouterResult = {
        domain: haiku.domain,
        confidence: haiku.confidence,
        reason: `haiku_override: ${haiku.reason}`,
      };
      await emitRouterTelemetry(result.domain, result.confidence, result.reason, text);
      return result;
    }
    // Otherwise, use rule-based with lower confidence
    const result: RouterResult = {
      domain: topScore.domain,
      confidence: topScore.score * 0.7,
      reason: `rule_low_conf: ${topScore.matches} pattern(s), haiku_uncertain`,
    };
    await emitRouterTelemetry(result.domain, result.confidence, result.reason, text);
    return result;
  }

  // Low confidence (<0.4): Haiku classify
  const haiku = await haikuClassify(text, history);
  if (haiku.confidence >= 0.6) {
    const result: RouterResult = {
      domain: haiku.domain,
      confidence: haiku.confidence,
      reason: `haiku_only: ${haiku.reason}`,
    };
    await emitRouterTelemetry(result.domain, result.confidence, result.reason, text);
    return result;
  }

  // Fallback to general
  const result: RouterResult = {
    domain: "general",
    confidence: 0.3,
    reason: `low_confidence: best_rule=${topScore.domain}(${topScore.score}), haiku=${haiku.domain}(${haiku.confidence})`,
  };
  await emitRouterTelemetry(result.domain, result.confidence, result.reason, text);
  return result;
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
