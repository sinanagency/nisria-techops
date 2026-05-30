"use client";

import { useState } from "react";
import Modal from "./Modal";
import { Download } from "lucide-react";

// Local-first preview (Law 3). Opens the org's own bytes (a beneficiary photo, a
// generated PDF, a filed document) IN-PORTAL in the shared Modal, instead of
// dumping the operator into an external browser tab. A Download button inside the
// preview keeps the explicit "I want the file" path. Renders its children as the
// trigger, so call sites keep their existing button/link styling.
export default function PreviewLink({
  href,
  kind = "pdf",
  title,
  className,
  style,
  children,
}: {
  href: string;
  kind?: "image" | "pdf";
  title?: string;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <a
        role="button"
        tabIndex={0}
        className={className}
        title={title || "Preview"}
        style={{ cursor: "pointer", ...style }}
        onClick={(e) => { e.preventDefault(); setOpen(true); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(true); } }}
      >
        {children}
      </a>
      <Modal open={open} onClose={() => setOpen(false)} title={title || "Preview"} width={kind === "image" ? 720 : 920}>
        {kind === "image" ? (
          <img src={href} alt={title || "preview"} style={{ maxWidth: "100%", maxHeight: "76vh", display: "block", margin: "0 auto", borderRadius: 10 }} />
        ) : (
          <iframe src={href} title={title || "document"} style={{ width: "100%", height: "76vh", border: 0, borderRadius: 10, background: "#fff" }} />
        )}
        <div style={{ marginTop: 12, textAlign: "right" }}>
          <a className="btn sm ghost" href={href} download><Download size={13} /> Download</a>
        </div>
      </Modal>
    </>
  );
}
