export interface TranscribeOpts {
    /** OpenAI API key. Adapter supplies; intake never reads env. */
    openaiKey: string;
    /** Override the default model. */
    model?: string;
    /**
     * Override the OpenAI-compatible API origin. Defaults to
     * `https://api.openai.com`. Useful for pointing at a local
     * whisper / faster-whisper server that speaks the same wire
     * shape (`POST /v1/audio/transcriptions`, multipart form,
     * `{ text: "..." }` JSON response). Adapters with this slot
     * keep the OpenAI bill on the deterministic fallback path.
     */
    baseUrl?: string;
}
/**
 * Transcribe an audio buffer (base64) to text.
 * Returns "" if no key or on any failure (graceful — caller degrades).
 * Throws nothing.
 */
export declare function transcribeAudio(base64: string, mime: string, opts: TranscribeOpts): Promise<string>;
//# sourceMappingURL=transcribe.d.ts.map