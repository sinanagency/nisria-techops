"use client";

import { useState } from "react";
import { Badge } from "./ui";
import { useTabs, type OpenSheet, type Sibling } from "./tabs-context";
import { decideApprovalAction } from "../app/approvals/actions";
import { stripDashes } from "../lib/humanize";
import AttachPicker from "./AttachPicker";
import ActionForm from "./ActionForm";
import { SubmitButton } from "./SubmitButton";
import { Send, Sparkles, Maximize2 } from "lucide-react";

function ago(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`;
}

// Which mailbox is this from? sasa@ shows as "Nisria", maisha@ as "Maisha".
function acctChip(account?: string | null): { label: string; cls: string } | null {
  if (account === "maisha@nisria.co") return { label: "Maisha", cls: "maisha" };
  if (account === "sasa@nisria.co") return { label: "Nisria", cls: "nisria" };
  return null;
}

// The full reply, self-contained so it owns its own editable state INSIDE the
// focus sheet (the sheet host renders it detached from this card). This is what
// the "expand" button opens — large, centered, minimizable to the tab strip.
function ReplyEditor({ a, original }: { a: any; original?: { subject?: string; body?: string; from?: string } | null }) {
  const editable = a.kind === "email_reply" || a.kind === "donor_thankyou";
  // Dash-clean on render: a pre-gate draft (queued before the humanize wiring)
  // can still carry an em-dash. Strip it for display/edit/send while preserving
  // legitimate brackets in a subject. New drafts are already clean at generation.
  const [subject, setSubject] = useState(stripDashes(a.proposed?.subject || ""));
  const [body, setBody] = useState(stripDashes(a.proposed?.body || ""));
  const [busy, setBusy] = useState(false);
  const [attachRefs, setAttachRefs] = useState<string[]>([]);

  async function improve() {
    setBusy(true);
    try {
      const r = await fetch("/api/improve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subject, body, to: a.proposed?.to, context: a.context }) });
      const j = await r.json();
      if (j.body) setBody(j.body);
      if (j.subject) setSubject(j.subject);
    } finally { setBusy(false); }
  }

  return (
    <>
      {original?.body && (
        <div style={{ marginBottom: 16 }}>
          <div className="faint" style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>In reply to{original.from ? ` ${original.from}` : ""}{original.subject ? ` · ${original.subject}` : ""}</div>
          <div className="peek-quote">{original.body}</div>
        </div>
      )}
      {editable ? (
        <ActionForm action={decideApprovalAction}>
          <input type="hidden" name="id" value={a.id} />
          <input type="hidden" name="attach_refs" value={attachRefs.join(",")} />
          <input type="hidden" name="confirm_label" value={a.proposed?.to || ""} />
          <div className="faint" style={{ fontSize: 12.5, marginBottom: 6 }}>To {a.proposed?.to || "—"}</div>
          {/* Which account this reply sends from (P14/168). The branded signature
              for that account is appended automatically on send. */}
          <div className="faint" style={{ fontSize: 11.5, marginBottom: 8 }}>
            Sending from {a.context?.account || "sasa@nisria.co"} · branded signature added automatically.
          </div>
          <input name="subject" value={subject} onChange={(e) => setSubject(e.target.value)} style={{ marginBottom: 10, fontSize: 14 }} />
          <textarea name="body" value={body} onChange={(e) => setBody(e.target.value)} rows={16} style={{ fontSize: 14, lineHeight: 1.6 }} />
          <div className="flex wrap" style={{ marginTop: 10 }}>
            <SubmitButton className="btn sm teal" name="decision" value="approve" pendingLabel="Sending…"><Send size={13} /> Approve &amp; send</SubmitButton>
            <button className="btn sm ghost" type="button" onClick={improve} disabled={busy}><Sparkles size={13} /> {busy ? "Improving…" : "Improve with AI"}</button>
            <AttachPicker selected={attachRefs} onChange={setAttachRefs} size="sm" />
            <SubmitButton className="btn sm ghost" name="decision" value="reject" formNoValidate pendingLabel="Declining…">Decline</SubmitButton>
          </div>
        </ActionForm>
      ) : (
        <ActionForm action={decideApprovalAction}>
          <input type="hidden" name="id" value={a.id} />
          {a.summary && <div style={{ fontSize: 14, color: "var(--ink-2)", lineHeight: 1.6, marginBottom: 12 }}>{a.summary}</div>}
          <div className="flex" style={{ marginTop: 4 }}>
            <SubmitButton className="btn sm teal" name="decision" value="approve" pendingLabel="Approving…">Approve</SubmitButton>
            <SubmitButton className="btn sm ghost" name="decision" value="reject" pendingLabel="Declining…">Decline</SubmitButton>
          </div>
        </ActionForm>
      )}
    </>
  );
}

// A clear, human tab title — NEVER an id. "Reply to <name>" when we can read the
// recipient, else the approval's own title.
function sheetTitleFor(a: any, original?: { from?: string } | null) {
  const to = a.proposed?.to || original?.from || "";
  const who = (to.split("@")[0] || "").replace(/[._-]+/g, " ").trim();
  if ((a.kind === "email_reply" || a.kind === "donor_thankyou") && who) {
    return `Reply to ${who.replace(/\b\w/g, (c: string) => c.toUpperCase())}`.slice(0, 28);
  }
  return (a.title || "Needs you").slice(0, 28);
}

// A Needs-You sibling carries its approval + its already-resolved original
// message inline (server-serializable — no functions cross the boundary).
type ApprovalSib = { a: any; original?: { subject?: string; body?: string; from?: string } | null };

// Build the Focus Tab payload for one Needs-You approval — reused as opener AND
// sibling builder so prev/next steps through the pending set without closing.
// The FULL action set (Approve & send, Improve, Attach, Decline) lives in the
// body (ReplyEditor); the compact card stays minimal (P1).
function buildApprovalSheet(a: any, original: any, siblings?: ApprovalSib[]): OpenSheet {
  const chip = acctChip(a.context?.account);
  const sibs: Sibling[] | undefined = siblings && siblings.length > 1
    ? siblings.map((s) => ({ id: `approval:${s.a.id}`, build: () => buildApprovalSheet(s.a, s.original ?? null, siblings) }))
    : undefined;
  return {
    id: `approval:${a.id}`,
    title: sheetTitleFor(a, original),
    icon: "inbox",
    brand: chip?.cls,
    group: "needs-you",
    siblings: sibs,
    titleExtra: (
      <>
        {chip && <span className={`chip ${chip.cls}`}><span className="bdot" /> {chip.label}</span>}
        {a.lane === "escalate" && <Badge tone="red">Escalated</Badge>}
        {a.agent && <Badge tone="teal">{String(a.agent).replace("agent:", "")}</Badge>}
      </>
    ),
    render: () => <ReplyEditor a={a} original={original} />,
  };
}

export default function ApprovalCard({
  a,
  original,
  siblings,
}: {
  a: any;
  original?: { subject?: string; body?: string; from?: string } | null;
  // the pending set (each with its original inline), so the Focus Tab's
  // prev/next arrows can step through Needs-You without closing
  siblings?: ApprovalSib[];
}) {
  const editable = a.kind === "email_reply" || a.kind === "donor_thankyou";
  const { openSheet } = useTabs();
  const chip = acctChip(a.context?.account);

  function expand() {
    openSheet(buildApprovalSheet(a, original, siblings));
  }

  return (
    // COMPACT card in the Needs You scroller (P1/152). It shows ONLY the primary
    // action (Approve & send / Approve) + the expand affordance — NO Attach /
    // Decline clutter. The full action set lives inside the Focus Tab the expand
    // button opens (truly centered, blurred backdrop, prev/next, minimizable).
    <ActionForm action={decideApprovalAction} className="card" style={{ padding: 14, boxShadow: "none", background: "var(--surface-2)", height: "fit-content" }}>
      <input type="hidden" name="id" value={a.id} />
      <input type="hidden" name="confirm_label" value={a.proposed?.to || ""} />
      <div className="between" style={{ marginBottom: 8 }}>
        <div className="flex">
          <span className="strong" style={{ fontSize: 13.5 }}>{a.title}</span>
          {chip && <span className={`chip ${chip.cls}`}><span className="bdot" /> {chip.label}</span>}
          {a.lane === "escalate" && <Badge tone="red">Escalated</Badge>}
        </div>
        <div className="flex" style={{ gap: 6 }}>
          <span className="faint" style={{ fontSize: 11 }}>{ago(a.created_at)}</span>
          <button type="button" className="expandbtn tip-host" data-tip="Open full view" aria-label="Open full view" onClick={expand}><Maximize2 size={14} /></button>
        </div>
      </div>
      {editable ? (
        <>
          <div className="faint" style={{ fontSize: 12, marginBottom: 6 }}>To {a.proposed?.to || "—"}</div>
          {a.proposed?.subject && <div className="strong" style={{ fontSize: 13, marginBottom: 4 }}>{stripDashes(a.proposed.subject)}</div>}
          <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.5, marginBottom: 10, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {stripDashes(a.proposed?.body || "—")}
          </div>
          {/* compact: primary only + open-to-edit. Editing/Improve/Attach/Decline live in the Focus Tab. */}
          <div className="flex wrap">
            <SubmitButton className="btn sm teal" name="decision" value="approve" pendingLabel="Sending…"><Send size={13} /> Approve &amp; send</SubmitButton>
            <button type="button" className="btn sm ghost" onClick={expand}><Maximize2 size={13} /> Open &amp; edit</button>
          </div>
        </>
      ) : (
        <>
          {a.summary && (
            <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55, marginBottom: 10, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{a.summary}</div>
          )}
          {/* compact: approve only. Decline lives in the Focus Tab. */}
          <div className="flex wrap">
            <SubmitButton className="btn sm teal" name="decision" value="approve" pendingLabel="Approving…">Approve</SubmitButton>
            <button type="button" className="btn sm ghost" onClick={expand}><Maximize2 size={13} /> Open</button>
          </div>
        </>
      )}
    </ActionForm>
  );
}
