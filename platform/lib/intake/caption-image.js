// Image captioning via Anthropic Claude Vision (default: Haiku for cost).
//
// Pure function. Takes image bytes (base64) + mime + an Anthropic key,
// returns a short text caption. Empty on any failure — caller degrades.
//
// The prompt is customizable so each Adapter can tune for its surface:
// Sasa flags possible beneficiary photos with "BENEFICIARY:" prefix; CTH
// might ask for "vendor stall layout"; Jensen for "venue / event detail."
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_PROMPT = "In 1-2 sentences, describe this image: what it shows, the mood, and any visible text or logos.";
/**
 * Caption a base64 image. Returns "" on missing key, failure, or non-2xx.
 * Throws nothing.
 */
export async function captionImage(base64, mediaType, opts) {
    if (!opts.anthropicKey || !base64)
        return "";
    try {
        const r = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "x-api-key": opts.anthropicKey,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            body: JSON.stringify({
                model: opts.model || DEFAULT_MODEL,
                max_tokens: opts.maxTokens ?? 220,
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
                            { type: "text", text: opts.prompt || DEFAULT_PROMPT },
                        ],
                    },
                ],
            }),
            cache: "no-store",
        });
        if (!r.ok)
            return "";
        const j = await r.json();
        return j?.content?.[0]?.text ?? "";
    }
    catch {
        return "";
    }
}
//# sourceMappingURL=caption-image.js.map