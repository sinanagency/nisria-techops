export interface CaptionImageOpts {
    /** Anthropic API key. */
    anthropicKey: string;
    /** Model id (default: claude-haiku-4-5-20251001 for cost). */
    model?: string;
    /** Caption prompt. Default is a generic 1-2 sentence asset-library caption. */
    prompt?: string;
    /** Max output tokens (default 220). */
    maxTokens?: number;
}
/**
 * Caption a base64 image. Returns "" on missing key, failure, or non-2xx.
 * Throws nothing.
 */
export declare function captionImage(base64: string, mediaType: string, opts: CaptionImageOpts): Promise<string>;
//# sourceMappingURL=caption-image.d.ts.map