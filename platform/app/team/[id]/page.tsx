import Shell from "../../../components/Shell";
import { Badge, statusTone } from "../../../components/ui";
import { TabTitle } from "../../../components/tabs-context";
import { Money } from "../../../components/Money";
import TeamQuickActions from "../../../components/TeamQuickActions";
import TeamPayHistory from "../../../components/TeamPayHistory";
import { admin, date } from "../../../lib/supabase-admin";
import { setTaskStatus, setMemberStatus } from "../actions";
import {
  Mail, Phone, MapPin, Calendar, Briefcase, Tag, DollarSign, ListChecks,
  Bot, Activity as ActIcon, CheckCircle2, Circle, Clock, FileText, MessageSquare,
} from "lucide-react";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  staff: "Staff", tailor: "Tailor", volunteer: "Volunteer", contractor: "Contractor",
};
const PAY_TYPE_LABEL: Record<string, string> = {
  monthly: "monthly", piece: "per piece", hourly: "hourly", stipend: "stipend", none: "no pay",
};
const PAY_SUFFIX: Record<string, string> = {
  monthly: "/mo", piece: "/piece", hourly: "/hr", stipend: " stipend", none: "",
};
const STATUS_OPTS = ["active", "paused", "exited"];

// Human tenure from engagement_start.
function tenure(start: any): string | null {
  if (!start) return null;
  const d = new Date(start);
  if (isNaN(d.getTime())) return null;
  const months = Math.max(0, Math.floor((Date.now() - d.getTime()) / (30.44 * 86400e3)));
  if (months < 1) return "less than a month";
  if (months < 12) return `${months} month${months === 1 ? "" : "s"}`;
  const yrs = Math.floor(months / 12);
  const rem = months % 12;
  return `${yrs} year${yrs === 1 ? "" : "s"}${rem ? ` ${rem} mo` : ""}`;
}

export default async function TeamMember360({ params }: { params: { id: string } }) {
  const db = admin();
  const id = params.id;

  const { data: row } = await db.from("team_members").select("*").eq("id", id).single();
  const m: any = row || {};

  // tasks assigned to this member
  const { data: taskRows } = await db
    .from("tasks")
    .select("id,title,description,status,priority,due_on,created_at")
    .eq("assignee_id", id)
    .order("created_at", { ascending: false });
  const tasks: any[] = taskRows || [];

  // pay ledger
  const { data: payRows } = await db
    .from("team_payments")
    .select("id,amount,currency,pay_period,paid_at,status,note,created_at")
    .eq("team_member_id", id)
    .order("paid_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  const payments: any[] = payRows || [];

  // activity events for this member
  const { data: eventRows } = await db
    .from("events")
    .select("type,payload,created_at")
    .eq("subject_id", id)
    .eq("subject_type", "team_member")
    .order("created_at", { ascending: false })
    .limit(40);
  const events: any[] = eventRows || [];

  // this member's WhatsApp messages (group history backfill + future live). They
  // link via contact: matched either by name (the chat-history attribution) or by
  // phone (the live webhook). Union both, then pull their messages newest-first.
  const contactIds = new Set<string>();
  {
    const { data } = await db.from("contacts").select("id").eq("channel", "whatsapp").eq("name", m.name);
    (data || []).forEach((c: any) => contactIds.add(c.id));
  }
  if (m.phone) {
    const { data } = await db.from("contacts").select("id").eq("channel", "whatsapp").eq("phone", m.phone);
    (data || []).forEach((c: any) => contactIds.add(c.id));
  }
  let messages: any[] = [];
  let messageCount = 0;
  if (contactIds.size) {
    const { data: msgRows, count } = await db
      .from("messages")
      .select("id,body,account,created_at,direction", { count: "exact" })
      .in("contact_id", Array.from(contactIds))
      .eq("channel", "whatsapp")
      .order("created_at", { ascending: false })
      .limit(50);
    messages = msgRows || [];
    messageCount = count || 0;
  }

  // task breakdown: ongoing (in_progress), pending (todo|blocked), done
  const ongoing = tasks.filter((t) => t.status === "in_progress");
  const pending = tasks.filter((t) => t.status === "todo" || t.status === "blocked");
  const done = tasks.filter((t) => t.status === "done");

  const name = m.name || "Team member";
  const type = (m.member_type || "staff") as string;
  const tags: string[] = Array.isArray(m.tags) ? m.tags : [];
  const t = tenure(m.engagement_start);
  const paySuffix = m.pay_type ? PAY_SUFFIX[m.pay_type] ?? "" : "";

  // unified timeline: tasks + payments + events, newest first. Money stays in a
  // <Money> (blurrable) instead of being baked into a string.
  type TL = { icon: any; aico: string; title: string; amount?: number; currency?: string; titleAfter?: string; meta?: string; at: string };
  const timeline: TL[] = [];
  for (const tk of tasks)
    timeline.push({
      icon: tk.status === "done" ? CheckCircle2 : tk.status === "in_progress" ? Clock : Circle,
      aico: tk.status === "done" ? "green" : tk.status === "in_progress" ? "teal" : "gray",
      title: `Task ${tk.status === "done" ? "completed" : tk.status === "in_progress" ? "in progress" : "assigned"}: ${tk.title}`,
      meta: [tk.priority, tk.due_on ? `due ${date(tk.due_on)}` : null].filter(Boolean).join(" · "),
      at: tk.created_at,
    });
  for (const p of payments)
    timeline.push({
      icon: DollarSign,
      aico: "green",
      title: `Payment ${p.status} `,
      amount: p.amount,
      currency: p.currency,
      titleAfter: p.pay_period ? ` (${p.pay_period})` : "",
      meta: p.note || "",
      at: p.paid_at || p.created_at,
    });
  for (const e of events)
    timeline.push({
      icon: Bot,
      aico: "gold",
      title: String(e.type || "").replace(/\./g, " "),
      meta: e.payload?.status || e.payload?.title || "",
      at: e.created_at,
    });
  // fold this member's recent messages into the unified timeline
  for (const msg of messages.slice(0, 12))
    timeline.push({
      icon: MessageSquare,
      aico: "teal",
      title: String(msg.body || "").replace(/\s+/g, " ").slice(0, 120),
      meta: msg.account || "WhatsApp",
      at: msg.created_at,
    });
  timeline.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const Row = ({ icon: Icon, label, children }: { icon: any; label: string; children: React.ReactNode }) => (
    <div className="between" style={{ fontSize: 13, padding: "9px 0", borderTop: "1px solid var(--line)" }}>
      <span className="muted flex" style={{ gap: 7 }}><Icon size={13} /> {label}</span>
      <span style={{ textAlign: "right" }}>{children || "—"}</span>
    </div>
  );

  const TaskItem = ({ tk }: { tk: any }) => (
    <div className="actrow">
      <span className={`aico ${tk.status === "done" ? "green" : tk.status === "in_progress" ? "teal" : "gray"}`}>
        {tk.status === "done" ? <CheckCircle2 size={15} /> : tk.status === "in_progress" ? <Clock size={15} /> : <Circle size={15} />}
      </span>
      <div className="abody">
        <div className="atitle">{tk.title}</div>
        <div className="ameta">
          {[tk.priority, tk.due_on ? `due ${date(tk.due_on)}` : null].filter(Boolean).join(" · ")}
        </div>
      </div>
      <div className="flex" style={{ gap: 4 }}>
        {tk.status !== "in_progress" && tk.status !== "done" && (
          <form action={setTaskStatus}>
            <input type="hidden" name="task_id" value={tk.id} />
            <input type="hidden" name="member_id" value={id} />
            <input type="hidden" name="status" value="in_progress" />
            <button type="submit" className="pill" title="Mark in progress">Start</button>
          </form>
        )}
        {tk.status !== "done" && (
          <form action={setTaskStatus}>
            <input type="hidden" name="task_id" value={tk.id} />
            <input type="hidden" name="member_id" value={id} />
            <input type="hidden" name="status" value="done" />
            <button type="submit" className="pill" title="Mark done">Done</button>
          </form>
        )}
      </div>
    </div>
  );

  return (
    <Shell
      title={name}
      sub={m.role || TYPE_LABEL[type]}
      action={
        <span className="flex" style={{ gap: 6 }}>
          <Badge tone="teal">{TYPE_LABEL[type] || type}</Badge>
          <Badge tone={statusTone(m.status === "active" ? "active" : m.status === "exited" ? "lost" : "")}>{m.status || "active"}</Badge>
        </span>
      }
    >
      <TabTitle title={name} />

      {/* at-a-glance task breakdown */}
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <div className="card card-pad stat">
          <div className="label flex" style={{ gap: 6 }}><Clock size={13} /> Ongoing</div>
          <div className="value">{ongoing.length}</div>
        </div>
        <div className="card card-pad stat">
          <div className="label flex" style={{ gap: 6 }}><Circle size={13} /> Pending</div>
          <div className="value">{pending.length}</div>
        </div>
        <div className="card card-pad stat">
          <div className="label flex" style={{ gap: 6 }}><CheckCircle2 size={13} /> Done</div>
          <div className="value">{done.length}</div>
        </div>
        <div className="feature teal">
          <div className="ficon" style={{ background: "var(--teal)", color: "#fff" }}><DollarSign size={20} /></div>
          <div className="ftitle">
            {m.pay_amount != null ? <><Money amount={m.pay_amount} currency={m.pay_currency} />{paySuffix}</> : "No pay set"}
          </div>
          <div className="fmeta">{m.pay_type ? PAY_TYPE_LABEL[m.pay_type] || m.pay_type : "pay not recorded"}</div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr 1.6fr" }}>
        {/* profile column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card card-pad">
            <div className="flex" style={{ marginBottom: 14, gap: 13 }}>
              <div className="avatar" style={{ width: 52, height: 52, fontSize: 20 }}>{name.charAt(0).toUpperCase()}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 17 }}>{name}</div>
                <div className="muted" style={{ fontSize: 12.5 }}>{m.role || TYPE_LABEL[type]}</div>
              </div>
            </div>

            {/* quick actions */}
            <div style={{ marginBottom: 14 }}>
              <TeamQuickActions member={m} />
            </div>

            <div className="stack" style={{ gap: 0 }}>
              <Row icon={Briefcase} label="Type"><Badge tone="teal">{TYPE_LABEL[type] || type}</Badge></Row>
              <Row icon={DollarSign} label="Pay">
                {m.pay_amount != null ? <span className="strong"><Money amount={m.pay_amount} currency={m.pay_currency} />{paySuffix}</span> : null}
              </Row>
              <Row icon={Calendar} label="Tenure">{t}</Row>
              <Row icon={Calendar} label="Started">{date(m.engagement_start)}</Row>
              <Row icon={Briefcase} label="Engagement">{m.engagement_type}</Row>
              {m.email && <Row icon={Mail} label="Email">{m.email}</Row>}
              {m.phone && <Row icon={Phone} label="Phone">{m.phone}</Row>}
              {m.location && <Row icon={MapPin} label="Location">{m.location}</Row>}
            </div>

            {tags.length > 0 && (
              <div className="flex" style={{ flexWrap: "wrap", gap: 6, marginTop: 12 }}>
                {tags.map((tag, i) => <span key={i} className="chip"><Tag size={11} /> {tag}</span>)}
              </div>
            )}
          </div>

          {/* responsibilities */}
          <div className="card">
            <div className="card-h"><span className="flex"><FileText size={14} /> Responsibilities</span></div>
            <div style={{ padding: "14px 18px" }}>
              {m.responsibilities ? (
                <div style={{ fontSize: 13.5, lineHeight: 1.65, color: "var(--ink-2)", whiteSpace: "pre-wrap" }}>{m.responsibilities}</div>
              ) : (
                <div className="faint" style={{ fontSize: 13 }}>No responsibilities recorded yet.</div>
              )}
              {m.notes && (
                <div style={{ marginTop: 12 }}>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Notes</div>
                  <div style={{ fontSize: 13.5, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{m.notes}</div>
                </div>
              )}
            </div>
          </div>

          {/* lifecycle status changer */}
          <div className="card card-pad">
            <div className="flex" style={{ marginBottom: 10 }}><Briefcase size={15} color="var(--muted)" /><span style={{ fontWeight: 600, fontSize: 13.5 }}>Status</span></div>
            <div className="flex wrap" style={{ gap: 6 }}>
              {STATUS_OPTS.map((sv) => (
                <form key={sv} action={setMemberStatus}>
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="status" value={sv} />
                  <button type="submit" className={`pill ${(m.status || "active") === sv ? "on" : ""}`}>{sv}</button>
                </form>
              ))}
            </div>
          </div>

          {/* pay history (collapsed by default) */}
          <TeamPayHistory payments={payments} currency={m.pay_currency || "USD"} />
        </div>

        {/* tasks + timeline column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* tasks */}
          <div className="card">
            <div className="card-h">
              <span className="flex"><ListChecks size={15} /> Tasks</span>
              <span className="flex" style={{ gap: 6 }}>
                <Badge tone="teal">{ongoing.length} ongoing</Badge>
                <Badge tone="gray">{pending.length} pending</Badge>
                <Badge tone="green">{done.length} done</Badge>
              </span>
            </div>
            <div style={{ padding: "6px 18px 12px" }}>
              {tasks.length === 0 ? (
                <div className="empty">No tasks assigned yet. Use &ldquo;Assign task&rdquo; to add one.</div>
              ) : (
                <>
                  {ongoing.map((tk) => <TaskItem key={tk.id} tk={tk} />)}
                  {pending.map((tk) => <TaskItem key={tk.id} tk={tk} />)}
                  {done.slice(0, 8).map((tk) => <TaskItem key={tk.id} tk={tk} />)}
                </>
              )}
            </div>
          </div>

          {/* messages: this person's words in the team groups */}
          <div className="card">
            <div className="card-h">
              <span className="flex"><MessageSquare size={15} /> Messages</span>
              <Badge tone="gray">{messageCount}</Badge>
            </div>
            <div style={{ padding: "6px 18px 12px" }}>
              {messages.length === 0 ? (
                <div className="empty">No messages yet. Group history appears here once this person is active.</div>
              ) : (
                messages.slice(0, 30).map((msg) => (
                  <div key={msg.id} className="actrow">
                    <span className="aico teal"><MessageSquare size={15} /></span>
                    <div className="abody">
                      <div className="atitle" style={{ whiteSpace: "pre-wrap", fontWeight: 400 }}>{String(msg.body || "").slice(0, 400)}</div>
                      <div className="ameta">{msg.account || "WhatsApp"}</div>
                    </div>
                    <span className="aright">{date(msg.created_at)}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* unified timeline */}
          <div className="card">
            <div className="card-h">
              <span className="flex"><ActIcon size={15} /> Timeline</span>
              <Badge tone="gray">{timeline.length}</Badge>
            </div>
            <div style={{ padding: "6px 18px 14px" }}>
              {timeline.length === 0 && <div className="empty">No history yet.</div>}
              {timeline.map((x, i) => (
                <div key={i} className="actrow">
                  <span className={`aico ${x.aico}`}><x.icon size={15} /></span>
                  <div className="abody">
                    <div className="atitle">
                      {x.title}
                      {x.amount != null && <Money amount={x.amount} currency={x.currency} />}
                      {x.titleAfter}
                    </div>
                    {x.meta && <div className="ameta">{x.meta}</div>}
                  </div>
                  <span className="aright">{date(x.at)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
