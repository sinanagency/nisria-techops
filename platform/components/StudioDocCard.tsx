"use client";

import { useRef, useState } from "react";
import Modal from "./Modal";
import { Badge } from "./ui";
import { FileText, Printer, Maximize2 } from "lucide-react";

// A saved Studio document in the recent list. Click to re-open the branded HTML
// in a centered modal (sandboxed iframe) and print / save it again. The HTML is
// passed in from the server page (already generated + persisted).
export default function StudioDocCard({ doc }: { doc: { id: string; title: string; doc_type?: string | null; brand?: string | null; prompt?: string | null; created_at?: string | null; html: string } }) {
  const [open, setOpen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const when = doc.created_at ? new Date(doc.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";

  function printIt() {
    const win = iframeRef.current?.contentWindow;
    if (win) { win.focus(); win.print(); }
  }

  return (
    <>
      <button type="button" className="card hover card-pad" style={{ textAlign: "left", cursor: "pointer", border: 0, width: "100%", font: "inherit" }} onClick={() => setOpen(true)}>
        <div className="flex" style={{ gap: 10 }}>
          <span className="aico teal" style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0 }}><FileText size={16} /></span>
          <div style={{ minWidth: 0 }}>
            <div className="strong" style={{ fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.title}</div>
            {doc.prompt && <div className="faint" style={{ fontSize: 11.5, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.prompt}</div>}
          </div>
        </div>
        <div className="flex wrap" style={{ gap: 6, marginTop: 10 }}>
          {doc.doc_type && <Badge tone="gray">{doc.doc_type}</Badge>}
          {doc.brand && <span className={`chip ${doc.brand}`}><span className="bdot" /> {doc.brand}</span>}
          {when && <span className="faint" style={{ fontSize: 11, marginLeft: "auto" }}>{when}</span>}
        </div>
        <div className="pill" style={{ marginTop: 10, width: "100%", justifyContent: "center" }}><Maximize2 size={12} /> Open</div>
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        width={860}
        title={<div className="flex wrap"><h3 style={{ fontSize: 18 }}>{doc.title}</h3>{doc.doc_type && <Badge tone="teal">{doc.doc_type}</Badge>}</div>}
        footer={
          <>
            <button type="button" className="btn teal sm" onClick={printIt}><Printer size={13} /> Print / Save as PDF</button>
            <button type="button" className="btn ghost sm" onClick={() => setOpen(false)}>Close</button>
          </>
        }
      >
        <iframe
          ref={iframeRef}
          title={doc.title}
          sandbox="allow-same-origin allow-modals"
          srcDoc={doc.html}
          style={{ width: "100%", height: "62vh", border: "1px solid var(--line)", borderRadius: 10, background: "#fff" }}
        />
      </Modal>
    </>
  );
}
