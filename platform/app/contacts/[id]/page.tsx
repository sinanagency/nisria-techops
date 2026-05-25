import Shell from "../../../components/Shell";
import { Badge } from "../../../components/ui";
import { TabTitle } from "../../../components/tabs-context";
import { admin, money, date } from "../../../lib/supabase-admin";
import { cleanEmail } from "../../../lib/email-render";
import { emailContact } from "../actions";
import { Mail, DollarSign, Bot, MessageSquare, Send, Activity as ActIcon } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Contact360({ params }: { params: { id: string } }) {
  const db = admin();
  const id = params.id;
  const { data: contact } = await db.from("contacts").select("*").eq("id", id).single();
  const c: any = contact || {};

  const [{ data: msgs }, { data: events }] = await Promise.all([
    db.from("messages").select("id,channel,direction,subject,body,created_at,handled_by").eq("contact_id", id).order("created_at", { ascending: false }).limit(60),
    db.from("events").select("type,payload,created_at").eq("subject_id", id).order("created_at", { ascending: false }).limit(40),
  ]);

  // try to link to a donor by email for lifetime giving
  let donations: any[] = [];
  let donor: any = null;
  if (c.email) {
    const { data: d } = await db.from("donors").select("id,full_name,status").eq("email", c.email).maybeSingle();
    donor = d;
    if (d?.id) {
      const { data: dn } = await db.from("donations").select("amount,status,donated_at,campaign:campaigns(name)").eq("donor_id", d.id).order("donated_at", { ascending: false });
      donations = dn || [];
    }
  }
  const lifetime = donations.filter((d) => d.status === "succeeded").reduce((s, d) => s + Number(d.amount), 0);

  // unified timeline
  type T = { t: string; icon: any; aico: string; title: string; meta?: string; at: string };
  const timeline: T[] = [];
  for (const m of (msgs || []) as any[]) timeline.push({ t: "msg", icon: m.direction === "out" ? Mail : MessageSquare, aico: m.direction === "out" ? "teal" : "peri", title: `${m.direction === "out" ? "We replied" : "They wrote"}${m.subject ? `: ${m.subject}` : ""}`, meta: (m.body || "").slice(0, 90), at: m.created_at });
  for (const d of donations) timeline.push({ t: "don", icon: DollarSign, aico: "green", title: `Gift ${money(d.amount)}${d.campaign?.name ? ` to ${d.campaign.name}` : ""}`, meta: d.status, at: d.donated_at });
  for (const e of (events || []) as any[]) if (e.type?.startsWith("agent") || e.type?.startsWith("approval")) timeline.push({ t: "evt", icon: Bot, aico: "gold", title: e.type.replace(/\./g, " "), meta: e.payload?.category || "", at: e.created_at });
  timeline.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const name = c.name || (c.email || "Unknown").split("@")[0];

  // conversation thread: oldest first so the newest sits at the bottom by the composer
  const thread = [...((msgs || []) as any[])].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  return (
    <Shell title={name} sub={c.email || c.phone || "Contact"} action={donor && <Badge tone="teal">Donor</Badge>}>
      <TabTitle title={name} />
      <div className="grid" style={{ gridTemplateColumns: "1fr 1.6fr" }}>
        {/* profile + giving */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card card-pad">
            <div className="flex" style={{ marginBottom: 14 }}>
              <div className="avatar" style={{ width: 48, height: 48, fontSize: 18 }}>{name.charAt(0).toUpperCase()}</div>
              <div>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 17 }}>{name}</div>
                <div className="muted" style={{ fontSize: 12.5 }}>{c.channel || "email"}</div>
              </div>
            </div>
            <div className="stack" style={{ gap: 8, fontSize: 13 }}>
              {c.email && <div className="between"><span className="muted">Email</span><span>{c.email}</span></div>}
              {c.phone && <div className="between"><span className="muted">Phone</span><span>{c.phone}</span></div>}
              <div className="between"><span className="muted">Messages</span><span>{(msgs || []).length}</span></div>
            </div>
          </div>

          <div className="feature teal">
            <div className="ficon" style={{ background: "var(--teal)", color: "#fff" }}><DollarSign size={20} /></div>
            <div className="ftitle">{money(lifetime)}</div>
            <div className="fmeta">lifetime giving · {donations.length} gifts</div>
          </div>

          {donations.length > 0 && (
            <div className="card">
              <div className="card-h">Gifts</div>
              <div style={{ padding: "4px 16px" }}>
                {donations.slice(0, 8).map((d, i) => (
                  <div key={i} className="between" style={{ padding: "9px 0", borderTop: i ? "1px solid var(--line)" : "none", fontSize: 13 }}>
                    <span>{date(d.donated_at)}</span>
                    <span className="strong">{money(d.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* timeline */}
        <div className="card">
          <div className="card-h"><span className="flex"><ActIcon size={15} /> Timeline</span><Badge tone="gray">{timeline.length}</Badge></div>
          <div style={{ padding: "6px 18px 14px" }}>
            {timeline.length === 0 && <div className="empty">No history yet.</div>}
            {timeline.map((x, i) => (
              <div key={i} className="actrow">
                <span className={`aico ${x.aico}`}><x.icon size={15} /></span>
                <div className="abody">
                  <div className="atitle">{x.title}</div>
                  {x.meta && <div className="ameta">{x.meta}</div>}
                </div>
                <span className="aright">{date(x.at)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* conversation thread + inline compose (spans both columns) */}
        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <div className="card-h">
            <span className="flex"><MessageSquare size={15} /> Conversation</span>
            <Badge tone="gray">{thread.length}</Badge>
          </div>
          <div style={{ padding: "16px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
            {thread.length === 0 && <div className="empty">No messages yet. Start the conversation below.</div>}
            {thread.map((m: any) => {
              const out = m.direction === "out";
              return (
                <div
                  key={m.id}
                  style={{ display: "flex", flexDirection: "column", alignItems: out ? "flex-end" : "flex-start", maxWidth: "100%" }}
                >
                  <div
                    style={{
                      maxWidth: "78%",
                      padding: "11px 14px",
                      borderRadius: 15,
                      fontSize: 13.5,
                      lineHeight: 1.55,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      background: out ? "var(--teal)" : "var(--canvas)",
                      color: out ? "#fff" : "var(--ink)",
                      border: out ? "0" : "1px solid var(--line)",
                      borderBottomRightRadius: out ? 5 : 15,
                      borderBottomLeftRadius: out ? 15 : 5,
                    }}
                  >
                    {m.subject && <div style={{ fontWeight: 600, marginBottom: 4 }}>{m.subject}</div>}
                    <div>{cleanEmail(m.body || "") || <span className="faint">(no content)</span>}</div>
                  </div>
                  <div className="faint" style={{ fontSize: 11, marginTop: 4, padding: "0 4px" }}>
                    {out ? `${m.handled_by === "ai" ? "Sasa" : "Nur"} · ${m.channel || "email"}` : name} · {date(m.created_at)}
                  </div>
                </div>
              );
            })}
          </div>

          {c.email ? (
            <form action={emailContact} style={{ borderTop: "1px solid var(--line)", padding: "16px 22px", display: "flex", flexDirection: "column", gap: 10 }}>
              <input type="hidden" name="to" value={c.email} />
              <input type="hidden" name="contact_id" value={id} />
              <div className="between" style={{ gap: 10 }}>
                <span className="muted" style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>Email {name}</span>
                <span className="faint" style={{ fontSize: 12 }}>{c.email}</span>
              </div>
              <input name="subject" placeholder="Subject" defaultValue="A note from Nisria" required />
              <textarea name="body" placeholder={`Write to ${name}…`} rows={4} required style={{ resize: "vertical" }} />
              <div className="flex" style={{ justifyContent: "flex-end" }}>
                <button type="submit" className="btn teal"><Send size={14} /> Send email</button>
              </div>
            </form>
          ) : (
            <div className="empty" style={{ borderTop: "1px solid var(--line)" }}>No email on file for this contact.</div>
          )}
        </div>
      </div>
    </Shell>
  );
}
