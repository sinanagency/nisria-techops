import Shell from "../../../components/Shell";
import { Badge } from "../../../components/ui";
import { TabTitle } from "../../../components/tabs-context";
import { admin, money, date } from "../../../lib/supabase-admin";
import { Mail, DollarSign, Bot, MessageSquare, Phone, Activity as ActIcon, Tag } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Donor360({ params }: { params: { id: string } }) {
  const db = admin();
  const id = params.id;

  const { data: donor } = await db.from("donors").select("*").eq("id", id).single();
  const d: any = donor || {};

  // gifts for this donor
  const { data: giftRows } = await db
    .from("donations")
    .select("amount,status,donated_at,campaign:campaigns(name)")
    .eq("donor_id", id)
    .order("donated_at", { ascending: false });
  const gifts: any[] = giftRows || [];

  // matched emails: find contact(s) sharing this donor's email, then their messages
  let msgs: any[] = [];
  if (d.email) {
    const { data: contactRows } = await db.from("contacts").select("id").eq("email", d.email);
    const contactIds = (contactRows || []).map((c: any) => c.id).filter(Boolean);
    if (contactIds.length) {
      const { data: m } = await db
        .from("messages")
        .select("id,direction,subject,body,created_at,handled_by")
        .in("contact_id", contactIds)
        .order("created_at", { ascending: false })
        .limit(60);
      msgs = m || [];
    }
  }

  // agent / approval events targeting this donor
  const { data: eventRows } = await db
    .from("events")
    .select("type,payload,created_at")
    .eq("subject_id", id)
    .order("created_at", { ascending: false })
    .limit(40);
  const events: any[] = eventRows || [];

  const succeeded = gifts.filter((g) => g.status === "succeeded");
  const lifetime = Number(d.lifetime_value) || succeeded.reduce((s, g) => s + Number(g.amount || 0), 0);

  // unified timeline
  type T = { icon: any; aico: string; title: string; meta?: string; at: string };
  const timeline: T[] = [];
  for (const m of msgs)
    timeline.push({
      icon: m.direction === "out" ? Mail : MessageSquare,
      aico: m.direction === "out" ? "teal" : "peri",
      title: `${m.direction === "out" ? "We replied" : "They wrote"}${m.subject ? `: ${m.subject}` : ""}`,
      meta: (m.body || "").slice(0, 90),
      at: m.created_at,
    });
  for (const g of gifts)
    timeline.push({
      icon: DollarSign,
      aico: "green",
      title: `Gift ${money(g.amount)}${g.campaign?.name ? ` to ${g.campaign.name}` : ""}`,
      meta: g.status,
      at: g.donated_at,
    });
  for (const e of events)
    if (e.type?.startsWith("agent") || e.type?.startsWith("approval"))
      timeline.push({
        icon: Bot,
        aico: "gold",
        title: e.type.replace(/\./g, " "),
        meta: e.payload?.category || "",
        at: e.created_at,
      });
  timeline.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const donorName = d.full_name || (d.email || "Unknown donor").split("@")[0];
  const tags: string[] = Array.isArray(d.tags) ? d.tags : [];

  return (
    <Shell
      title={donorName}
      sub={d.email || d.phone || "Donor"}
      action={d.status && <Badge tone="teal">{d.status}</Badge>}
    >
      <TabTitle title={donorName} />
      <div className="grid" style={{ gridTemplateColumns: "1fr 1.6fr" }}>
        {/* profile + giving */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card card-pad">
            <div className="flex" style={{ marginBottom: 14 }}>
              <div className="avatar" style={{ width: 48, height: 48, fontSize: 18 }}>
                {donorName.charAt(0).toUpperCase()}
              </div>
              <div>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 17 }}>{donorName}</div>
                <div className="muted" style={{ fontSize: 12.5 }}>{d.type || "individual"}</div>
              </div>
            </div>
            <div className="stack" style={{ gap: 8, fontSize: 13 }}>
              {d.email && (
                <div className="between">
                  <span className="muted">Email</span>
                  <span>{d.email}</span>
                </div>
              )}
              {d.phone && (
                <div className="between">
                  <span className="muted">Phone</span>
                  <span>{d.phone}</span>
                </div>
              )}
              <div className="between">
                <span className="muted">Status</span>
                <span>{d.status || "—"}</span>
              </div>
              <div className="between">
                <span className="muted">Type</span>
                <span>{d.type || "—"}</span>
              </div>
              {d.source && (
                <div className="between">
                  <span className="muted">Source</span>
                  <span>{d.source}</span>
                </div>
              )}
              {d.country && (
                <div className="between">
                  <span className="muted">Country</span>
                  <span>{d.country}</span>
                </div>
              )}
            </div>
            {tags.length > 0 && (
              <div className="flex" style={{ flexWrap: "wrap", gap: 6, marginTop: 12 }}>
                {tags.map((t, i) => (
                  <span key={i} className="chip"><Tag size={11} /> {t}</span>
                ))}
              </div>
            )}
          </div>

          <div className="feature teal">
            <div className="ficon" style={{ background: "var(--teal)", color: "#fff" }}>
              <DollarSign size={20} />
            </div>
            <div className="ftitle">{money(lifetime)}</div>
            <div className="fmeta">lifetime giving · {gifts.length} gifts</div>
          </div>

          <div className="card">
            <div className="card-h">Gifts</div>
            {gifts.length > 0 ? (
              <div style={{ padding: "4px 16px" }}>
                {gifts.slice(0, 12).map((g, i) => (
                  <div
                    key={i}
                    className="between"
                    style={{ padding: "9px 0", borderTop: i ? "1px solid var(--line)" : "none", fontSize: 13 }}
                  >
                    <span>
                      {date(g.donated_at)}
                      {g.campaign?.name ? <span className="muted"> · {g.campaign.name}</span> : null}
                    </span>
                    <span className="strong">{money(g.amount)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty">No gifts recorded yet.</div>
            )}
          </div>
        </div>

        {/* timeline */}
        <div className="card">
          <div className="card-h">
            <span className="flex">
              <ActIcon size={15} /> Timeline
            </span>
            <Badge tone="gray">{timeline.length}</Badge>
          </div>
          <div style={{ padding: "6px 18px 14px" }}>
            {timeline.length === 0 && <div className="empty">No history yet.</div>}
            {timeline.map((x, i) => (
              <div key={i} className="actrow">
                <span className={`aico ${x.aico}`}>
                  <x.icon size={15} />
                </span>
                <div className="abody">
                  <div className="atitle">{x.title}</div>
                  {x.meta && <div className="ameta">{x.meta}</div>}
                </div>
                <span className="aright">{date(x.at)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Shell>
  );
}
