"use client";

import { useRef } from "react";
import { useTabs } from "./tabs-context";
import { Badge } from "./ui";
import { FileText, Printer, Maximize2, Download } from "lucide-react";
import PreviewLink from "./PreviewLink";

// A saved Studio document in the recent list. Click to re-open the branded HTML
// in the canonical Focus Tab (sandboxed iframe LIVE PREVIEW — never raw code,
// P8) and print / save it again. The HTML is passed in from the server page.
function DocBody({ html, title, iframeRef }: { html: string; title: string; iframeRef: React.RefObject<HTMLIFrameElement> }) {
  return (
    <iframe
      ref={iframeRef}
      title={title}
      sandbox="allow-same-origin allow-modals"
      srcDoc={html}
      style={{ width: "100%", height: "66vh", border: "1px solid var(--line)", borderRadius: 10, background: "#fff" }}
    />
  );
}

export default function StudioDocCard({ doc }: { doc: { id: string; title: string; doc_type?: string | null; brand?: string | null; prompt?: string | null; created_at?: string | null; html: string } }) {
  const { openSheet, closeSheet } = useTabs();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const id = `doc:${doc.id}`;

  const when = doc.created_at ? new Date(doc.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";

  function printIt() {
    const win = iframeRef.current?.contentWindow;
    if (win) { win.focus(); win.print(); }
  }

  function open() {
    openSheet({
      id,
      title: doc.title.slice(0, 28),
      icon: "file",
      brand: doc.brand || undefined,
      titleExtra: doc.doc_type ? <Badge tone="teal">{doc.doc_type}</Badge> : undefined,
      render: () => <DocBody html={doc.html} title={doc.title} iframeRef={iframeRef} />,
      footer: (
        <>
          <PreviewLink href={`/api/studio/pdf?id=${doc.id}`} kind="pdf" title="Document" className="btn teal sm"><Download size={13} /> View PDF</PreviewLink>
          <button type="button" className="btn ghost sm" onClick={printIt}><Printer size={13} /> Print</button>
          <button type="button" className="btn ghost sm" onClick={() => closeSheet(id)}>Close</button>
        </>
      ),
    });
  }

  return (
    <button type="button" className="card hover card-pad" style={{ textAlign: "left", cursor: "pointer", border: 0, width: "100%", maxWidth: "100%", overflow: "hidden", font: "inherit" }} onClick={open}>
      <div className="flex" style={{ gap: 10, minWidth: 0 }}>
        <span className="aico teal" style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0 }}><FileText size={16} /></span>
        {/* clamp + break-word so a long title/prompt can never bleed past the
            card's right edge, regardless of the grid cell width. */}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="strong" style={{ fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.title}</div>
          {doc.prompt && <div className="faint" style={{ fontSize: 11.5, marginTop: 2, overflow: "hidden", wordBreak: "break-word", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{doc.prompt}</div>}
        </div>
      </div>
      <div className="flex wrap" style={{ gap: 6, marginTop: 10 }}>
        {doc.doc_type && <Badge tone="gray">{doc.doc_type}</Badge>}
        {doc.brand && <span className={`chip ${doc.brand}`}><span className="bdot" /> {doc.brand}</span>}
        {when && <span className="faint" style={{ fontSize: 11, marginLeft: "auto" }}>{when}</span>}
      </div>
      <div className="pill" style={{ marginTop: 10, width: "100%", justifyContent: "center" }}><Maximize2 size={12} /> Open</div>
    </button>
  );
}
