// Server-only Claude client for the portal's AI features (assistant, task
// dispatch, inbox auto-reply, newsletter/content drafting).
const KEY = () => process.env.ANTHROPIC_API_KEY || "";
const MODEL = "claude-sonnet-4-5";

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

type Msg = { role: "user" | "assistant"; content: string };

export async function askClaude(opts: {
  system: string;
  messages: Msg[];
  maxTokens?: number;
}): Promise<string> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": KEY(),
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: opts.maxTokens ?? 1024,
      system: opts.system,
      messages: opts.messages,
    }),
    cache: "no-store",
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || "Claude request failed");
  return j?.content?.[0]?.text ?? "";
}

// Convenience for a single-shot prompt.
export const claude = (system: string, user: string, maxTokens = 1024) =>
  askClaude({ system, messages: [{ role: "user", content: user }], maxTokens });

// Vision: caption an image for the asset library (also flags possible beneficiary photos).
export async function captionImage(base64: string, mediaType: string): Promise<string> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": KEY(), "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 220,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
        { type: "text", text: "In 1-2 sentences, describe this image for a nonprofit's asset library: what it shows, the mood, and any visible text or logos. If it appears to show identifiable children or beneficiaries, start with 'BENEFICIARY:'." },
      ] }],
    }),
    cache: "no-store",
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || "vision failed");
  return j?.content?.[0]?.text ?? "";
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
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": KEY(), "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: opts.maxTokens ?? 1500, system: opts.system, messages: [{ role: "user", content }] }),
    cache: "no-store",
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || "Claude vision request failed");
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
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": KEY(), "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, messages: [{ role: "user", content: [block, { type: "text", text: prompt }] }] }),
    cache: "no-store",
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || "media read failed");
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
export async function claudeJSON<T = any>(system: string, user: string, maxTokens = 1500): Promise<T | null> {
  const raw = await claude(system + "\n\nRespond with ONLY valid JSON, no prose, no code fences.", user, maxTokens);
  try {
    const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}
