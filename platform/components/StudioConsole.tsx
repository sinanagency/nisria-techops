"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "./Modal";
import { generateDocument, type StudioResult } from "../app/studio/actions";
import { Sparkles, UploadCloud, FileText, X, Loader2, Printer, AlertTriangle, Wand2 } from "lucide-react";

// The Studio intake (FEEDBACK #1): drop screenshots / files + type what document
// you need. Submits to the server action, which uploads inputs, runs Claude
// (vision for images, text for the prompt), and returns branded printable HTML.
// The result opens in a centered modal previewed in a sandboxed iframe, with a
// Print / Save-as-PDF action. Everything is saved to the Library server-side.

const BRANDS = [
  { v: "nisria", l: "Nisria" },
  { v: "maisha", l: "Maisha" },
  { v: "ahadi", l: "AHADI" },
];

const EXAMPLES = [
  "A budget cover letter for the STP funder",
  "A thank-you certificate for a major donor",
  "An interim report summary from these screenshots",
  "A board memo on this quarter's Kenya spend",
];

export default function StudioConsole() {
  const [drag, setDrag] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [prompt, setPrompt] = useState("");
  const [brand, setBrand] = useState("nisria");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StudioResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const router = useRouter();

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)].slice(0, 8));
  }
  function removeFile(i: number) {
    setFiles((prev) => prev.filter((_, idx) => idx !== i));
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDrag(false);
    addFiles(e.dataTransfer.files);
  }

  async function run() {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("prompt", prompt.trim());
      fd.append("brand", brand);
      for (const f of files) fd.append("file", f);
      const res = await generateDocument(fd);
      if (res.ok && res.html) {
        setResult(res);
        if (res.error) setError(res.error); // non-fatal save note
        setFiles([]);
        router.refresh();
      } else {
        setError(res.error || "The Studio could not assemble that document.");
      }
    } catch (e: any) {
      setError(e?.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  function printResult() {
    const win = iframeRef.current?.contentWindow;
    if (win) { win.focus(); win.print(); }
  }

  return (
    <>
      <div
        className={`studio-intake ${drag ? "drag" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
      >
        {drag && <div className="drop-hint"><UploadCloud size={26} /> Drop the inputs — the Studio reads them</div>}

        <div className="flex" style={{ gap: 11, marginBottom: 14 }}>
          <span className="aico teal" style={{ width: 40, height: 40, borderRadius: 12 }}><Wand2 size={19} /></span>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 17, letterSpacing: "-0.01em" }}>
              What document do you need?
            </div>
            <div className="muted" style={{ fontSize: 12.5 }}>
              Drop screenshots, receipts or notes, then describe it. The Studio assembles a branded, printable document grounded in Nisria&apos;s history.
            </div>
          </div>
        </div>

        <div className="studio-grid">
          {/* drop / click inputs */}
          <label htmlFor="studio-file" className="intake-drop" onClick={(e) => { if (busy) e.preventDefault(); }}>
            <div className="intake-ico peri"><UploadCloud size={20} /></div>
            <div className="intake-t">Drop or click inputs</div>
            <div className="faint" style={{ fontSize: 11.5 }}>Screenshots, photos, PDFs. Images are read by AI. Optional.</div>
          </label>
          <input
            ref={fileRef}
            id="studio-file"
            type="file"
            multiple
            style={{ display: "none" }}
            disabled={busy}
            onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
          />

          {/* prompt */}
          <div className="studio-prompt">
            <textarea
              value={prompt}
              placeholder="Describe the document, e.g. ‘a budget cover letter for the STP funder using these screenshots’"
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run(); } }}
              rows={3}
              disabled={busy}
            />
            <div className="flex" style={{ gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
              <select value={brand} onChange={(e) => setBrand(e.target.value)} disabled={busy} style={{ maxWidth: 130 }}>
                {BRANDS.map((b) => <option key={b.v} value={b.v}>{b.l} letterhead</option>)}
              </select>
              <button type="button" className="btn teal sm" onClick={run} disabled={busy || !prompt.trim()}>
                {busy ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
                {busy ? "Assembling…" : "Create document"}
              </button>
              <span className="faint" style={{ fontSize: 11 }}>⌘↵ to run</span>
            </div>
          </div>
        </div>

        {/* dropped inputs */}
        {files.length > 0 && (
          <div className="flex wrap" style={{ gap: 8, marginTop: 12 }}>
            {files.map((f, i) => (
              <span key={i} className="pill" style={{ gap: 6 }}>
                <FileText size={12} /> {f.name.length > 26 ? f.name.slice(0, 24) + "…" : f.name}
                <button type="button" onClick={() => removeFile(i)} style={{ background: "none", border: 0, cursor: "pointer", display: "grid", placeItems: "center", color: "var(--muted)" }} aria-label="Remove"><X size={12} /></button>
              </span>
            ))}
          </div>
        )}

        {/* example chips */}
        <div className="flex wrap" style={{ gap: 8, marginTop: 14 }}>
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" className="actionchip" disabled={busy} onClick={() => setPrompt(ex)} style={{ fontSize: 11.5 }}>
              {ex}
            </button>
          ))}
        </div>

        {error && !result && (
          <div className="flex" style={{ gap: 8, marginTop: 12, color: "var(--danger)", fontSize: 12.5 }}>
            <AlertTriangle size={14} /> {error}
          </div>
        )}
      </div>

      {/* RESULT — centered modal, sandboxed iframe preview, print to PDF */}
      <Modal
        open={!!result}
        onClose={() => setResult(null)}
        width={860}
        title={<div className="flex wrap"><h3 style={{ fontSize: 18 }}>{result?.title || "Document"}</h3><span className="badge teal" style={{ fontSize: 10 }}>branded · ready to print</span></div>}
        footer={
          <>
            <button type="button" className="btn teal sm" onClick={printResult}><Printer size={13} /> Print / Save as PDF</button>
            <button type="button" className="btn ghost sm" onClick={() => setResult(null)}>Close</button>
          </>
        }
      >
        {error && (
          <div className="flex" style={{ gap: 8, marginBottom: 10, color: "var(--warning)", fontSize: 12 }}>
            <AlertTriangle size={14} /> {error}
          </div>
        )}
        {result?.html && (
          <iframe
            ref={iframeRef}
            title="Studio document preview"
            sandbox="allow-same-origin allow-modals"
            srcDoc={result.html}
            style={{ width: "100%", height: "62vh", border: "1px solid var(--line)", borderRadius: 10, background: "#fff" }}
          />
        )}
        <div className="faint" style={{ fontSize: 11.5, marginTop: 10 }}>
          Saved to your Library. Print / Save as PDF uses your browser; server-side PDF (headless Chrome) is the next step.
        </div>
      </Modal>
    </>
  );
}
