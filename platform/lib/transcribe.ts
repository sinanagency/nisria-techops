// Voice-note transcription. Thin Nisria adapter over @sinanagency/intake's
// transcribeAudio primitive. The universal logic (FormData shape, mime-to-ext
// mapping, graceful empty-string fallback) lives in intake. This file holds
// the Nisria-specific policy: read the key from env, and (new) honor the
// primary-with-fallback contract for cloud-replaced services.
//
// Why hosted OpenAI as the safety net: WhatsApp voice notes are short, arrive
// sporadically, and need near-realtime turnaround. Cloud transcription is
// strong on English + Swahili code-switching out of the box. The primary
// path (TRANSCRIBE_PRIMARY_URL) when set points at an OpenAI-wire-compatible
// local server (typically faster-whisper on the DGX) to kill the OpenAI
// bill on the happy path while keeping OpenAI as the deterministic fallback
// for when local infra hiccups.
//
// Signature preserved (base64 in, Promise<string> out — empty string on
// failure, matching intake's graceful contract).

import { transcribeAudio as intakeTranscribeAudio } from "./intake/index.js";

const KEY = () => process.env.OPENAI_API_KEY || "";
const PRIMARY_TIMEOUT_MS = 5000;

interface RaceResult {
  text: string;
  timedOut: boolean;
}

async function withTimeout(p: Promise<string>, ms: number): Promise<RaceResult> {
  let timeoutId: NodeJS.Timeout | undefined;
  const timeout = new Promise<RaceResult>((resolve) => {
    timeoutId = setTimeout(() => resolve({ text: "", timedOut: true }), ms);
  });
  const main = p.then((text) => ({ text, timedOut: false }));
  try {
    return await Promise.race([main, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function transcribeAudio(base64: string, mime: string): Promise<string> {
  const key = KEY();
  if (!key) return "";
  const safeMime = mime || "audio/ogg";
  const primaryUrl = (process.env.TRANSCRIBE_PRIMARY_URL || "").trim();

  // Primary path: only attempted when an env URL is configured.
  if (primaryUrl) {
    const t0 = Date.now();
    const { text, timedOut } = await withTimeout(
      intakeTranscribeAudio(base64, safeMime, { openaiKey: key, baseUrl: primaryUrl }),
      PRIMARY_TIMEOUT_MS
    );
    const elapsed = Date.now() - t0;
    const trimmed = (text || "").trim();
    if (trimmed && !timedOut) {
      console.info(JSON.stringify({
        kind: "transcribe",
        path: "primary",
        elapsed_ms: elapsed,
        ok: true,
      }));
      return trimmed;
    }
    console.info(JSON.stringify({
      kind: "transcribe",
      path: "primary",
      elapsed_ms: elapsed,
      ok: false,
      reason: timedOut ? "timeout" : "empty_or_error",
    }));
    // fall through
  }

  // Fallback (also the default when no primary URL is set): hosted OpenAI.
  const t1 = Date.now();
  const out = await intakeTranscribeAudio(base64, safeMime, { openaiKey: key });
  const elapsedF = Date.now() - t1;
  console.info(JSON.stringify({
    kind: "transcribe",
    path: primaryUrl ? "fallback" : "openai",
    elapsed_ms: elapsedF,
    ok: !!(out || "").trim(),
  }));
  return out || "";
}
