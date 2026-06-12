export interface ExtractTextOpts {
    /** Cap stored text so one giant file can't bloat a row (default 200,000). */
    maxChars?: number;
}
/**
 * Extract clean text from raw bytes in hand. Used by the ingest pipeline
 * so a PDF/Word/sheet is read into cheap TEXT locally instead of paying
 * for vision. Returns null when the type has no text layer.
 */
export declare function extractTextFromBuffer(buf: Buffer | Uint8Array, mime: string, opts?: ExtractTextOpts): Promise<string | null>;
//# sourceMappingURL=extract-text.d.ts.map