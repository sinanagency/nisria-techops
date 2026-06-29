import Shell from "../../../components/Shell";
import { Badge, statusTone } from "../../../components/ui";
import { TabTitle } from "../../../components/tabs-context";
import { admin, money, date } from "../../../lib/supabase-admin";
import { cleanEmail, snippet } from "../../../lib/email-render";
import { emailContact } from "../actions";
import AiComposer from "../../../components/AiComposer";
import { Mail, Phone, Building2, DollarSign, Bot, MessageSquare, Activity as ActIcon, Tag } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Contact360({ params }: { params: { id: string } }) {
  const db = admin();
  const id = params.id;
  const { data: contact } = await db.from("contacts").select("*").eq("id", id).single();
  const c: any = contact || {};

  const [{ data: msgs }, { data: events }] = await Promise.all([
    db.from("messages").select("id,channel,direction,subject,body,created_at,handled_by,status").eq("contact_id", id).order("created_at", { ascending: false }),
    db.from("events").select("type,payload,created_at").eq("subject_id", id).order("created_at", { ascending: false }).limit(40),
  ]);

  // try to link to a donor by email for lifetime giving
  let donations: any[] = [];
  let donor: any = null;
  if (c.email) {
    const { data: d } = await db.from("donors").select("id,full_name,status").eq("email", c.email).maybeSingle();
    donor = d;
    if (d?.id) {
      const { data: dn } = await db.from("donations").select("amount,currency,status,donated_at,campaign:campaigns(name)").eq("donor_id", d.id).order("donated_at", { ascending: false });
      donations = dn || [];
    }
  }
  // Per-currency lifetime giving. KES and USD never blend (Currency law).
  const lifetimeByCur = donations
    .filter((d) => d.status === "succeeded")
    .reduce((m: Record<string, number>, d: any) => {
      const c = (d.currency || "USD").toUpperCase();
      m[c] = (m[c] || 0) + Number(d.amount || 0);
      return m;
    }, {});
  const lifetimeEntries = Object.entries(lifetimeByCur);

  // unified timeline. `amount` is kept separate from `title` so the money still
  // renders inside a <span.money> (blurrable) instead of being baked into a string.
  type T = { t: string; icon: any; aico: string; title: string; amount?: string; titleAfter?: string; meta?: string; at: string };
  const timeline: T[] = [];
  // M-2: a failed email is logged with status="failed"; show it as a failed send, not an
  // identical "We replied" bubble, so a bounce is never mistaken for a delivered reply.
  for (const m of (msgs || []) as any[]) { const failed = m.direction === "out" && m.status === "failed"; timeline.push({ t: "msg", icon: m.direction === "out" ? Mail : MessageSquare, aico: failed ? "gray" : m.direction === "out" ? "teal" : "peri", title: `${m.direction === "out" ? (failed ? "Send failed" : "We replied") : "They wrote"}${m.subject ? `: ${m.subject}` : ""}`, meta: snippet(m.body || "", 90), at: m.created_at }); }
  for (const d of donations) timeline.push({ t: "don", icon: DollarSign, aico: "green", title: "Gift ", amount: money(d.amount), titleAfter: d.campaign?.name ? ` to ${d.campaign.name}` : "", meta: d.status, at: d.donated_at });
  for (const e of (events || []) as any[]) if (e.type?.startsWith("agent") || e.type?.startsWith("approval")) timeline.push({ t: "evt", icon: Bot, aico: "gold", title: e.type.replace(/\./g, " "), meta: e.payload?.category || "", at: e.created_at });
  timeline.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const name = c.name || (c.email || "Unknown").split("@")[0];

  // conversation thread: oldest first so the newest sits at the bottom by the composer
  const thread = [...((msgs || []) as any[])].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  // contact status: a real field if set, else "Donor" when matched to a donor.
  const contactStatus: string | null = c.status || null;
  const tags: string[] = Array.isArray(c.tags) ? c.tags : [];

  // Details-rail attribute rows. Built once, rendered as a definition list so the
  // rail reads as the contact's "key attributes" pane. Only real fields appear.
  const attrs: { k: string; icon: any; v: React.ReactNode }[] = [];
  if (c.email) attrs.push({ k: "Email", icon: Mail, v: c.email });
  if (c.phone) attrs.push({ k: "Phone", icon: Phone, v: c.phone });
  if (c.org || c.organization || c.company) attrs.push({ k: "Organisation", icon: Building2, v: c.org || c.organization || c.company });
  attrs.push({ k: "Channel", icon: MessageSquare, v: c.channel || "email" });

  return (
    <Shell
      title={name}
      sub={c.email || c.phone || "Contact"}
      action={contactStatus ? <Badge tone={statusTone(contactStatus)}>{contactStatus}</Badge> : donor ? <Badge tone="teal">Donor</Badge> : undefined}
    >
      <TabTitle title={name} />

      {/* lead: name + status, as the record headline */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="flex" style={{ alignItems: "center", gap: 18, flexWrap: "wrap" }}>
          <div className="avatar" style={{ width: 56, height: 56, fontSize: 21, flexShrink: 0 }}>
            {name.charAt(0).toUpperCase()}
          </div>
          <div style={{ flex: "1 1 220px", minWidth: 0 }}>
            <div className="flex" style={{ alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 24, letterSpacing: "-0.02em", margin: 0 }}>
                {name}
              </h2>
              {contactStatus && <Badge tone={statusTone(contactStatus)}>{contactStatus}</Badge>}
              {donor && <Badge tone="teal">Donor</Badge>}
            </div>
            <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
              {c.channel || "email"}
              {c.email ? ` · ${c.email}` : c.phone ? ` · ${c.phone}` : ""}
            </div>
          </div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr 1.7fr", alignItems: "start" }}>
        {/* LEFT: details rail */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card">
            <div className="card-h">Details</div>
            <div className="stack" style={{ gap: 0, fontSize: 13, padding: "2px 16px 10px" }}>
              {attrs.map((a, i) => (
                <div
                  key={a.k}
                  className="between"
                  style={{ padding: "10px 0", borderTop: i ? "1px solid var(--line)" : "none" }}
                >
                  <span className="muted flex" style={{ gap: 7 }}><a.icon size={13} /> {a.k}</span>
                  <span style={{ textAlign: "right", maxWidth: "60%", overflowWrap: "anywhere" }}>{a.v}</span>
                </div>
              ))}
              <div
                className="between"
                style={{ padding: "10px 0", borderTop: "1px solid var(--line)" }}
              >
                <span className="muted flex" style={{ gap: 7 }}><MessageSquare size={13} /> Messages</span>
                <span className="strong disp2">{(msgs || []).length}</span>
              </div>
            </div>

            {tags.length > 0 && (
              <div style={{ padding: "0 16px 14px" }}>
                <div className="muted" style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 8 }}>Tags</div>
                <div className="flex" style={{ flexWrap: "wrap", gap: 6 }}>
                  {tags.map((t, i) => (
                    <span key={i} className="chip"><Tag size={11} /> {t}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* lifetime giving, restated as a graphic feature stat for the rail */}
          {donor && (
            <div className="feature teal">
              <div className="ficon" style={{ background: "var(--teal)", color: "#fff" }}><DollarSign size={20} /></div>
              <div className="ftitle money">{lifetimeEntries.length === 0 ? money(0) : lifetimeEntries.map(([cur, v]) => money(v, cur)).join("  ·  ")}</div>
              <div className="fmeta">lifetime giving · {donations.length} {donations.length === 1 ? "gift" : "gifts"}</div>
            </div>
          )}

          {donations.length > 0 && (
            <div className="card">
              <div className="card-h">
                <span>Gifts</span>
                <Badge tone="gray">{donations.length}</Badge>
              </div>
              <div style={{ padding: "4px 16px" }}>
                {donations.slice(0, 8).map((d, i) => (
                  <div key={i} className="between" style={{ padding: "9px 0", borderTop: i ? "1px solid var(--line)" : "none", fontSize: 13 }}>
                    <span>{date(d.donated_at)}</span>
                    <span className="strong money">{money(d.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: conversation is the hero, with the activity timeline beneath */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* conversation thread + inline compose */}
          <div className="card">
            <div className="card-h">
              <span className="flex"><MessageSquare size={15} /> Conversation</span>
              <Badge tone="gray">{thread.length}</Badge>
            </div>
            <div style={{ padding: "16px 22px", display: "flex", flexDirection: "column", gap: 12, maxHeight: 460, overflowY: "auto" }}>
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
              <AiComposer
                action={emailContact}
                hidden={{ to: c.email, contact_id: id }}
                recipientLabel={`Email ${name}`}
                recipientEmail={c.email}
                defaultSubject="A note from Nisria"
                bodyPlaceholder={`Write to ${name}…`}
                subjectRequired
                bodyRequired
                allowAccountPick
              />
            ) : (
              <div className="empty" style={{ borderTop: "1px solid var(--line)" }}>No email on file for this contact.</div>
            )}
          </div>

          {/* activity timeline, as a vertical timeline beneath the conversation */}
          <div className="card">
            <div className="card-h">
              <span className="flex"><ActIcon size={15} /> Activity timeline</span>
              <Badge tone="gray">{timeline.length}</Badge>
            </div>
            <div style={{ padding: "8px 18px 16px" }}>
              {timeline.length === 0 && <div className="empty">No history yet.</div>}
              <div className="tl">
                {timeline.map((x, i) => (
                  <div key={i} className="tl-row" style={{ display: "flex", gap: 14, position: "relative" }}>
                    {/* spine + node */}
                    <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                      <span className={`aico ${x.aico}`} style={{ width: 34, height: 34, borderRadius: 11, display: "grid", placeItems: "center", zIndex: 1 }}>
                        <x.icon size={15} />
                      </span>
                      {i < timeline.length - 1 && (
                        <span
                          aria-hidden
                          style={{ flex: 1, width: 2, background: "var(--line)", marginTop: 2, marginBottom: 2, minHeight: 14 }}
                        />
                      )}
                    </div>
                    {/* body */}
                    <div className="abody" style={{ paddingBottom: i < timeline.length - 1 ? 18 : 2, minWidth: 0 }}>
                      <div className="between" style={{ alignItems: "baseline", gap: 10 }}>
                        <div className="atitle">
                          {x.title}
                          {x.amount && <span className="money">{x.amount}</span>}
                          {x.titleAfter}
                        </div>
                        <span className="aright">{date(x.at)}</span>
                      </div>
                      {x.meta && <div className="ameta">{x.meta}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
