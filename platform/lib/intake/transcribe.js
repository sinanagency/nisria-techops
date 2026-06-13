// Voice-note transcription via OpenAI gpt-4o-transcribe.
//
// Pure function. Takes audio bytes + mime + an OpenAI key, returns the
// transcript text. Empty on any failure or missing key — caller degrades.
//
// Why cloud (OpenAI) and not local (DGX): WhatsApp voice notes are short
// (~5-30s), arrive sporadically, and require near-realtime turnaround.
// Cloud transcription gives strong English + Swahili code-switching out of
// the box, no GPU plumbing required. Adapters that want a local model swap
// the function via the `transcriber` slot in their intake config.
// Map a WhatsApp audio mime to a filename extension OpenAI accepts.
// WhatsApp voice notes are audio/ogg (opus); other clients may send mp3/m4a/wav.
function extFor(mime) {
    const m = (mime || "").toLowerCase();
    if (m.includes("ogg") || m.includes("opus"))
        return "ogg";
    if (m.includes("mpeg") || m.includes("mp3"))
        return "mp3";
    if (m.includes("wav"))
        return "wav";
    if (m.includes("m4a") || m.includes("mp4") || m.includes("aac"))
        return "m4a";
    if (m.includes("webm"))
        return "webm";
    return "ogg";
}
/**
 * Transcribe an audio buffer (base64) to text.
 * Returns "" if no key or on any failure (graceful — caller degrades).
 * Throws nothing.
 */
export async function transcribeAudio(base64, mime, opts) {
    if (!opts.openaiKey || !base64)
        return "";
    try {
        const buf = Buffer.from(base64, "base64");
        const form = new FormData();
        form.append("file", new Blob([buf], { type: mime || "audio/ogg" }), `audio.${extFor(mime)}`);
        form.append("model", opts.model || "gpt-4o-transcribe");
        const base = (opts.baseUrl || "https://api.openai.com").replace(/\/+$/, "");
        const r = await fetch(`${base}/v1/audio/transcriptions`, {
            method: "POST",
            headers: { Authorization: `Bearer ${opts.openaiKey}` },
            body: form,
            cache: "no-store",
        });
        const j = await r.json();
        if (!r.ok)
            return "";
        return (j?.text || "").trim();
    }
    catch {
        return "";
    }
}
//# sourceMappingURL=transcribe.js.map