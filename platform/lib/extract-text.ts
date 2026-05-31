import { fetchFileText, fetchFileBytes } from "./drive";

// Pull readable text out of a Drive document so it can live NATIVELY in the app
// (read + searched in-platform, never a link-out). Google-native files export to
// text directly; PDFs go through unpdf; Word through mammoth; spreadsheets through
// SheetJS. Returns clean text or null when a type can't be parsed. Never throws.
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX = 200_000; // cap stored text so one giant file can't bloat a row

export async function extractText(fileId: string, mime: string): Promise<string | null> {
  try {
    // 1) Google-native: straight text/CSV export
    const native = await fetchFileText(fileId, mime);
    if (native != null) return clean(native);

    // 2) binary types: download bytes, parse by kind
    if (mime === "application/pdf") {
      const { buf } = await fetchFileBytes(fileId, mime);
      const { extractText: ex, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const { text } = await ex(pdf, { mergePages: true });
      return clean(Array.isArray(text) ? text.join("\n") : text);
    }
    if (mime === DOCX || mime === "application/msword") {
      const { buf } = await fetchFileBytes(fileId, mime);
      const mammoth = (await import("mammoth")).default || (await import("mammoth"));
      const { value } = await (mammoth as any).extractRawText({ buffer: buf });
      return clean(value);
    }
    if (mime === XLSX_MIME || mime === "text/csv") {
      const { buf } = await fetchFileBytes(fileId, mime);
      const XLSX = await import("xlsx");
      const wb = XLSX.read(buf, { type: "buffer" });
      const txt = wb.SheetNames.map((n) => `# ${n}\n` + XLSX.utils.sheet_to_csv(wb.Sheets[n])).join("\n\n");
      return clean(txt);
    }
    return null; // images / postscript / pages / shortcuts: nothing to read
  } catch (e) {
    return null;
  }
}

// Same parsers, but from RAW BYTES already in hand (a WhatsApp attachment, an
// uploaded file), not a Drive fileId. Used by the ingest pipeline so a PDF/Word/
// sheet is read into cheap TEXT locally (free) instead of paying Claude vision.
// Returns clean text, or null when the type has no text layer (images, scans).
export async function extractTextFromBuffer(buf: Buffer | Uint8Array, mime: string): Promise<string | null> {
  try {
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    if (mime === "application/pdf") {
      const { extractText: ex, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(b));
      const { text } = await ex(pdf, { mergePages: true });
      return clean(Array.isArray(text) ? text.join("\n") : text);
    }
    if (mime === DOCX || mime === "application/msword") {
      const mammoth = (await import("mammoth")).default || (await import("mammoth"));
      const { value } = await (mammoth as any).extractRawText({ buffer: b });
      return clean(value);
    }
    if (mime === XLSX_MIME || mime === "application/vnd.ms-excel" || mime === "text/csv") {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(b, { type: "buffer" });
      const txt = wb.SheetNames.map((n) => `# ${n}\n` + XLSX.utils.sheet_to_csv(wb.Sheets[n])).join("\n\n");
      return clean(txt);
    }
    if (mime.startsWith("text/") || mime === "application/json") {
      return clean(b.toString("utf8"));
    }
    return null; // images / scans / unsupported: no text layer to read
  } catch {
    return null;
  }
}

function clean(s: string): string {
  const t = (s || "").replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return t.length > MAX ? t.slice(0, MAX) + "\n\n[…truncated]" : t;
}
