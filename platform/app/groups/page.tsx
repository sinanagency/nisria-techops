import Shell from "../../components/Shell";
import { Badge } from "../../components/ui";
import { TabTitle } from "../../components/tabs-context";
import { admin, date } from "../../lib/supabase-admin";
import { postToGroupAction } from "../team/actions";
import GroupLink from "../../components/GroupLink";
import Link from "next/link";
import { Users, Send, ChevronLeft, ChevronRight, ChevronDown, Paperclip } from "lucide-react";

export const dynamic = "force-dynamic";

const t = (s: string) => new Date(s).getTime();

// Groups: one WhatsApp group at a time, read top-to-bottom like a chat (oldest up,
// newest by the composer), every message attributed to who sent it (click to their
// profile to assign or follow up). Switch groups with the dropdown or the
// left/right arrows. Posting queues a group.send the bot delivers.
export default async function Groups({ searchParams }: { searchParams: { g?: string } }) {
  const db = admin();

  // distinct groups + last activity (recent window covers all of them)
  const { data: recent } = await db
    .from("messages").select("account,created_at")
    .eq("channel", "whatsapp").eq("sender_type", "group")
    .order("created_at", { ascending: false }).limit(800);
  const lastByGroup = new Map<string, string>();
  for (const m of (recent || []) as any[]) {
    const name = m.account || "Unknown group";
    if (!lastByGroup.has(name)) lastByGroup.set(name, m.created_at);
  }
  const groups = [...lastByGroup.entries()].sort((a, b) => t(b[1]) - t(a[1])).map(([name, last]) => ({ name, last }));

  if (groups.length === 0) {
    return (
      <Shell title="Groups" sub="The team WhatsApp groups">
        <TabTitle title="Groups" />
        <GroupLink />
        <div className="card card-pad"><div className="empty">No group messages yet. Once the group number is linked and added to the team groups, conversations appear here.</div></div>
      </Shell>
    );
  }

  const selected = (searchParams.g && groups.find((g) => g.name === searchParams.g)?.name) || groups[0].name;
  const idx = groups.findIndex((g) => g.name === selected);
  const prev = groups[idx - 1];
  const next = groups[idx + 1];

  // newest 300 of the selected group, shown oldest-first (chat order)
  const { data: rawMsgs } = await db
    .from("messages").select("id,body,direction,created_at,contact_id,contact:contacts(id,name),asset:assets(storage_path,mime)")
    .eq("channel", "whatsapp").eq("sender_type", "group").eq("account", selected)
    .order("created_at", { ascending: false }).limit(300);
  const msgs = ((rawMsgs || []) as any[]).reverse();

  // map sender name -> team profile so the name links to where you assign/follow up
  const { data: team } = await db.from("team_members").select("id,name");
  const teamByName = new Map<string, string>();
  for (const m of (team || []) as any[]) teamByName.set(String(m.name || "").toLowerCase(), m.id);
  const profileHref = (c: any): string | null => {
    if (!c) return null;
    const tid = teamByName.get(String(c.name || "").toLowerCase());
    if (tid) return `/team/${tid}`;
    return c.id ? `/contacts/${c.id}` : null;
  };

  // group consecutive messages by the same sender (WhatsApp style)
  type Run = { name: string; href: string | null; out: boolean; items: any[] };
  const runs: Run[] = [];
  for (const m of msgs) {
    const c = Array.isArray(m.contact) ? m.contact[0] : m.contact;
    const out = m.direction === "out";
    const name = out ? "Sasa" : (c?.name || "Unknown");
    const href = out ? null : profileHref(c);
    const last = runs[runs.length - 1];
    if (last && last.name === name && last.out === out) last.items.push(m);
    else runs.push({ name, href, out, items: [m] });
  }

  return (
    <Shell title="Groups" sub="Team WhatsApp groups, read and post here">
      <TabTitle title={selected} />
      <GroupLink />

      {/* group switcher: prev arrow, dropdown, next arrow */}
      <div className="flex" style={{ alignItems: "center", gap: 8, marginBottom: 12 }}>
        <Link href={prev ? `/groups?g=${encodeURIComponent(prev.name)}` : "#"} aria-label="Previous group"
          className="pill" style={{ padding: 8, opacity: prev ? 1 : 0.35, pointerEvents: prev ? "auto" : "none" }}><ChevronLeft size={16} /></Link>
        <details className="card" style={{ flex: 1 }}>
          <summary style={{ listStyle: "none", cursor: "pointer", padding: "11px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span className="flex" style={{ gap: 8, fontWeight: 700 }}><Users size={16} /> {selected}</span>
            <span className="flex" style={{ gap: 8 }}><Badge tone="gray">last {date(groups[idx].last)}</Badge><ChevronDown size={15} /></span>
          </summary>
          <div style={{ borderTop: "1px solid var(--line)", padding: 6 }}>
            {groups.map((g) => (
              <Link key={g.name} href={`/groups?g=${encodeURIComponent(g.name)}`} className="actrow" style={{ textDecoration: "none", color: "inherit", borderRadius: 8, background: g.name === selected ? "var(--canvas)" : undefined }}>
                <span className="aico teal"><Users size={14} /></span>
                <div className="abody"><div className="atitle">{g.name}</div><div className="ameta">last {date(g.last)}</div></div>
              </Link>
            ))}
          </div>
        </details>
        <Link href={next ? `/groups?g=${encodeURIComponent(next.name)}` : "#"} aria-label="Next group"
          className="pill" style={{ padding: 8, opacity: next ? 1 : 0.35, pointerEvents: next ? "auto" : "none" }}><ChevronRight size={16} /></Link>
      </div>

      {/* the chat: oldest at top, newest by the composer */}
      <div className="card">
        <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 14, maxHeight: "62vh", overflowY: "auto" }}>
          {runs.length === 0 && <div className="empty">No messages in this group yet.</div>}
          {runs.map((r, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: r.out ? "flex-end" : "flex-start", gap: 3 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: r.out ? "var(--teal)" : "var(--ink)" }}>
                {r.href ? <Link href={r.href} style={{ color: "inherit", textDecoration: "none" }}>{r.name}</Link> : r.name}
              </div>
              {r.items.map((m: any) => {
                const asset = Array.isArray(m.asset) ? m.asset[0] : m.asset;
                const isImg = asset && String(asset.mime || "").startsWith("image/");
                return (
                  <div key={m.id} style={{ maxWidth: "76%", background: r.out ? "var(--teal)" : "var(--surface)", color: r.out ? "#fff" : "var(--ink)", border: r.out ? "none" : "1px solid var(--line)", borderRadius: 12, padding: "8px 12px" }}>
                    {m.body && <div style={{ fontSize: 13.5, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.body}</div>}
                    {asset && (isImg ? (
                      <a href={`/api/asset?path=${encodeURIComponent(asset.storage_path)}`}>
                        <img src={`/api/asset?path=${encodeURIComponent(asset.storage_path)}`} alt="attachment" style={{ maxWidth: 220, borderRadius: 8, marginTop: 6, display: "block" }} />
                      </a>
                    ) : (
                      <a href={`/api/asset?path=${encodeURIComponent(asset.storage_path)}`} style={{ color: "inherit", fontSize: 12.5, marginTop: 6, display: "inline-flex", gap: 5, alignItems: "center" }}><Paperclip size={12} /> attachment</a>
                    ))}
                    <div style={{ fontSize: 10.5, opacity: 0.6, marginTop: 3, textAlign: "right" }}>{date(m.created_at)}</div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {/* composer pinned under the chat */}
        <form action={postToGroupAction} className="flex" style={{ gap: 8, padding: "12px 18px", borderTop: "1px solid var(--line)" }}>
          <input type="hidden" name="group" value={selected} />
          <input name="text" placeholder={`Post to ${selected}...`} required style={{ flex: 1, padding: "10px 14px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface)", fontFamily: "var(--font-body)", fontSize: 13.5 }} />
          <button type="submit" className="btn"><Send size={14} /> Post</button>
        </form>
      </div>
    </Shell>
  );
}
