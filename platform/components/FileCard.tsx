"use client";

import { useTabs } from "./tabs-context";
import { Badge } from "./ui";
import { FileText, Maximize2, ExternalLink, Download, Sparkles } from "lucide-react";

const TYPE_LABEL: Record<string, string> = {
  bank_statement: "Bank statement", invoice: "Invoice", receipt: "Receipt",
  contract: "Contract", budget: "Budget", expenses: "Expenses", registration: "Registration",
  policy: "Policy", grant: "Grant", report: "Report", database: "Database",
  spreadsheet: "Spreadsheet", presentation: "Deck", document: "Document",
};

function when(v?: string | null) {
  if (!v) return "";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// One card per filed document. Clicking opens the file IN-APP in the centered
// FocusTab (streamed from Drive via the session-gated proxy), never a bounce out.
export default function FileCard({ doc }: { doc: any }) {
  const { openSheet, closeSheet } = useTabs();
  const id = `doc:${doc.drive_file_id}`;
  const src = `/api/filing/file/${doc.drive_file_id}`;
  const renderable = (doc.mime || "").includes("pdf") || (doc.mime || "").startsWith("application/vnd.google-apps");

  function open() {
    openSheet({
      id,
      title: String(doc.title || "Document").slice(0, 48),
      icon: "file",
      brand: doc.brand || undefined,
      width: 1040,
      titleExtra: <Badge tone="gray">{TYPE_LABEL[doc.doc_type] || doc.doc_type || "Document"}</Badge>,
      render: () => (
        <>
          {doc.summary && (
            <div className="card" style={{ padding: 14, marginBottom: 14, background: "var(--surface-2)", boxShadow: "none" }}>
              <div className="flex" style={{ gap: 8, marginBottom: 6 }}><Sparkles size={14} color="var(--teal-700)" /><span className="strong" style={{ fontSize: 13 }}>Summary</span></div>
              <div style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--ink-2)", whiteSpace: "pre-wrap" }}>{doc.summary}</div>
            </div>
          )}
          {renderable ? (
          <iframe
            src={src}
            title={doc.title}
            style={{ width: "100%", height: doc.summary ? "60vh" : "74vh", border: "1px solid var(--line)", borderRadius: 10, background: "#fff" }}
          />
        ) : (
          <div className="empty" style={{ padding: 32 }}>
            <FileText size={26} color="var(--faint)" />
            <div style={{ marginTop: 8 }}>{doc.title}</div>
            <div className="faint" style={{ fontSize: 12.5, marginTop: 4 }}>
              This file type ({doc.mime}) opens best as a download.
            </div>
            <a className="btn sm teal" href={src} target="_blank" rel="noopener" style={{ marginTop: 12 }}><Download size={13} /> Open / download</a>
          </div>
        )}
        </>
      ),
      footer: (
        <>
          <a className="btn sm ghost" href={src} target="_blank" rel="noopener"><ExternalLink size={13} /> Open in new tab</a>
          <a className="btn sm ghost" href={doc.drive_url} target="_blank" rel="noreferrer">View in Drive</a>
          <button type="button" className="btn sm ghost" onClick={() => closeSheet(id)}>Close</button>
        </>
      ),
    });
  }

  return (
    <button type="button" className="card hover card-pad" onClick={open} style={{ textAlign: "left", border: 0, width: "100%", maxWidth: "100%", overflow: "hidden", font: "inherit", cursor: "pointer" }}>
      <div className="flex" style={{ gap: 10, minWidth: 0 }}>
        <span className="aico teal" style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0 }}><FileText size={16} /></span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="strong" style={{ fontSize: 13.5, overflow: "hidden", wordBreak: "break-word", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{doc.title}</div>
          {doc.subfolder && <div className="faint" style={{ fontSize: 11.5, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.subfolder}</div>}
          {doc.summary && <div className="muted" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.5, overflow: "hidden", wordBreak: "break-word", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>{doc.summary}</div>}
        </div>
      </div>
      <div className="flex wrap" style={{ gap: 6, marginTop: 10 }}>
        <Badge tone="gray">{TYPE_LABEL[doc.doc_type] || doc.doc_type || "Document"}</Badge>
        {doc.brand && <span className={`chip ${doc.brand}`}><span className="bdot" /> {doc.brand}</span>}
        {when(doc.modified_at) && <span className="faint" style={{ fontSize: 11, marginLeft: "auto" }}>{when(doc.modified_at)}</span>}
      </div>
      <div className="pill" style={{ marginTop: 10, width: "100%", justifyContent: "center" }}><Maximize2 size={12} /> Open</div>
    </button>
  );
}
