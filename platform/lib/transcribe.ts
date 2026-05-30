// Voice-note transcription (OpenAI). Kenyan staff and Nur talk more than they
// type, so a WhatsApp voice note has to become text the bot can act on. We use
// OpenAI's transcription (gpt-4o-transcribe) on purpose: it is cloud, fast, and
// strong on English + Swahili code-switching. This project NEVER touches the DGX,
// so transcription is intentionally a hosted call, not a local model.
const KEY = () => process.env.OPENAI_API_KEY || "";

// Map a WhatsApp audio mime to a filename extension OpenAI accepts. WhatsApp
// voice notes are audio/ogg (opus); other clients may send mp3/m4a/wav.
function extFor(mime: string): string {
  const m = (mime || "").toLowerCase();
  if (m.includes("ogg") || m.includes("opus")) return "ogg";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav")) return "wav";
  if (m.includes("m4a") || m.includes("mp4") || m.includes("aac")) return "m4a";
  if (m.includes("webm")) return "webm";
  return "ogg";
}

// Transcribe an audio buffer (base64) to text. Returns "" if no key or on failure
// (the caller degrades to a graceful nudge). Throws nothing.
export async function transcribeAudio(base64: string, mime: string): Promise<string> {
  if (!KEY() || !base64) return "";
  try {
    const buf = Buffer.from(base64, "base64");
    const form = new FormData();
    form.append("file", new Blob([buf], { type: mime || "audio/ogg" }), `audio.${extFor(mime)}`);
    form.append("model", "gpt-4o-transcribe");
    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY()}` },
      body: form,
      cache: "no-store",
    });
    const j = await r.json();
    if (!r.ok) return "";
    return (j?.text || "").trim();
  } catch {
    return "";
  }
}
