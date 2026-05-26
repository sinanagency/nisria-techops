"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "./ui";
import { useTabs, type OpenSheet, type Sibling } from "./tabs-context";
import { advanceStatus, prepareGrant, declineGrant } from "../app/grants/actions";
import { formatLong } from "../lib/now";
import { humanize } from "../lib/humanize";
import { Maximize2, ExternalLink, Send, Sparkles, X, Loader2 } from "lucide-react";

// The prepared package stores a live-date token (⟦GRANT_DATE⟧) instead of a
// frozen date, so the date rolls day by day until the grant is submitted (P4).
// Resolve it to TODAY in the viewer's own timezone right before rendering.
const GRANT_DATE_TOKEN = "⟦GRANT_DATE⟧";

// HUMANIZE-ON-RENDER (R-recur-1 / R4): grant packages stored BEFORE the
// generation-time gate still carry "— —" / placeholders. humanize ran only at
// GENERATION, so old rows leaked dashes. The permanent fix is to clean at the
// DISPLAY layer too, so the rendered package is clean regardless of when it was
// prepared. We resolve the live date first (so the date is correct), then run
// the whole package through the same humanize() gate every generator uses, so
// there is ONE contract, applied on render here as well as on write.
function renderClean(md: string): string {
  if (!md) return "";
  let tz = "UTC";
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch {}
  const longDate = formatLong(new Date(), tz);
  // resolve the live-date token to today's date in the viewer's timezone
  const dated = md.indexOf(GRANT_DATE_TOKEN) === -1 ? md : md.split(GRANT_DATE_TOKEN).join(longDate);
  // clean on render: strips any em-dash / placeholder left in a pre-gate row
  return humanize(dated, { now: { long: longDate } });
}

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

// The prepared package, shown inside the focus sheet. Self-contained so the
// markdown renders fresh whenever the sheet (re)opens.
function GrantSheetBody({ g }: { g: any }) {
  const hasPkg = !!(g.notes && String(g.notes).trim());
  const inReview = (g.status || "").toLowerCase() === "review";
  return (
    <>
      <div className="faint" style={{ fontSize: 12, marginBottom: 14 }}>
        {inReview
          ? "Prepared by the Grant agent and waiting for your call. Read it below, then Submit to advance it or Decline to set it aside. Submit only advances status for now; browser auto-submit into the funder portal is the next phase."
          : "Prepared by the Grant agent. Review below, then submit in one tap. Auto-fill / auto-submit into the funder portal via a browser is the next phase."}
      </div>
      {hasPkg ? (
        <div>{renderMarkdown(renderClean(String(g.notes)))}</div>
      ) : (
        <div className="empty" style={{ padding: 28 }}>
          <div style={{ marginBottom: 6 }}>No application prepared yet.</div>
          <div className="faint" style={{ fontSize: 13 }}>Use “Prepare with AI” to generate the full submission-ready package.</div>
        </div>
      )}
    </>
  );
}

// Footer actions live in their own component so the re-prepare transition state
// stays interactive inside the detached sheet host.
function GrantSheetFooter({ g, onClose }: { g: any; onClose: () => void }) {
  const router = useRouter();
  const [reqPending, startReq] = useTransition();
  const [requeued, setRequeued] = useState(false);
  const hasPkg = !!(g.notes && String(g.notes).trim());
  const status = (g.status || "").toLowerCase();
  const canSubmit = status !== "submitted" && status !== "won" && status !== "lost";
  const inReview = status === "review";

  // Re-prepare is a BACKGROUND job (non-blocking): enqueue + return.
  function reprepare() {
    startReq(async () => {
      await prepareGrant(g.id);
      setRequeued(true);
      router.refresh();
    });
  }

  return (
    <>
      {/* Which account this package goes out from (P14/168). Grants are org-level,
          so they send from the Nisria mailbox. */}
      <span className="faint" style={{ fontSize: 11.5, flexBasis: "100%", marginBottom: 2 }}>
        Sending from sasa@nisria.co · the branded Nisria signature is appended automatically.
      </span>
      {canSubmit && hasPkg && (
        <form action={advanceStatus} onSubmit={() => setTimeout(onClose, 50)}>
          <input type="hidden" name="id" value={g.id} />
          <input type="hidden" name="status" value="submitted" />
          <button className="btn sm teal" type="submit"><Send size={13} /> {inReview ? "Submit" : "Mark submitted"}</button>
        </form>
      )}
      {inReview && (
        <form action={declineGrant} onSubmit={() => setTimeout(onClose, 50)}>
          <input type="hidden" name="id" value={g.id} />
          <button className="btn sm ghost" type="submit"><X size={13} /> Decline</button>
        </form>
      )}
      {g.link && (
        <a className="pill" href={g.link} target="_blank" rel="noreferrer"><ExternalLink size={12} /> Open funder portal</a>
      )}
      <button type="button" className="btn sm ghost" onClick={reprepare} disabled={reqPending || requeued}>
        {reqPending ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
        {requeued ? "Preparing in background…" : hasPkg ? "Re-prepare with AI" : "Prepare with AI"}
      </button>
    </>
  );
}

// Build the Focus Tab payload for one grant. Pulled out so it can be reused both
// as the opener AND as a sibling builder (prev/next without closing). `siblings`
// carries the whole set so the arrows can step through the column's ready grants.
function buildGrantSheet(g: any, closeSheet: (id: string) => void, siblings?: any[]): OpenSheet {
  const status = (g.status || "").toLowerCase();
  const inReview = status === "review";
  const id = `grant:${g.id}`;
  const sibs: Sibling[] | undefined = siblings && siblings.length > 1
    ? siblings.map((s) => ({ id: `grant:${s.id}`, build: () => buildGrantSheet(s, closeSheet, siblings) }))
    : undefined;
  return {
    id,
    title: (g.funder || "Grant").slice(0, 40),
    icon: "award",
    group: "grants",
    siblings: sibs,
    titleExtra: (
      <>
        {/* The program/opportunity name can be a full sentence (e.g. the USDA
            McGovern-Dole title). Show it as muted text that WRAPS, not a giant
            pill that overflows the header. The status stays a compact badge. */}
        {g.program && <span className="muted" style={{ fontSize: 12, lineHeight: 1.4, wordBreak: "break-word" }}>{g.program}</span>}
        <Badge tone={inReview ? "green" : "teal"}>{inReview ? "ready" : g.status}</Badge>
      </>
    ),
    render: () => <GrantSheetBody g={g} />,
    footer: <GrantSheetFooter g={g} onClose={() => closeSheet(id)} />,
  };
}

export default function GrantPeek({ g, siblings }: { g: any; siblings?: any[] }) {
  const { openSheet, closeSheet } = useTabs();
  const status = (g.status || "").toLowerCase();
  // A prepared grant awaiting Nur's call: accept (submit) or decline.
  const inReview = status === "review";

  // "Review · accept or decline" (and "Open application") open the prepared
  // package in the canonical Focus Tab, minimizable to the tab strip, with
  // prev/next arrows across the column's ready grants (#32, P1).
  function open() {
    openSheet(buildGrantSheet(g, closeSheet, siblings));
  }

  return (
    <button
      type="button"
      className="pill"
      style={{ marginTop: 10, width: "100%", justifyContent: "center" }}
      onClick={open}
    >
      <Maximize2 size={12} /> {inReview ? "Review · accept or decline" : "Open application"}
    </button>
  );
}
