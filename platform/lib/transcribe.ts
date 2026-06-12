// Voice-note transcription. Thin Nisria adapter over @sinanagency/intake's
// transcribeAudio primitive. The universal logic (FormData shape, mime-to-ext
// mapping, graceful empty-string fallback) lives in intake. This file holds
// the Nisria-specific policy: read the key from env.
//
// Why hosted OpenAI and not the DGX: WhatsApp voice notes are short, arrive
// sporadically, and need near-realtime turnaround. Cloud transcription is
// strong on English + Swahili code-switching out of the box. The DGX is for
// long-context model evals, not voice.

import { transcribeAudio as intakeTranscribeAudio } from "./intake/index.js";

const KEY = () => process.env.OPENAI_API_KEY || "";

export async function transcribeAudio(base64: string, mime: string): Promise<string> {
  return intakeTranscribeAudio(base64, mime, { openaiKey: KEY() });
}
