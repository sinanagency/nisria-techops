// Server-only Claude client for the portal's AI features (assistant, task
// dispatch, inbox auto-reply, newsletter/content drafting).
const KEY = () => process.env.ANTHROPIC_API_KEY || "";
const MODEL = "claude-sonnet-4-5";
// Cheap, fast model for simple structured work (intake classification/routing).
// Sits on a SEPARATE rate-limit pool from Sonnet, so bulk document processing
// never starves the live Sasa bot of Sonnet tokens. Pass as the `model` arg.
export const HAIKU = "claude-haiku-4-5-20251001";

// BRAND VOICE / OUTPUT CONTRACT (R3-2 / P3). The single AI-output contract now
// lives in lib/humanize.ts: ONE cleaner (humanize) every generated string passes
// through, plus the SYSTEM_HUMAN clause appended to every drafting prompt. This
// file re-exports the pieces for back-compat so existing call sites keep working.
//
//  - NO_DASHES: legacy dash-only note. New prompts use SYSTEM_HUMAN (which bans
//    dashes, placeholders, AI self-reference, and stale dates in one clause).
//  - stripDashes(): re-exported from humanize so there is exactly one cleaner.
export { SYSTEM_HUMAN, withHumanSystem, humanize, stripDashes } from "./humanize";
export const NO_DASHES =
  "Never use em-dashes (—) or en-dashes (–). Use a comma, period, or colon instead. This is a hard brand rule.";

// OpenAI fallback import removed (owner directive 2026-06-04): no gpt-4o failover.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

// Single hardened POST to the Messages API. A 429 (rate limit) or 529 (overloaded)
// is transient, so we respect the retry-after header (or back off exponentially)
// and retry: a momentary input-tokens-per-minute spike becomes a short pause, not
// a thrown error. Any other non-2xx is a real failure, surfaced immediately. Every
// Claude call in this file routes through here, so the whole app (assistant,
// captioning, media reads, JSON intakes) shares one resilient path against the limit.
async function anthropicPOST(payload: Record<string, any>): Promise<any> {
  const body = JSON.stringify(payload);
  let lastErr = "Claude request failed";
  let claudeFailed = false;
  const startedAt = Date.now();
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: { "x-api-key": KEY(), "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body,
        cache: "no-store",
      });
      if (r.ok) {
        const data = await r.json();
        // Fire-and-forget Langfuse trace. Best-effort.
        try {
          const { traceLLM } = await import("./langfuse-trace");
          traceLLM({
            name: "sasa.anthropicPOST",
            model: payload?.model || "claude",
            input: { messages: payload?.messages, system: typeof payload?.system === "string" ? payload.system.slice(0, 500) : "complex" },
            output: typeof data?.content?.[0]?.text === "string" ? data.content[0].text : JSON.stringify(data?.content || ""),
            startedAt,
            endedAt: Date.now(),
            usage: { input: data?.usage?.input_tokens, output: data?.usage?.output_tokens },
            metadata: { attempt },
          });
        } catch { /* never block */ }
        return data;
      }
      const j = await r.json().catch(() => ({} as any));
      lastErr = j?.error?.message || `Claude request failed (${r.status})`;
      if (r.status !== 429 && r.status !== 529) { claudeFailed = true; break; }
      if (attempt === 3) { claudeFailed = true; break; }
      const retryAfter = Number(r.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 30000)
        : Math.min(1500 * 2 ** attempt, 12000); // 1.5s, 3s, 6s, 12s
      await sleep(waitMs);
    }
  } catch (e: any) {
    lastErr = e?.message || "Claude network error";
    claudeFailed = true;
  }

  // OpenAI (gpt-4o) failover DISABLED — owner directive 2026-06-04. Never silently
  // answer as gpt-4o (it over-refuses and stalls). Surface the real Claude error so
  // it is visible and fixable. Permanent key = the rinq Anthropic key.
  void claudeFailed;
  throw new Error(lastErr);
}

type Msg = { role: "user" | "assistant"; content: string };

export async function askClaude(opts: {
  system: string;
  messages: Msg[];
  maxTokens?: number;
  model?: string;
}): Promise<string> {
  const j = await anthropicPOST({
    model: opts.model || MODEL,
    max_tokens: opts.maxTokens ?? 1024,
    system: opts.system,
    messages: opts.messages,
  });
  return j?.content?.[0]?.text ?? "";
}

// Convenience for a single-shot prompt.
export const claude = (system: string, user: string, maxTokens = 1024, model?: string) =>
  askClaude({ system, messages: [{ role: "user", content: user }], maxTokens, model });

// Vision: caption an image for the asset library (also flags possible
// beneficiary photos). Thin Nisria adapter over @sinanagency/intake's
// captionImage. Nisria policy: use the same Anthropic key as the brain,
// keep the beneficiary-flagging prompt (PII signal for the auto-filer).
import { captionImage as intakeCaptionImage } from "./intake/index.js";
const NISRIA_CAPTION_PROMPT =
  "In 1-2 sentences, describe this image for a nonprofit's asset library: what it shows, the mood, and any visible text or logos. If it appears to show identifiable children or beneficiaries, start with 'BENEFICIARY:'.";
export async function captionImage(base64: string, mediaType: string, model?: string): Promise<string> {
  return intakeCaptionImage(base64, mediaType, {
    anthropicKey: KEY(),
    model: model || MODEL,
    prompt: NISRIA_CAPTION_PROMPT,
  });
}

// Multimodal one-shot: a text prompt plus optional images, returning text. Used
// by the report/invoice "give the AI the info" intakes so a photo of a receipt
// or a typed brief can populate a form or a cover note. Reuses the same direct
// Anthropic call the Studio uses (lib/anthropic stays the single Claude client).
export async function askClaudeVision(opts: {
  system: string;
  text: string;
  images?: { media: string; data: string }[];
  maxTokens?: number;
}): Promise<string> {
  const content: any[] = [];
  for (const img of opts.images || []) {
    content.push({ type: "image", source: { type: "base64", media_type: img.media, data: img.data } });
  }
  content.push({ type: "text", text: opts.text });
  const j = await anthropicPOST({ model: MODEL, max_tokens: opts.maxTokens ?? 1500, system: opts.system, messages: [{ role: "user", content }] });
  return j?.content?.[0]?.text ?? "";
}

// Read an inbound WhatsApp attachment (image OR pdf) and return extracted text.
// Images go in as an image block, PDFs as a document block. Turns a screenshot of
// an M-Pesa/bank payment, a receipt photo, or a PDF statement into text the agent
// can then record. Returns "" on unsupported mime (audio/video/sheets), so the
// caller can fall back gracefully.
export async function readMedia(base64: string, mime: string, prompt: string, maxTokens = 1200): Promise<string> {
  let block: any;
  if (mime.startsWith("image/")) {
    block = { type: "image", source: { type: "base64", media_type: mime, data: base64 } };
  } else if (mime === "application/pdf") {
    block = { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } };
  } else {
    return "";
  }
  const j = await anthropicPOST({ model: MODEL, max_tokens: maxTokens, messages: [{ role: "user", content: [block, { type: "text", text: prompt }] }] });
  return j?.content?.[0]?.text ?? "";
}

// Like claudeJSON, but multimodal (text + images). Strips fences, parses, null on fail.
export async function claudeVisionJSON<T = any>(system: string, text: string, images: { media: string; data: string }[] = [], maxTokens = 1500): Promise<T | null> {
  const raw = await askClaudeVision({ system: system + "\n\nRespond with ONLY valid JSON, no prose, no code fences.", text, images, maxTokens });
  try {
    const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

// Ask Claude for JSON; strips code fences and parses. Returns null on failure.
export async function claudeJSON<T = any>(system: string, user: string, maxTokens = 1500, model?: string): Promise<T | null> {
  const raw = await claude(system + "\n\nRespond with ONLY valid JSON, no prose, no code fences.", user, maxTokens, model);
  try {
    const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}
