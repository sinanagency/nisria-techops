"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTabs } from "./tabs-context";
import { generateReport, type GeneratedReport } from "../app/reports/actions";
import {
  Sliders, Sparkles, Loader2, Printer, Download, AlertTriangle, FileBarChart, Calendar, Paperclip, X,
} from "lucide-react";

function fileToImage(f: File): Promise<{ media: string; data: string }> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ media: f.type, data: String(r.result).split(",")[1] || "" });
    r.onerror = reject;
    r.readAsDataURL(f);
  });
}

// The interactive report builder (R3-5 / P11, img 170). The founder CHOOSES the
// report type, the date window, which sections appear, and the brand letterhead.
// The figures are computed server-side from real rows (lib/report-builder), so
// nothing is invented; the optional cover note is grounded in the brain. The
// generated, branded document opens in the canonical FocusTab as a LIVE preview
// (P1/P8), printable, and downloadable as a real PDF through /api/studio/pdf.

const TYPES = [
  { key: "financial_summary", label: "Financial summary", blurb: "Income vs expense, by category, the net." },
  { key: "funder_report", label: "Funder report", blurb: "Figures plus a warm cover note in Nisria's voice." },
  { key: "board_report", label: "Board report", blurb: "A plainer internal package for the board." },
  { key: "kenya_flow", label: "Givebutter to Kenya flow", blurb: "Cash withdrawn against ground spend in Kenya." },
  { key: "custom", label: "Custom", blurb: "Pick exactly the sections you want." },
];

const SECTIONS = [
  { key: "summary", label: "Income vs expense summary" },
  { key: "by_category", label: "Expenses by category" },
  { key: "kenya_flow", label: "Givebutter to Kenya flow" },
  { key: "top_expenses", label: "Largest recorded expenses" },
  { key: "narrative", label: "Cover narrative (AI, grounded)" },
];

const BRANDS = [
  { v: "nisria", l: "Nisria" },
  { v: "maisha", l: "Maisha" },
  { v: "ahadi", l: "AHADI" },
];

function defaultSections(type: string): string[] {
  switch (type) {
    case "financial_summary": return ["summary", "by_category", "top_expenses"];
    case "funder_report": return ["summary", "by_category", "kenya_flow", "narrative"];
    case "board_report": return ["summary", "by_category", "top_expenses", "narrative"];
    case "kenya_flow": return ["kenya_flow"];
    default: return ["summary"];
  }
}

// quick date-range presets so she does not type ISO by hand
function presetRange(kind: string): { from: string | null; to: string | null; label: string } {
  const now = new Date();
  const y = now.getFullYear();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  switch (kind) {
    case "ytd": return { from: `${y}-01-01`, to: iso(now), label: `Year to date ${y}` };
    case "last_year": return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: `${y - 1}` };
    case "q": {
      const q = Math.floor(now.getMonth() / 3);
      const start = new Date(y, q * 3, 1);
      return { from: iso(start), to: iso(now), label: `Q${q + 1} ${y}` };
    }
    default: return { from: null, to: null, label: "All time" };
  }
}

export default function ReportBuilder() {
  const [type, setType] = useState("financial_summary");
  const [brand, setBrand] = useState("nisria");
  const [rangeKind, setRangeKind] = useState("ytd");
  const [from, setFrom] = useState<string>(presetRange("ytd").from || "");
  const [to, setTo] = useState<string>(presetRange("ytd").to || "");
  const [sections, setSections] = useState<string[]>(defaultSections("financial_summary"));
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]); // pics the AI reads into the cover note
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const router = useRouter();
  const { openSheet, closeSheet } = useTabs();

  const periodLabel = useMemo(() => {
    if (rangeKind !== "custom") return presetRange(rangeKind).label;
    if (!from && !to) return "All time";
    return `${from || "start"} to ${to || "today"}`;
  }, [rangeKind, from, to]);

  function pickType(t: string) {
    setType(t);
    setSections(defaultSections(t));
  }
  function pickRange(kind: string) {
    setRangeKind(kind);
    if (kind !== "custom") {
      const r = presetRange(kind);
      setFrom(r.from || "");
      setTo(r.to || "");
    }
  }
  function toggleSection(key: string) {
    setSections((prev) => (prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key]));
  }

  function printResult() {
    const win = iframeRef.current?.contentWindow;
    if (win) { win.focus(); win.print(); }
  }

  async function run() {
    if (busy) return;
    if (!sections.length) { setError("Choose at least one section."); return; }
    setBusy(true);
    setError(null);
    try {
      const images: { media: string; data: string }[] = [];
      for (const f of files.slice(0, 4)) if (f.type.startsWith("image/")) images.push(await fileToImage(f));
      const res: GeneratedReport = await generateReport({
        type,
        brand,
        from: rangeKind === "all" ? null : from || null,
        to: rangeKind === "all" ? null : to || null,
        sections,
        periodLabel,
        note: note.trim() || undefined,
        images: images.length ? images : undefined,
      });
      if (res.ok && res.html) {
        openResult(res);
        router.refresh();
      } else {
        setError(res.error || "Could not build the report.");
      }
    } catch (e: any) {
      setError(e?.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  function openResult(res: GeneratedReport) {
    const id = `report-result:${res.docId || Date.now()}`;
    openSheet({
      id,
      title: (res.title || "Report").slice(0, 28),
      icon: "file",
      titleExtra: <span className="badge teal" style={{ fontSize: 10 }}>branded · ready to print</span>,
      render: () => (
        <>
          <iframe
            ref={iframeRef}
            title="Report preview"
            sandbox="allow-same-origin allow-modals"
            srcDoc={res.html}
            style={{ width: "100%", height: "66vh", border: "1px solid var(--line)", borderRadius: 10, background: "#fff" }}
          />
          <div className="faint" style={{ fontSize: 11.5, marginTop: 10 }}>
            Saved to your Library. Every figure is drawn from recorded transactions; no number is estimated.
          </div>
        </>
      ),
      footer: (
        <>
          {res.docId && <a className="btn teal sm" href={`/api/studio/pdf?id=${res.docId}`} target="_blank" rel="noopener"><Download size={13} /> Download PDF</a>}
          <button type="button" className="btn ghost sm" onClick={printResult}><Printer size={13} /> Print</button>
          <button type="button" className="btn ghost sm" onClick={() => closeSheet(id)}>Close</button>
        </>
      ),
    });
  }

  return (
    <div className="card" id="report-builder">
      <div className="card-h">
        <span className="flex"><Sliders size={15} /> Build a report</span>
        <span className="badge gold" style={{ fontSize: 10 }}>{periodLabel}</span>
      </div>
      <div className="card-pad stack" style={{ gap: 16 }}>
        <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
          Choose the report, the window, the sections, and the letterhead. The figures come from your real books, never invented. Generate to preview, print, or export a PDF.
        </div>

        {/* 1) type */}
        <div>
          <div className="report-subhead" style={{ marginBottom: 8 }}>Report type</div>
          <div className="rb-grid">
            {TYPES.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`rb-tile ${type === t.key ? "is-on" : ""}`}
                onClick={() => pickType(t.key)}
                disabled={busy}
              >
                <span className="rb-tile-t"><FileBarChart size={13} /> {t.label}</span>
                <span className="rb-tile-b">{t.blurb}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 2) date range */}
        <div>
          <div className="report-subhead" style={{ marginBottom: 8 }}><Calendar size={12} style={{ verticalAlign: -2 }} /> Date range</div>
          <div className="flex wrap" style={{ gap: 8 }}>
            {[
              { k: "ytd", l: "Year to date" },
              { k: "q", l: "This quarter" },
              { k: "last_year", l: "Last year" },
              { k: "all", l: "All time" },
              { k: "custom", l: "Custom" },
            ].map((r) => (
              <button key={r.k} type="button" className={`actionchip ${rangeKind === r.k ? "is-on" : ""}`} onClick={() => pickRange(r.k)} disabled={busy} style={{ fontSize: 11.5 }}>
                {r.l}
              </button>
            ))}
          </div>
          {rangeKind === "custom" && (
            <div className="flex" style={{ gap: 10, marginTop: 10, flexWrap: "wrap" }}>
              <label className="stack" style={{ gap: 4, fontSize: 11.5 }}>
                <span className="faint">From</span>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} disabled={busy} />
              </label>
              <label className="stack" style={{ gap: 4, fontSize: 11.5 }}>
                <span className="faint">To</span>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} disabled={busy} />
              </label>
            </div>
          )}
        </div>

        {/* 3) sections */}
        <div>
          <div className="report-subhead" style={{ marginBottom: 8 }}>Sections to include</div>
          <div className="stack" style={{ gap: 6 }}>
            {SECTIONS.map((s) => (
              <label key={s.key} className="flex" style={{ gap: 8, fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" checked={sections.includes(s.key)} onChange={() => toggleSection(s.key)} disabled={busy} />
                <span>{s.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* 4) brand + optional framing */}
        <div className="flex wrap" style={{ gap: 12, alignItems: "flex-end" }}>
          <label className="stack" style={{ gap: 4, fontSize: 11.5 }}>
            <span className="faint">Letterhead</span>
            <select value={brand} onChange={(e) => setBrand(e.target.value)} disabled={busy} style={{ width: "auto", minWidth: 120 }}>
              {BRANDS.map((b) => <option key={b.v} value={b.v}>{b.l}</option>)}
            </select>
          </label>
          <label className="stack" style={{ gap: 4, flex: 1, minWidth: 220, fontSize: 11.5 }}>
            <span className="faint">Context for the cover note (optional)</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Anything to emphasise, e.g. 'frame for the STP funder's interim review; mention the new feeding program'." disabled={busy} />
          </label>
        </div>

        {/* attach pics / receipts the AI reads into the cover note (img 213).
            Figures still come only from the books; attachments add qualitative colour. */}
        <div>
          <div className="report-subhead" style={{ marginBottom: 8 }}>Add pictures or receipts (optional)</div>
          <div className="flex wrap" style={{ gap: 8, alignItems: "center" }}>
            <label className="actionchip" style={{ fontSize: 11.5, cursor: busy ? "default" : "pointer" }}>
              <Paperclip size={12} /> Attach images
              <input type="file" accept="image/*" multiple style={{ display: "none" }} disabled={busy} onChange={(e) => { setFiles((p) => [...p, ...Array.from(e.target.files || [])].slice(0, 4)); e.target.value = ""; }} />
            </label>
            {files.map((f, i) => (
              <span key={i} className="pill" style={{ gap: 6 }}>
                {f.name.length > 22 ? f.name.slice(0, 20) + "…" : f.name}
                <button type="button" onClick={() => setFiles((p) => p.filter((_, idx) => idx !== i))} style={{ background: "none", border: 0, cursor: "pointer", display: "grid", placeItems: "center", color: "var(--muted)" }} aria-label="Remove"><X size={12} /></button>
              </span>
            ))}
            <span className="faint" style={{ fontSize: 11 }}>AI reads images into the cover note; figures still come only from your books.</span>
          </div>
        </div>

        <div className="flex" style={{ gap: 10, alignItems: "center" }}>
          <button type="button" className="btn teal" onClick={run} disabled={busy || !sections.length}>
            {busy ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
            {busy ? "Building…" : "Generate report"}
          </button>
          {error && (
            <span className="flex" style={{ gap: 6, color: "var(--danger)", fontSize: 12.5 }}>
              <AlertTriangle size={14} /> {error}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
