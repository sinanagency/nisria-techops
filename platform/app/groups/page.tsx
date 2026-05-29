import Shell from "../../components/Shell";
import { Badge } from "../../components/ui";
import { TabTitle } from "../../components/tabs-context";
import { admin, date } from "../../lib/supabase-admin";
import { postToGroupAction } from "../team/actions";
import GroupLink from "../../components/GroupLink";
import { Users, Send, MessageSquare, Smartphone, Bot } from "lucide-react";

export const dynamic = "force-dynamic";

// The Groups surface: where the team's WhatsApp groups live in the portal. Read
// what is happening in each group, and post into it (the message is queued and
// the group bot delivers it, the portal never touches WhatsApp directly).
export default async function Groups() {
  const db = admin();

  // recent group traffic (group messages are tagged sender_type='group', the
  // group name in `account`). Pull recent, fold per group, newest first.
  const { data: rows } = await db
    .from("messages").select("body,account,direction,created_at,handled_by")
    .eq("channel", "whatsapp").eq("sender_type", "group")
    .order("created_at", { ascending: false }).limit(600);
  const msgs = (rows || []) as any[];

  const groups = new Map<string, { name: string; last: string; recent: any[] }>();
  for (const m of msgs) {
    const name = m.account || "Unknown group";
    if (!groups.has(name)) groups.set(name, { name, last: m.created_at, recent: [] });
    const g = groups.get(name)!;
    if (g.recent.length < 10) g.recent.push(m);
  }
  const groupList = Array.from(groups.values());

  // outbox: anything queued/sending for the group bot, and last delivery
  const { count: queued } = await db.from("jobs").select("id", { count: "exact", head: true }).eq("kind", "group.send").in("status", ["queued", "sending"]);
  const { data: lastIn } = await db.from("messages").select("created_at").eq("sender_type", "group").order("created_at", { ascending: false }).limit(1);
  const botLastSeen = lastIn?.[0]?.created_at || null;

  return (
    <Shell
      title="Groups"
      sub="The team WhatsApp groups, read and post from here"
      action={<Badge tone="gray">{groupList.length} groups</Badge>}
    >
      <TabTitle title="Groups" />

      {/* live link panel: scannable QR for the group number, auto-refreshing */}
      <GroupLink />

      {/* connections: the two numbers and how the team is reached */}
      <div className="grid cols-2" style={{ marginBottom: 16 }}>
        <div className="card card-pad">
          <div className="flex" style={{ gap: 10, marginBottom: 6 }}>
            <span className="aico teal"><Bot size={16} /></span>
            <div><div style={{ fontWeight: 700 }}>Group bot</div><div className="muted" style={{ fontSize: 12.5 }}>userbot, the team's groups</div></div>
          </div>
          <div className="muted" style={{ fontSize: 13 }}>
            {botLastSeen ? <>Last group activity {date(botLastSeen)}.</> : "No group activity yet. Link the number to go live."} {queued ? `${queued} message(s) queued to send.` : "Outbox clear."}
          </div>
        </div>
        <div className="card card-pad">
          <div className="flex" style={{ gap: 10, marginBottom: 6 }}>
            <span className="aico gold"><Smartphone size={16} /></span>
            <div><div style={{ fontWeight: 700 }}>727 line</div><div className="muted" style={{ fontSize: 12.5 }}>Nur and Taona only</div></div>
          </div>
          <div className="muted" style={{ fontSize: 13 }}>Your private line to feed the brain and run admin. Never messages the team.</div>
        </div>
      </div>

      {groupList.length === 0 ? (
        <div className="card card-pad"><div className="empty">No group messages yet. Once the group bot is linked and added to the team groups, conversations appear here.</div></div>
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          {groupList.map((g) => (
            <div key={g.name} className="card">
              <div className="card-h">
                <span className="flex"><Users size={15} /> {g.name}</span>
                <Badge tone="gray">last {date(g.last)}</Badge>
              </div>
              <div style={{ padding: "6px 18px 4px" }}>
                {g.recent.map((m, i) => (
                  <div key={i} className="actrow">
                    <span className={`aico ${m.direction === "out" ? "gold" : "teal"}`}>{m.direction === "out" ? <Bot size={14} /> : <MessageSquare size={14} />}</span>
                    <div className="abody"><div className="atitle" style={{ fontWeight: 400, whiteSpace: "pre-wrap" }}>{String(m.body || "").slice(0, 300)}</div></div>
                    <span className="aright">{date(m.created_at)}</span>
                  </div>
                ))}
              </div>
              {/* compose: queues a group.send the bot delivers */}
              <form action={postToGroupAction} className="flex" style={{ gap: 8, padding: "10px 18px 16px", borderTop: "1px solid var(--line)" }}>
                <input type="hidden" name="group" value={g.name} />
                <input name="text" placeholder={`Post to ${g.name}...`} required style={{ flex: 1, padding: "9px 13px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface)", fontFamily: "var(--font-body)", fontSize: 13.5 }} />
                <button type="submit" className="btn"><Send size={14} /> Post</button>
              </form>
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}
