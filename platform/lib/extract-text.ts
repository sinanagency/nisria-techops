// Local text extraction from binary documents. Thin Nisria adapter over
// @sinanagency/intake's extractTextFromBuffer. The universal extractors
// (unpdf / mammoth / SheetJS / utf-8 decode) and the maxChars cap +
// whitespace cleanup live in intake. This file holds Nisria's Drive
// integration (extractText by fileId).

import { fetchFileText, fetchFileBytes } from "./drive";
import { extractTextFromBuffer as intakeExtract } from "./intake/index.js";

// Pull readable text out of a Drive document so it can live NATIVELY in the
// app (read + searched in-platform, never a link-out). Google-native files
// export to text directly; everything else delegates to intake's extractor.
// Returns clean text or null when a type can't be parsed. Never throws.
export async function extractText(fileId: string, mime: string): Promise<string | null> {
  try {
    // 1) Google-native: straight text/CSV export
    const native = await fetchFileText(fileId, mime);
    if (native != null) return clean(native);

    // 2) binary types: download bytes, delegate to intake
    const { buf } = await fetchFileBytes(fileId, mime);
    return await intakeExtract(buf, mime);
  } catch {
    return null;
  }
}

// Re-export intake's extractor directly. The ingest pipeline (lib/ingest.ts)
// uses this for WhatsApp attachments and uploaded files — raw bytes in hand,
// no Drive round-trip needed.
export { extractTextFromBuffer } from "./intake/index.js";

function clean(s: string): string {
  const MAX = 200_000;
  const t = (s || "").replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return t.length > MAX ? t.slice(0, MAX) + "\n\n[…truncated]" : t;
}
