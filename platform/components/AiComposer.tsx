"use client";

import { useState } from "react";
import { Send, Sparkles, Undo2, PenLine } from "lucide-react";

// Universal manual compose field with two AI affordances, reusing the exact
// /api/improve flow that ApprovalCard already uses:
//   - "Improve with AI": rewrites the current subject/body in place, with undo.
//   - "Draft with Sasa" (when draftDonorId is set): pre-fills a context-appropriate
//     message (thank-you for a recent gift, else a warm check-in) from /api/donor-draft.
// Renders a real <form action={action}> so the existing server actions
// (emailContact / sendReply) submit exactly as before. Nothing auto-sends.
export default function AiComposer({
  action,
  hidden,
  recipientLabel,
  recipientEmail,
  defaultSubject = "",
  defaultBody = "",
  bodyPlaceholder = "Write a message…",
  subjectRequired = false,
  bodyRequired = false,
  rows = 4,
  showSubject = true,
  draftDonorId,
  sendLabel = "Send email",
  sendClass = "btn teal",
  className,
  formStyle,
}: {
  action: (fd: FormData) => void | Promise<void>;
  hidden?: Record<string, string>;
  recipientLabel?: string;
  recipientEmail?: string;
  defaultSubject?: string;
  defaultBody?: string;
  bodyPlaceholder?: string;
  subjectRequired?: boolean;
  bodyRequired?: boolean;
  rows?: number;
  showSubject?: boolean;
  draftDonorId?: string;
  sendLabel?: string;
  sendClass?: string;
  className?: string;
  formStyle?: React.CSSProperties;
}) {
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);
  const [busy, setBusy] = useState<null | "improve" | "draft">(null);
  // snapshot for one-tap undo of the last AI rewrite/draft
  const [prev, setPrev] = useState<{ subject: string; body: string } | null>(null);

  async function improve() {
    if (busy) return;
    setBusy("improve");
    setPrev({ subject, body });
    try {
      const r = await fetch("/api/improve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject, body, to: recipientEmail }),
      });
      const j = await r.json();
      if (j.body) setBody(j.body);
      if (showSubject && j.subject) setSubject(j.subject);
    } finally {
      setBusy(null);
    }
  }

  async function draft() {
    if (busy || !draftDonorId) return;
    setBusy("draft");
    setPrev({ subject, body });
    try {
      const r = await fetch("/api/donor-draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ donor_id: draftDonorId }),
      });
      const j = await r.json();
      if (j.body) setBody(j.body);
      if (showSubject && j.subject) setSubject(j.subject);
    } finally {
      setBusy(null);
    }
  }

  function undo() {
    if (!prev) return;
    setSubject(prev.subject);
    setBody(prev.body);
    setPrev(null);
  }

  const defaultFormStyle: React.CSSProperties = {
    borderTop: "1px solid var(--line)",
    padding: "16px 22px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  };

  return (
    <form action={action} className={className} style={formStyle ?? defaultFormStyle}>
      {Object.entries(hidden || {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}

      {(recipientLabel || recipientEmail) && (
        <div className="between" style={{ gap: 10 }}>
          <span className="muted" style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>{recipientLabel}</span>
          {recipientEmail && <span className="faint" style={{ fontSize: 12 }}>{recipientEmail}</span>}
        </div>
      )}

      {showSubject && (
        <input
          name="subject"
          placeholder="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          required={subjectRequired}
          style={{ fontSize: 13 }}
        />
      )}

      <textarea
        name="body"
        placeholder={bodyPlaceholder}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={rows}
        required={bodyRequired}
        style={{ resize: "vertical" }}
      />

      <div className="flex wrap" style={{ justifyContent: "flex-end", gap: 8 }}>
        {draftDonorId && (
          <button type="button" className="btn ghost sm" onClick={draft} disabled={!!busy}>
            <PenLine size={13} /> {busy === "draft" ? "Drafting…" : "Draft with Sasa"}
          </button>
        )}
        <button type="button" className="btn ghost sm" onClick={improve} disabled={!!busy}>
          <Sparkles size={13} /> {busy === "improve" ? "Improving…" : "Improve with AI"}
        </button>
        {prev && (
          <button type="button" className="btn ghost sm" onClick={undo} disabled={!!busy} title="Undo the last AI change">
            <Undo2 size={13} /> Undo
          </button>
        )}
        <button type="submit" className={sendClass}>
          <Send size={14} /> {sendLabel}
        </button>
      </div>
    </form>
  );
}
