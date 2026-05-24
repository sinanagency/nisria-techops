import Shell from "../../components/Shell";
import { Badge } from "../../components/ui";
import { admin, date } from "../../lib/supabase-admin";
import { cleanEmail, snippet, isIndividual } from "../../lib/email-render";
import { sendReply } from "./actions";
import { decideApproval } from "../approvals/actions";
import { Sparkles, Send, Mail, MessageCircle, Hash } from "lucide-react";

export const dynamic = "force-dynamic";

function timeShort(iso: string) {
  const d = new Date(iso); const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const FILTERS = [
  { k: "all", label: "All", icon: Mail },
  { k: "nisria", label: "Nisria · sasa@", icon: Mail },
  { k: "maisha", label: "Maisha · maisha@", icon: Mail },
  { k: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { k: "social", label: "Social", icon: Hash },
];

function matchFilter(m: any, f: string): boolean {
  if (f === "all" || !f) return true;
  if (f === "nisria") return m.account === "sasa@nisria.co";
  if (f === "maisha") return m.account === "maisha@nisria.co";
  if (f === "whatsapp") return m.channel === "whatsapp";
  if (f === "social") return ["instagram", "facebook", "social", "x", "linkedin"].includes(m.channel);
  return true;
}

export default async function Inbox({ searchParams }: { searchParams: { c?: string; f?: string } }) {
  const db = admin();
  const f = searchParams.f || "all";
  const [{ data: msgs }, { data: aps }] = await Promise.all([
    db.from("messages").select("id,contact_id,channel,account,sender_type,direction,subject,body,status,created_at,contact:contacts(id,name,email,channel)").order("created_at", { ascending: false }).limit(500),
    db.from("approvals").select("id,kind,proposed,context,lane,status,created_at").eq("status", "pending").eq("kind", "email_reply"),
  ]);

  const filtered = ((msgs || []) as any[]).filter((m) => matchFilter(m, f));
  const byContact = new Map<string, any>();
  for (const m of filtered) {
    const cid = m.contact_id || "none";
    if (!byContact.has(cid)) byContact.set(cid, { cid, contact: m.contact, last: m, count: 0, unread: 0, account: m.account, channel: m.channel });
    const conv = byContact.get(cid);
    conv.count++;
    if (m.direction === "in" && (m.status === "new" || m.status === "drafted")) conv.unread++;
  }
  const convs = [...byContact.values()].sort((a, b) => new Date(b.last.created_at).getTime() - new Date(a.last.created_at).getTime());

  const selected = searchParams.c || convs[0]?.cid;
  const thread = ((msgs || []) as any[]).filter((m) => (m.contact_id || "none") === selected).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const sel = byContact.get(selected) || (selected ? { cid: selected, contact: thread[0]?.contact, count: thread.length } : null);
  const draft = (aps || []).find((a: any) => a.context?.contact_id === selected);
  const toAddr = sel?.contact?.email || "";
  const individual = isIndividual(toAddr, thread[thread.length - 1]?.sender_type);
  const newCount = convs.reduce((s, c) => s + c.unread, 0);

  const acctLabel = (m: any) => m?.account === "maisha@nisria.co" ? "Maisha" : m?.account === "sasa@nisria.co" ? "Nisria" : (m?.channel && m.channel !== "email" ? m.channel : "");

  return (
    <Shell title="Inbox" sub={`${convs.length} conversations · ${newCount} need attention`}>
      {/* filters */}
      <div className="flex wrap" style={{ marginBottom: 14, gap: 7 }}>
        {FILTERS.map((x) => (
          <a key={x.k} href={`/inbox?f=${x.k}`} className={`pill ${f === x.k ? "on" : ""}`}>
            <x.icon size={13} /> {x.label}
          </a>
        ))}
        <a href="/team" className="pill" style={{ marginLeft: "auto" }} title="Connect another mailbox or channel">+ Add account</a>
      </div>

      <div className="mail">
        <div className="mail-list">
          {convs.length === 0 && <div className="empty">Nothing here{f !== "all" ? " for this filter" : ""}.</div>}
          {convs.map((c) => {
            const name = c.contact?.name || (c.contact?.email || "Unknown").split("@")[0];
            const active = c.cid === selected;
            const al = acctLabel(c.last);
            return (
              <a key={c.cid} href={`/inbox?f=${f}&c=${c.cid}`} className={`mail-row ${active ? "active" : ""} ${c.unread ? "unread" : ""}`}>
                <div className="mr-top">
                  <span className="mr-from">{name}</span>
                  <span className="mr-time">{timeShort(c.last.created_at)}</span>
                </div>
                <div className="mr-subj">{c.last.subject || "(no subject)"}</div>
                <div className="mr-snip">{snippet(c.last.body || "", 72)}</div>
                <div className="flex" style={{ marginTop: 6, gap: 6 }}>
                  {c.unread > 0 && <Badge tone="gold">{c.unread} new</Badge>}
                  {al && <span className={`chip ${al === "Maisha" ? "maisha" : "nisria"}`}><span className="bdot" /> {al}</span>}
                </div>
              </a>
            );
          })}
        </div>

        <div className="mail-read">
          {!sel && <div className="empty">Select a conversation.</div>}
          {sel && (
            <>
              <div className="between">
                <div>
                  <div className="mr-h">{sel.contact?.name || (toAddr || "Unknown").split("@")[0]}</div>
                  <div className="mr-meta">{toAddr || "—"} · {sel.count} messages{acctLabel(sel.last || thread[0]) ? ` · ${acctLabel(sel.last || thread[0])}` : ""}</div>
                </div>
                {individual && selected !== "none" && <a className="pill" href={`/contacts/${selected}`}>View profile</a>}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 18, marginTop: 12 }}>
                {thread.map((m) => (
                  <div key={m.id} className="card" style={{ padding: 14, boxShadow: "none", background: m.direction === "out" ? "var(--teal-50)" : "var(--surface-2)", marginLeft: m.direction === "out" ? 40 : 0, marginRight: m.direction === "out" ? 0 : 40 }}>
                    <div className="between" style={{ marginBottom: 5 }}>
                      <span style={{ fontWeight: 600, fontSize: 12.5 }}>{m.direction === "out" ? "Nisria" : (sel.contact?.name || "Them")}{m.handled_by?.startsWith("agent") ? " · via Sasa" : ""}</span>
                      <span className="faint" style={{ fontSize: 11 }}>{date(m.created_at)}</span>
                    </div>
                    {m.subject && <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{m.subject}</div>}
                    <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--ink-2)", whiteSpace: "pre-wrap" }}>{cleanEmail(m.body || "").slice(0, 2500)}</div>
                  </div>
                ))}
              </div>

              {draft && (
                <form action={decideApproval} className="card" style={{ padding: 16, background: "var(--peri-50)", border: "1px solid var(--peri-100)", marginBottom: 14 }}>
                  <input type="hidden" name="id" value={draft.id} />
                  <div className="flex" style={{ marginBottom: 8 }}>
                    <Sparkles size={15} color="var(--peri-700)" />
                    <span style={{ fontWeight: 600, fontSize: 13, color: "var(--peri-700)" }}>Sasa drafted a reply</span>
                    {draft.lane === "escalate" && <Badge tone="red">Escalated</Badge>}
                  </div>
                  <input name="subject" defaultValue={draft.proposed?.subject || ""} style={{ marginBottom: 8, fontSize: 13 }} />
                  <textarea name="body" defaultValue={draft.proposed?.body || ""} rows={6} style={{ fontSize: 13, lineHeight: 1.6 }} />
                  <div className="flex" style={{ marginTop: 10 }}>
                    <button className="btn sm teal" name="decision" value="approve" type="submit"><Send size={13} /> Approve &amp; send</button>
                    <button className="btn sm ghost" name="decision" value="reject" type="submit" formNoValidate>Decline</button>
                  </div>
                </form>
              )}

              {!draft && individual && toAddr && (
                <form action={sendReply} className="card" style={{ padding: 16, boxShadow: "none" }}>
                  <input type="hidden" name="contact_id" value={selected} />
                  <input type="hidden" name="to" value={toAddr} />
                  <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Reply to {toAddr}</div>
                  <input name="subject" placeholder="Subject" defaultValue={`Re: ${thread[thread.length - 1]?.subject || ""}`} style={{ marginBottom: 8, fontSize: 13 }} />
                  <textarea name="body" placeholder="Write a reply…" rows={4} style={{ fontSize: 13 }} />
                  <div className="flex" style={{ marginTop: 10 }}>
                    <button className="btn sm" type="submit"><Send size={13} /> Send</button>
                  </div>
                </form>
              )}

              {!individual && !draft && (
                <div className="card" style={{ padding: 14, boxShadow: "none", background: "var(--surface-2)" }}>
                  <span className="muted" style={{ fontSize: 12.5 }}>Automated sender — no reply needed. Sasa extracts anything useful (donations, alerts) automatically.</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Shell>
  );
}
