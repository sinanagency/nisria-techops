"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTabs } from "./tabs-context";
import { sendChat, assignTask, sasaDraft } from "../app/workspace/actions";
import {
  MessageCircle, Mail, Phone, MessageSquare, Send, Sparkles, ExternalLink,
  ListChecks, Layers, ChevronRight,
} from "lucide-react";

const CH: Record<string, { icon: any; label: string; tone: string }> = {
  whatsapp: { icon: MessageCircle, label: "WhatsApp", tone: "green" },
  email: { icon: Mail, label: "Email", tone: "teal" },
  voice: { icon: Phone, label: "Voice", tone: "peri" },
  sms: { icon: MessageSquare, label: "SMS", tone: "gold" },
};
const meta = (c: string) => CH[(c || "").toLowerCase()] || { icon: MessageSquare, label: c || "Message", tone: "gray" };
const ago = (d: string) => {
  if (!d) return "";
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return "now"; if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`; return `${Math.floor(s / 86400)}d`;
};
const clip = (s: string, n = 46) => { const t = (s || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n) + "…" : t; };

export default function WorkspacePortal({ threads, team, tasks, events }: { threads: any[]; team: any[]; tasks: any[]; events: any[] }) {
  const router = useRouter();
  const { tabs } = useTabs();
  const key = (t: any) => t.contactId || "unknown";
  const [sel, setSel] = useState<string | null>(threads[0] ? key(threads[0]) : null);
  const [draft, setDraft] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);

  const active = threads.find((t) => key(t) === sel) || null;
  const teamName = (id: string) => team.find((m) => m.id === id)?.name || "Unassigned";

  const openProfile = () => { if (active?.contactId) router.push(`/contacts/${active.contactId}`); };
  const doDraft = async () => {
    if (!active?.contactId) return;
    setDrafting(true);
    try { setDraft(await sasaDraft(active.contactId, active.channel)); } finally { setDrafting(false); }
  };

  return (
    <div className="wp-portal">
      {/* LEFT — conversations */}
      <aside className="wp-rail">
        <div className="wp-railhead"><span className="flex" style={{ gap: 7 }}><MessageCircle size={15} /> Conversations</span><span className="faint" style={{ fontSize: 12 }}>{threads.length}</span></div>
        <div className="wp-threads">
          {threads.length === 0 && <div className="faint" style={{ padding: 18, fontSize: 12.5 }}>No conversations yet. They appear as messages arrive.</div>}
          {threads.map((t) => {
            const m = meta(t.channel); const Icon = m.icon; const last = t.messages[t.messages.length - 1];
            return (
              <button key={key(t)} className={`wp-thread ${sel === key(t) ? "on" : ""}`} onClick={() => { setSel(key(t)); setDraft(""); setAssignOpen(false); }}>
                <span className={`aico ${m.tone}`} style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0 }}><Icon size={15} /></span>
                <span style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
                  <span className="between"><span className="strong" style={{ fontSize: 13 }}>{t.name}</span><span className="faint" style={{ fontSize: 10.5 }}>{ago(t.lastAt)}</span></span>
                  <span className="faint" style={{ display: "block", fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{clip(last?.body || last?.subject || "")}</span>
                </span>
                {t.unread > 0 && <span className="wp-unread">{t.unread}</span>}
              </button>
            );
          })}
        </div>
      </aside>

      {/* CENTER — chat */}
      <section className="wp-chat">
        {!active ? (
          <div className="wp-empty">Pick a conversation to chat, or open an app from the Launchpad.</div>
        ) : (
          <>
            <div className="wp-chathead">
              <div className="flex" style={{ gap: 10, minWidth: 0 }}>
                <span className={`aico ${meta(active.channel).tone}`} style={{ width: 34, height: 34, borderRadius: 10 }}>{(() => { const I = meta(active.channel).icon; return <I size={15} />; })()}</span>
                <div style={{ minWidth: 0 }}>
                  <div className="strong" style={{ fontSize: 14 }}>{active.name}</div>
                  <div className="faint" style={{ fontSize: 11.5 }}>{meta(active.channel).label}{active.phone ? ` · ${active.phone}` : active.email ? ` · ${active.email}` : ""}</div>
                </div>
              </div>
              <div className="flex" style={{ gap: 7 }}>
                {active.contactId && <button onClick={openProfile} className="btn ghost sm"><ExternalLink size={13} /> Open profile</button>}
                <button onClick={() => setAssignOpen((o) => !o)} className={`btn sm ${assignOpen ? "teal" : "ghost"}`}><ListChecks size={13} /> Assign task</button>
              </div>
            </div>

            {assignOpen && (
              <form action={assignTask} className="wp-assign" onSubmit={() => setAssignOpen(false)}>
                <input name="title" placeholder={`Task from ${active.name}…`} autoFocus style={{ flex: 1, minWidth: 160 }} />
                <input type="hidden" name="from_name" value={active.name} />
                <select name="assignee_id" defaultValue=""><option value="">Assign to…</option>{team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
                <input type="date" name="due_on" style={{ width: 150 }} />
                <button className="btn teal sm" type="submit">Assign</button>
              </form>
            )}

            <div className="wp-msgs">
              {active.messages.map((msg: any) => (
                <div key={msg.id} className={`wp-bubble ${msg.direction === "out" ? "out" : "in"}`}>
                  {msg.subject && <div className="strong" style={{ fontSize: 12, marginBottom: 3 }}>{msg.subject}</div>}
                  <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{clip(msg.body || "", 600)}</div>
                  <div className="wp-bubble-meta">{msg.status === "queued" ? "queued · " : ""}{ago(msg.created_at)}</div>
                </div>
              ))}
            </div>

            <form action={sendChat} className="wp-composer" onSubmit={() => setDraft("")}>
              <input type="hidden" name="contact_id" value={active.contactId || ""} />
              <input type="hidden" name="channel" value={active.channel} />
              <input type="hidden" name="to" value={active.email || ""} />
              <textarea name="body" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`Message ${active.name} on ${meta(active.channel).label}…`} rows={2} />
              <div className="wp-composer-bar">
                <button type="button" onClick={doDraft} className="btn ghost sm" disabled={drafting}><Sparkles size={13} /> {drafting ? "Sasa is writing…" : "Sasa draft"}</button>
                <span className="flex" style={{ gap: 8 }}>
                  {active.channel !== "email" && <span className="faint" style={{ fontSize: 11 }}>queues until WhatsApp is connected</span>}
                  <button type="submit" className="btn teal sm"><Send size={13} /> {active.channel === "email" ? "Send" : "Queue"}</button>
                </span>
              </div>
            </form>
          </>
        )}
      </section>

      {/* RIGHT — tasks + open tabs */}
      <aside className="wp-rail wp-right">
        <div className="wp-railhead"><span className="flex" style={{ gap: 7 }}><ListChecks size={15} /> Tasks</span><span className="faint" style={{ fontSize: 12 }}>{tasks.length} open</span></div>
        <div className="wp-tasks">
          {tasks.length === 0 && <div className="faint" style={{ padding: 16, fontSize: 12.5 }}>No open tasks. Assign one from a conversation.</div>}
          {tasks.map((t) => (
            <a key={t.id} href="/tasks" className="wp-task">
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 12.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
                <span className="faint" style={{ fontSize: 10.5 }}>{teamName(t.assignee_id)}{t.due_on ? ` · due ${t.due_on}` : ""}</span>
              </span>
              <span className={`badge ${t.priority === "high" ? "red" : t.priority === "low" ? "gray" : "gold"}`} style={{ fontSize: 9.5 }}>{t.priority || "med"}</span>
            </a>
          ))}
        </div>
        <div className="wp-railhead" style={{ borderTop: "1px solid var(--line)" }}><span className="flex" style={{ gap: 7 }}><Layers size={15} /> Open tabs</span><span className="faint" style={{ fontSize: 12 }}>{tabs.length}</span></div>
        <div className="wp-openset">
          {tabs.length === 0 && <div className="faint" style={{ padding: 16, fontSize: 12.5 }}>Nothing open. <a href="/launchpad" className="linkbtn strong">Launchpad</a>.</div>}
          {tabs.map((tb) => (
            <button key={tb.href} className="wp-opentab" onClick={() => router.push(tb.href)}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tb.title}</span>
              <ChevronRight size={13} className="faint" />
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}
