import Shell from "../../components/Shell";
import { Badge } from "../../components/ui";
import { admin } from "../../lib/supabase-admin";
import { aiReply, closeThread } from "./actions";

export const dynamic = "force-dynamic";

export default async function Inbox() {
  const db = admin();
  const { data: msgs } = await db.from("messages").select("*,contact:contacts(name,channel,phone,email)").order("created_at", { ascending: true }).limit(400);
  const all = msgs || [];

  // group into threads by contact_id
  const threads = new Map<string, any[]>();
  for (const m of all) {
    const k = m.contact_id || "none";
    if (!threads.has(k)) threads.set(k, []);
    threads.get(k)!.push(m);
  }
  const open = [...threads.entries()].filter(([, ms]) => ms.some((m: any) => m.status !== "closed"));
  const newCount = all.filter((m: any) => m.status === "new").length;

  return (
    <Shell title="Inbox" sub={`Omnichannel · WhatsApp + Email · ${newCount} new`} action={<Badge tone="yellow">AI can auto-reply</Badge>}>
      <div className="grid" style={{ gridTemplateColumns: "1fr", gap: 14 }}>
        {open.length === 0 && <div className="card"><div className="empty">No open conversations.</div></div>}
        {open.map(([cid, ms]) => {
          const c = ms[0].contact;
          const lastIn = [...ms].reverse().find((m: any) => m.direction === "in");
          return (
            <div className="card" key={cid}>
              <div className="card-h">
                <span className="flex">
                  <strong>{c?.name || "Unknown"}</strong>
                  <Badge tone={c?.channel === "email" ? "blue" : "green"}>{c?.channel || ms[0].channel}</Badge>
                  <span className="muted" style={{ fontSize: 12 }}>{c?.phone || c?.email || ""}</span>
                </span>
                <form action={closeThread}><input type="hidden" name="contact_id" value={cid} /><button className="pill" type="submit">Close</button></form>
              </div>
              <div className="card-pad" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {ms.map((m: any) => (
                  <div key={m.id} className={`bubble ${m.direction === "out" ? "user" : "ai"}`} style={{ maxWidth: "82%", alignSelf: m.direction === "out" ? "flex-end" : "flex-start" }}>
                    {m.body}
                    {m.handled_by === "ai" && m.direction === "out" && <div style={{ fontSize: 10.5, opacity: .7, marginTop: 4 }}>✦ AI reply</div>}
                  </div>
                ))}
                {lastIn && lastIn.status !== "replied" && lastIn.status !== "closed" && (
                  <form action={aiReply} style={{ alignSelf: "flex-start", marginTop: 4 }}>
                    <input type="hidden" name="id" value={lastIn.id} />
                    <input type="hidden" name="contact_id" value={cid} />
                    <input type="hidden" name="channel" value={lastIn.channel} />
                    <button className="btn yellow" type="submit">Reply with AI ✦</button>
                  </form>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>
        Live two-way WhatsApp + email connect through n8n once the WhatsApp Business API + email inbox are linked. The AI reply engine works now (drafts + logs the response here).
      </div>
    </Shell>
  );
}
