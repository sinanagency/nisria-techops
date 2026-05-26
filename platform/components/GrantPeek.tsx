"use client";

import { useState } from "react";
import { Badge } from "./ui";
import Modal from "./Modal";
import { advanceStatus, prepareGrant, declineGrant } from "../app/grants/actions";
import { Maximize2, ExternalLink, Send, Sparkles, X } from "lucide-react";

// Lightweight markdown renderer — enough for the prepared package
// (## headings, ### subheadings, **bold**, - bullets, --- rules, paragraphs).
// We avoid a dependency; the agent only emits this small subset.
function renderMarkdown(md: string) {
  const lines = (md || "").replace(/\r\n/g, "\n").split("\n");
  const out: React.ReactNode[] = [];
  let list: string[] = [];
  let key = 0;

  const inline = (s: string) => {
    // bold + italics, escape-free since this is our own generated content
    const parts = s.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((p, i) =>
      p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>
    );
  };

  const flushList = () => {
    if (!list.length) return;
    out.push(
      <ul key={`ul-${key++}`} style={{ margin: "6px 0 12px", paddingLeft: 20, lineHeight: 1.6, color: "var(--ink-2)" }}>
        {list.map((li, i) => (
          <li key={i} style={{ marginBottom: 4 }}>{inline(li)}</li>
        ))}
      </ul>
    );
    list = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\s*[-*]\s+/.test(line)) {
      list.push(line.replace(/^\s*[-*]\s+/, ""));
      continue;
    }
    flushList();
    if (!line.trim()) continue;
    if (/^#\s+/.test(line)) {
      out.push(<h2 key={`h-${key++}`} style={{ fontSize: 19, margin: "4px 0 8px" }}>{line.replace(/^#\s+/, "")}</h2>);
    } else if (/^##\s+/.test(line)) {
      out.push(<h3 key={`h-${key++}`} style={{ fontSize: 15.5, margin: "18px 0 6px", fontFamily: "var(--font-display)" }}>{line.replace(/^##\s+/, "")}</h3>);
    } else if (/^###\s+/.test(line)) {
      out.push(<h4 key={`h-${key++}`} style={{ fontSize: 13.5, margin: "12px 0 4px", color: "var(--ink)" }}>{line.replace(/^###\s+/, "")}</h4>);
    } else if (/^---+$/.test(line.trim())) {
      out.push(<hr key={`hr-${key++}`} style={{ border: 0, borderTop: "1px solid var(--line)", margin: "16px 0" }} />);
    } else if (/^_.*_$/.test(line.trim())) {
      out.push(<div key={`em-${key++}`} className="faint" style={{ fontSize: 12, fontStyle: "italic", marginBottom: 6 }}>{line.trim().replace(/^_|_$/g, "")}</div>);
    } else {
      out.push(<p key={`p-${key++}`} style={{ margin: "0 0 10px", lineHeight: 1.65, color: "var(--ink-2)", fontSize: 13.5 }}>{inline(line)}</p>);
    }
  }
  flushList();
  return out;
}

export default function GrantPeek({ g }: { g: any }) {
  const [open, setOpen] = useState(false);
  const hasPkg = !!(g.notes && String(g.notes).trim());
  const status = (g.status || "").toLowerCase();
  const canSubmit = status !== "submitted" && status !== "won" && status !== "lost";
  // A prepared grant awaiting Nur's call: accept (submit) or decline.
  const inReview = status === "review";

  return (
    <>
      <button
        type="button"
        className="pill"
        style={{ marginTop: 10, width: "100%", justifyContent: "center" }}
        onClick={() => setOpen(true)}
      >
        <Maximize2 size={12} /> {inReview ? "Review · accept or decline" : "Open application"}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        width={700}
        title={
          <div className="flex wrap">
            <h3 style={{ fontSize: 18 }}>{g.funder}</h3>
            {g.program && <Badge tone="gray">{g.program}</Badge>}
            <Badge tone="teal">{g.status}</Badge>
          </div>
        }
        footer={
          <>
            {canSubmit && hasPkg && (
              <form action={advanceStatus}>
                <input type="hidden" name="id" value={g.id} />
                <input type="hidden" name="status" value="submitted" />
                <button className="btn sm teal" type="submit"><Send size={13} /> {inReview ? "Submit" : "Mark submitted"}</button>
              </form>
            )}
            {inReview && (
              <form action={declineGrant} onSubmit={() => setTimeout(() => setOpen(false), 50)}>
                <input type="hidden" name="id" value={g.id} />
                <button className="btn sm ghost" type="submit"><X size={13} /> Decline</button>
              </form>
            )}
            {g.link && (
              <a className="pill" href={g.link} target="_blank" rel="noreferrer"><ExternalLink size={12} /> Open funder portal</a>
            )}
            <form action={prepareGrant}>
              <input type="hidden" name="id" value={g.id} />
              <button className="btn sm ghost" type="submit"><Sparkles size={13} /> {hasPkg ? "Re-prepare with AI" : "Prepare with AI"}</button>
            </form>
          </>
        }
      >
        <div className="faint" style={{ fontSize: 12, marginBottom: 14 }}>
          {inReview
            ? "Prepared by the Grant agent and waiting for your call. Read it below, then Submit to advance it or Decline to set it aside. Submit only advances status for now; browser auto-submit into the funder portal is the next phase."
            : "Prepared by the Grant agent. Review below, then submit in one tap. Auto-fill / auto-submit into the funder portal via a browser is the next phase."}
        </div>

        {hasPkg ? (
          <div>{renderMarkdown(String(g.notes))}</div>
        ) : (
          <div className="empty" style={{ padding: 28 }}>
            <div style={{ marginBottom: 6 }}>No application prepared yet.</div>
            <div className="faint" style={{ fontSize: 13 }}>Use “Prepare with AI” to generate the full submission-ready package.</div>
          </div>
        )}
      </Modal>
    </>
  );
}
