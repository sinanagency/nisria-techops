export interface TranscribeOpts {
    /** OpenAI API key. Adapter supplies; intake never reads env. */
    openaiKey: string;
    /** Override the default model. */
    model?: string;
}
/**
 * Transcribe an audio buffer (base64) to text.
 * Returns "" if no key or on any failure (graceful — caller degrades).
 * Throws nothing.
 */
export declare function transcribeAudio(base64: string, mime: string, opts: TranscribeOpts): Promise<string>;
//# sourceMappingURL=transcribe.d.ts.map