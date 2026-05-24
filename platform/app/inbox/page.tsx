import Shell from "../../components/Shell";
import { Badge } from "../../components/ui";
import { admin, date } from "../../lib/supabase-admin";
import { sendReply } from "./actions";
import { decideApproval } from "../approvals/actions";
import { Sparkles, Send } from "lucide-react";

export const dynamic = "force-dynamic";

function timeShort(iso: string) {
  const d = new Date(iso); const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default async function Inbox({ searchParams }: { searchParams: { c?: string } }) {
  const db = admin();
  const [{ data: msgs }, { data: aps }] = await Promise.all([
    db.from("messages").select("id,contact_id,channel,direction,subject,body,status,created_at,contact:contacts(id,name,email,channel)").order("created_at", { ascending: false }).limit(400),
    db.from("approvals").select("id,kind,proposed,context,lane,status,created_at").eq("status", "pending").eq("kind", "email_reply"),
  ]);

  const byContact = new Map<string, any>();
  for (const m of (msgs || []) as any[]) {
    const cid = m.contact_id || "none";
    if (!byContact.has(cid)) byContact.set(cid, { cid, contact: m.contact, last: m, count: 0, unread: 0 });
    const conv = byContact.get(cid);
    conv.count++;
    if (m.direction === "in" && (m.status === "new" || m.status === "drafted")) conv.unread++;
  }
  const convs = [...byContact.values()].sort((a, b) => new Date(b.last.created_at).getTime() - new Date(a.last.created_at).getTime());

  const selected = searchParams.c || convs[0]?.cid;
  const thread = ((msgs || []) as any[]).filter((m) => (m.contact_id || "none") === selected).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const sel = byContact.get(selected);
  const draft = (aps || []).find((a: any) => a.context?.contact_id === selected);
  const toAddr = sel?.contact?.email || "";
  const newCount = convs.reduce((s, c) => s + c.unread, 0);

  return (
    <Shell title="Inbox" sub={`${convs.length} conversations · ${newCount} need attention`} action={<Badge tone="teal">sasa@ + maisha@</Badge>}>
      <div className="mail">
        <div className="mail-list">
          {convs.length === 0 && <div className="empty">No mail synced yet.</div>}
          {convs.map((c) => {
            const name = c.contact?.name || (c.contact?.email || "Unknown").split("@")[0];
            const active = c.cid === selected;
            return (
              <a key={c.cid} href={`/inbox?c=${c.cid}`} className={`mail-row ${active ? "active" : ""} ${c.unread ? "unread" : ""}`}>
                <div className="mr-top">
                  <span className="mr-from">{name}</span>
                  <span className="mr-time">{timeShort(c.last.created_at)}</span>
                </div>
                <div className="mr-subj">{c.last.subject || "(no subject)"}</div>
                <div className="mr-snip">{(c.last.body || "").replace(/\s+/g, " ").slice(0, 70)}</div>
                {c.unread > 0 && <div style={{ marginTop: 6 }}><Badge tone="gold">{c.unread} new</Badge></div>}
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
                  <div className="mr-meta">{toAddr} · {sel.count} messages</div>
                </div>
                {selected !== "none" && <a className="pill" href={`/contacts/${selected}`}>View profile</a>}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 18 }}>
                {thread.map((m) => (
                  <div key={m.id} className="card" style={{ padding: 14, boxShadow: "none", background: m.direction === "out" ? "var(--teal-50)" : "var(--surface-2)", marginLeft: m.direction === "out" ? 40 : 0, marginRight: m.direction === "out" ? 0 : 40 }}>
                    <div className="between" style={{ marginBottom: 5 }}>
                      <span style={{ fontWeight: 600, fontSize: 12.5 }}>{m.direction === "out" ? "Nisria" : (sel.contact?.name || "Them")}{m.handled_by?.startsWith("agent") ? " · via agent" : ""}</span>
                      <span className="faint" style={{ fontSize: 11 }}>{date(m.created_at)}</span>
                    </div>
                    {m.subject && <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 3 }}>{m.subject}</div>}
                    <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--ink-2)", whiteSpace: "pre-wrap" }}>{(m.body || "").slice(0, 1200)}</div>
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

              {!draft && toAddr && (
                <form action={sendReply} className="card" style={{ padding: 16, boxShadow: "none" }}>
                  <input type="hidden" name="contact_id" value={selected} />
                  <input type="hidden" name="to" value={toAddr} />
                  <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Reply to {toAddr}</div>
                  <input name="subject" placeholder="Subject" defaultValue={`Re: ${thread[thread.length - 1]?.subject || ""}`} style={{ marginBottom: 8, fontSize: 13 }} />
                  <textarea name="body" placeholder="Write a reply…" rows={4} style={{ fontSize: 13 }} />
                  <div className="flex" style={{ marginTop: 10 }}>
                    <button className="btn sm" type="submit"><Send size={13} /> Send</button>
                    <span className="faint" style={{ fontSize: 11.5 }}>Sasa drafts new inbound automatically. This sends now.</span>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </Shell>
  );
}
