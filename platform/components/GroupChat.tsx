"use client";
// WhatsApp-faithful group chat. Owner (Nur / the bot) on the RIGHT, everyone else
// on the LEFT with their own name colour, time stamps, date dividers, a subtle
// doodle backdrop, in-chat search, and inline rendering of links + media. Used two
// ways: inline on the Groups page, and maximised into the canonical FocusSheet
// (same overlay as Need You) where the prev/next arrows step between groups.
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { useTabs } from "./tabs-context";
import SubmitButton from "./SubmitButton";
import {
  Users, ChevronLeft, ChevronRight, Search, Maximize2, Send,
  FileText, Image as ImageIcon, Mic, ExternalLink, X,
} from "lucide-react";
import { postToGroupAction } from "../app/team/actions";

export type GroupRef = { name: string; last: string; count?: number };
type Msg = { id: string; body: string; name: string; mine: boolean; at: string; href: string | null };

// A fixed palette so each sender keeps a stable colour (WhatsApp does the same).
const NAME_COLORS = ["#1f8a70", "#b5683b", "#7a5cc7", "#c2417a", "#2b6cb0", "#9a7d0a", "#0e7c86", "#a23b72", "#3f7d20", "#b23a48", "#5a4fcf", "#0f766e"];
function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return NAME_COLORS[h % NAME_COLORS.length];
}

const fmtTime = (iso: string) => { try { return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); } catch { return ""; } };
function dayLabel(iso: string): string {
  const d = new Date(iso); const now = new Date();
  const ymd = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (ymd(d) === ymd(now)) return "Today";
  if (ymd(d) === ymd(y)) return "Yesterday";
  return d.toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" });
}

const URL_RE = /(https?:\/\/[^\s]+)/g;
const isImg = (u: string) => /\.(png|jpe?g|gif|webp)(\?|$)/i.test(u);
const isDrive = (u: string) => /(drive|docs)\.google\.com/i.test(u);

// Render a message body: linkify URLs, inline images, flag Drive links, highlight search.
function Body({ text, q }: { text: string; q: string }) {
  const parts: React.ReactNode[] = [];
  const imgs: string[] = [];
  let li = 0, m: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text))) {
    if (m.index > li) parts.push(<span key={li}>{hl(text.slice(li, m.index), q)}</span>);
    const u = m[0];
    if (isImg(u)) imgs.push(u);
    parts.push(
      <a key={m.index} href={u} target="_blank" rel="noreferrer" style={{ color: "var(--teal)", wordBreak: "break-all", display: "inline-flex", alignItems: "center", gap: 3 }}>
        {isDrive(u) ? <><ExternalLink size={11} /> Drive link</> : u}
      </a>
    );
    li = m.index + u.length;
  }
  if (li < text.length) parts.push(<span key={li}>{hl(text.slice(li), q)}</span>);
  return (
    <>
      <div style={{ fontSize: 13.5, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{parts}</div>
      {imgs.map((u) => <img key={u} src={u} alt="" style={{ marginTop: 6, maxWidth: "100%", borderRadius: 10, display: "block" }} />)}
    </>
  );
}
// highlight search hits
function hl(s: string, q: string): React.ReactNode {
  if (!q) return s;
  const i = s.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return s;
  return <>{s.slice(0, i)}<mark style={{ background: "#ffe58a", padding: "0 1px", borderRadius: 3 }}>{s.slice(i, i + q.length)}</mark>{s.slice(i + q.length)}</>;
}
// media placeholder icon for historical "Photo / Document / Voice note" bodies
function mediaIcon(body: string) {
  if (/^📄|Document/.test(body)) return <FileText size={13} />;
  if (/^🖼️|Photo/.test(body)) return <ImageIcon size={13} />;
  if (/Voice note|🎙️/.test(body)) return <Mic size={13} />;
  return null;
}

// The chat pane itself, reused inline and inside the FocusSheet.
export function GroupChatPane({ group, fullscreen }: { group: string; fullscreen?: boolean }) {
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [q, setQ] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let on = true;
    setMsgs(null);
    fetch(`/api/groups/messages?g=${encodeURIComponent(group)}`, { cache: "no-store" })
      .then((r) => r.json()).then((j) => { if (on) setMsgs(j.messages || []); }).catch(() => { if (on) setMsgs([]); });
    return () => { on = false; };
  }, [group]);

  // jump to bottom when a fresh group loads (newest message in view)
  useEffect(() => { if (msgs && !q) requestAnimationFrame(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }); }, [msgs, q]);

  const shown = useMemo(() => {
    if (!msgs) return [];
    if (!q.trim()) return msgs;
    const needle = q.toLowerCase();
    return msgs.filter((m) => m.body.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle));
  }, [msgs, q]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: fullscreen ? "min(74vh, 760px)" : "62vh" }}>
      {/* search bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "1px solid var(--line)" }}>
        <Search size={15} style={{ color: "var(--muted)" }} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search in ${group}...`}
          style={{ flex: 1, border: "none", background: "transparent", outline: "none", fontSize: 13, fontFamily: "var(--font-body)" }} />
        {q && <button aria-label="Clear search" onClick={() => setQ("")} className="iconbtn" style={{ display: "flex" }}><X size={14} /></button>}
        {q && <span className="muted" style={{ fontSize: 11.5 }}>{shown.length} hit{shown.length === 1 ? "" : "s"}</span>}
      </div>

      {/* the conversation, WhatsApp doodle backdrop */}
      <div ref={scrollRef} className="wa-chat" style={{ flex: 1, overflowY: "auto", padding: "14px 16px", scrollBehavior: "smooth" }}>
        {msgs === null && <div className="empty">Loading…</div>}
        {msgs && shown.length === 0 && <div className="empty">{q ? "No matches." : "No messages in this group yet."}</div>}
        {shown.map((m, i) => {
          const prev = shown[i - 1];
          const newDay = !prev || dayLabel(prev.at) !== dayLabel(m.at);
          const sameRun = prev && prev.name === m.name && prev.mine === m.mine && !newDay;
          const mi = mediaIcon(m.body);
          return (
            <div key={m.id}>
              {newDay && (
                <div style={{ textAlign: "center", margin: "12px 0 8px" }}>
                  <span style={{ background: "var(--surface-elevated)", border: "1px solid var(--line)", borderRadius: 999, padding: "3px 12px", fontSize: 11.5, color: "var(--muted)" }}>{dayLabel(m.at)}</span>
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", alignItems: m.mine ? "flex-end" : "flex-start", marginTop: sameRun ? 2 : 8 }}>
                {!sameRun && !m.mine && (
                  <div style={{ fontSize: 12, fontWeight: 700, color: colorFor(m.name), marginBottom: 2, marginLeft: 6 }}>
                    {m.href ? <Link href={m.href} style={{ color: "inherit", textDecoration: "none" }}>{m.name}</Link> : m.name}
                  </div>
                )}
                <div style={{ maxWidth: "78%", background: m.mine ? "var(--teal)" : "var(--surface-elevated)", color: m.mine ? "#fff" : "var(--ink)", border: m.mine ? "none" : "1px solid var(--line)", borderRadius: 12, padding: "7px 11px", boxShadow: "0 1px 1px rgba(0,0,0,0.04)" }}>
                  {mi && <span style={{ opacity: 0.85, marginRight: 5, verticalAlign: "middle" }}>{mi}</span>}
                  <Body text={m.body} q={q} />
                  <div style={{ fontSize: 10, opacity: 0.6, marginTop: 2, textAlign: "right" }}>{fmtTime(m.at)}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* composer */}
      <form action={postToGroupAction} style={{ display: "flex", gap: 8, padding: "10px 14px", borderTop: "1px solid var(--line)" }}>
        <input type="hidden" name="group" value={group} />
        <input name="text" placeholder={`Message ${group}...`} required style={{ flex: 1, padding: "9px 13px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface)", fontFamily: "var(--font-body)", fontSize: 13.5 }} />
        <SubmitButton className="btn" pendingLabel="Sending…"><Send size={14} /> Send</SubmitButton>
      </form>
    </div>
  );
}

// Short relative "last activity" label for the group list (presentation only).
function lastActivity(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!isFinite(ms)) return "";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "yesterday";
  if (day < 7) return `${day}d ago`;
  try { return new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" }); } catch { return ""; }
}

// The Groups-page widget: a clean master/detail surface. Left, the list of team
// groups (name + last activity + message count). Right, the chat pane. Selecting
// a group switches the conversation in place (no reload). Maximize opens the
// canonical FocusSheet with every group as a sibling, so the overlay's prev/next
// arrows step between groups (same as Need You). All load + send wiring preserved.
export default function GroupChat({ groups, initial }: { groups: GroupRef[]; initial: string }) {
  const { openSheet } = useTabs();
  const [sel, setSel] = useState(initial);
  const idx = groups.findIndex((g) => g.name === sel);
  const prev = groups[idx - 1], next = groups[idx + 1];

  // Build the FocusSheet for a group, with every group as a sibling so the
  // overlay's prev/next arrows step between groups in place (like Need You).
  const buildSheet = useCallback((name: string): any => ({
    id: `group:${name}`, title: name, icon: "users", width: 920,
    render: () => <GroupChatPane group={name} fullscreen />,
    siblings: groups.map((g) => ({ id: `group:${g.name}`, build: () => buildSheet(g.name) })),
  }), [groups]);

  return (
    <div className="grid" style={{ gridTemplateColumns: "300px 1fr", gap: 12, alignItems: "start" }}>
      {/* LEFT: the group list */}
      <aside className="card" style={{ overflow: "hidden", display: "flex", flexDirection: "column", alignSelf: "start", maxHeight: "calc(62vh + 116px)" }}>
        <div className="card-h" style={{ position: "sticky", top: 0, zIndex: 1, background: "var(--surface-elevated)" }}>
          <span className="flex" style={{ gap: 8 }}><Users size={15} style={{ color: "var(--teal-700)" }} /> Groups</span>
          <span className="badge gray">{groups.length}</span>
        </div>
        <div style={{ overflowY: "auto", padding: 6, flex: 1 }}>
          {groups.map((g) => {
            const active = g.name === sel;
            return (
              <button
                key={g.name}
                onClick={() => setSel(g.name)}
                aria-current={active ? "true" : undefined}
                className="actrow"
                style={{ width: "100%", textAlign: "left", border: "none", background: active ? "var(--canvas)" : "transparent", cursor: "pointer", borderRadius: 10, borderLeft: active ? "3px solid var(--teal)" : "3px solid transparent" }}
              >
                <span className="aico teal" style={{ position: "relative" }}><Users size={15} /></span>
                <div className="abody">
                  <div className="atitle" style={{ fontWeight: active ? 700 : 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}</div>
                  <div className="ameta">{lastActivity(g.last)}{typeof g.count === "number" ? ` · ${g.count} msg` : ""}</div>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* RIGHT: the chat for the selected group */}
      <section className="card" style={{ overflow: "hidden", position: "relative" }}>
        <div className="card-h">
          <span className="flex" style={{ gap: 9, minWidth: 0 }}>
            <span className="aico teal" style={{ flex: "0 0 auto" }}><Users size={15} /></span>
            <span className="disp2" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sel}</span>
          </span>
          <span className="flex" style={{ gap: 6, flex: "0 0 auto" }}>
            <button aria-label="Previous group" className="iconbtn sm" disabled={!prev} onClick={() => prev && setSel(prev.name)} title="Previous group" style={{ opacity: prev ? 1 : 0.4 }}><ChevronLeft size={16} /></button>
            <button aria-label="Next group" className="iconbtn sm" disabled={!next} onClick={() => next && setSel(next.name)} title="Next group" style={{ opacity: next ? 1 : 0.4 }}><ChevronRight size={16} /></button>
            <button aria-label="Open full screen" className="iconbtn sm" onClick={() => openSheet(buildSheet(sel))} title="Open full screen"><Maximize2 size={16} /></button>
          </span>
        </div>
        <GroupChatPane group={sel} />
      </section>
    </div>
  );
}
