import Live from "../components/Live";
import HeroSearch from "../components/HeroSearch";
import ActionChips from "../components/ActionChips";
import { Badge } from "../components/ui";
import { Gauge, BarChart, AvatarStack } from "../components/charts";
import { admin, money, num } from "../lib/supabase-admin";
import { buildBrief } from "../lib/agents/conductor";
import { decideApproval } from "./approvals/actions";
import { CheckCircle2, Inbox as InboxIcon, Bot, Send, AlertTriangle, ThumbsUp, Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";

const MONTHLY_GOAL = 5000;

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const EVENT_META: Record<string, { label: (p: any) => string; aico: string; icon: any }> = {
  "message.received": { label: (p) => `New message${p.from ? ` from ${p.from}` : ""}`, aico: "peri", icon: InboxIcon },
  "agent.decided":    { label: (p) => `Comms drafted a reply${p.from ? ` to ${p.from}` : ""}`, aico: "teal", icon: Bot },
  "approval.created": { label: (p) => `${p.title || "Item"} queued for you`, aico: "gold", icon: ThumbsUp },
  "approval.approved":{ label: () => `You approved an action`, aico: "green", icon: CheckCircle2 },
  "approval.rejected":{ label: () => `You declined a draft`, aico: "gray", icon: AlertTriangle },
  "action.executed":  { label: (p) => `Sent — ${p.action || "action"}`, aico: "green", icon: Send },
  "action.failed":    { label: () => `Action failed`, aico: "red", icon: AlertTriangle },
  "task.assigned":    { label: (p) => `Task assigned${p.assignee ? ` to ${p.assignee}` : ""}`, aico: "peri", icon: CheckCircle2 },
  "asset.ingested":   { label: (p) => `Filed "${p.title || "asset"}" to the library`, aico: "teal", icon: ThumbsUp },
};

export default async function MissionControl() {
  const db = admin();
  const since6 = new Date(); since6.setMonth(since6.getMonth() - 5); since6.setDate(1);
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

  const [
    { data: don }, { data: donors }, { data: camps },
    { data: approvals }, { data: events }, { data: tasks }, { count: newMsgs }, { count: runsToday },
  ] = await Promise.all([
    db.from("donations").select("amount,status,is_recurring,donated_at,donor:donors(full_name)"),
    db.from("donors").select("id,full_name"),
    db.from("campaigns").select("name,goal_amount,raised_amount,status").eq("status", "live"),
    db.from("approvals").select("*").eq("status", "pending").order("created_at", { ascending: false }).limit(10),
    db.from("events").select("type,actor,payload,created_at").order("created_at", { ascending: false }).limit(14),
    db.from("tasks").select("title,status,priority,assignee:team_members(name)").neq("status", "done").limit(7),
    db.from("messages").select("id", { count: "exact", head: true }).eq("direction", "in").eq("status", "new"),
    db.from("agent_runs").select("id", { count: "exact", head: true }).gte("created_at", todayStart.toISOString()),
  ]);

  const succ: any[] = (don || []).filter((d: any) => d.status === "succeeded");
  const now = new Date();
  const inMonth = (d: any, off = 0) => { const x = new Date(d.donated_at); const m = new Date(now.getFullYear(), now.getMonth() - off, 1); return x.getMonth() === m.getMonth() && x.getFullYear() === m.getFullYear(); };
  const raisedMtd = succ.filter((d: any) => inMonth(d)).reduce((s: number, d: any) => s + Number(d.amount), 0);
  const raisedAll = succ.reduce((s: number, d: any) => s + Number(d.amount), 0);
  const recurring = succ.filter((d: any) => d.is_recurring).length;
  const donorNames = (donors || []).map((d: any) => d.full_name).filter(Boolean);

  // last 6 months bar chart
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const bars = Array.from({ length: 6 }).map((_, i) => {
    const off = 5 - i;
    const m = new Date(now.getFullYear(), now.getMonth() - off, 1);
    const val = succ.filter((d: any) => inMonth(d, off)).reduce((s: number, d: any) => s + Number(d.amount), 0);
    return { label: MONTHS[m.getMonth()], value: val, tip: money(val) };
  });

  const recentActions = (events || [])
    .filter((e: any) => ["agent.decided", "action.executed", "approval.approved"].includes(e.type))
    .slice(0, 5).map((e: any) => EVENT_META[e.type]?.label(e.payload || {}) || e.type);

  const brief = await buildBrief({
    raisedMtd: money(raisedMtd), raisedAll: money(raisedAll), donors: donors?.length || 0,
    newMessages: newMsgs || 0, pendingApprovals: (approvals || []).length, openTasks: (tasks || []).length,
    recentAgentActions: recentActions, liveCampaigns: (camps || []).map((c: any) => c.name),
  });

  const goalPct = Math.round((raisedMtd / MONTHLY_GOAL) * 100);

  return (
    <div className="pagewrap rise">
      {/* hero */}
      <div className="hero">
        <div>
          <div className="eyebrow">Welcome back, Nur 👋</div>
          <h1>Let's do some good today.</h1>
        </div>
        <HeroSearch />
      </div>

      <ActionChips />

      {/* row 1: Sasa brief + monthly gauge */}
      <div className="grid" style={{ gridTemplateColumns: "1.5fr 1fr", marginBottom: 16 }}>
        <div className="feature teal" style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
          <div className="ficon" style={{ background: "var(--teal)", color: "#fff" }}><Sparkles size={20} /></div>
          <div style={{ flex: 1 }}>
            <div className="between">
              <div className="ftitle">Sasa's brief</div>
              <Live />
            </div>
            <div style={{ marginTop: 8, color: "var(--ink-2)", lineHeight: 1.65, fontSize: 14 }}>{brief}</div>
          </div>
        </div>

        <div className="card card-pad" style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <Gauge pct={goalPct} value={`${goalPct}%`} label="of goal" />
          <div>
            <div className="muted" style={{ fontSize: 12.5 }}>Raised this month</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 700, letterSpacing: "-0.03em", marginTop: 4 }}>{money(raisedMtd)}</div>
            <div className="faint" style={{ fontSize: 12, marginTop: 3 }}>goal {money(MONTHLY_GOAL)}</div>
          </div>
        </div>
      </div>

      {/* row 2: KPI stats */}
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <div className="card card-pad stat"><div className="label">Raised all-time</div><div className="value">{money(raisedAll)}</div><div className="delta">{recurring} recurring gifts</div></div>
        <div className="card card-pad stat">
          <div className="label">Donors</div><div className="value">{num(donors?.length || 0)}</div>
          <div style={{ marginTop: 8 }}><AvatarStack names={donorNames} /></div>
        </div>
        <div className="card card-pad stat"><div className="label">Needs you</div><div className="value">{num((approvals || []).length)}</div><div className="delta">awaiting approval</div></div>
        <div className="card card-pad stat"><div className="label">Agents at work</div><div className="value">{num(runsToday || 0)}</div><div className="delta">runs today · {newMsgs || 0} new msgs</div></div>
      </div>

      {/* row 3: Needs You + (Activity + Tasks) */}
      <div className="grid" style={{ gridTemplateColumns: "1.3fr 1fr", marginBottom: 16 }}>
        <div className="card">
          <div className="card-h">Needs you <Badge tone="gold">{(approvals || []).length}</Badge></div>
          <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12, maxHeight: 560, overflowY: "auto" }}>
            {(approvals || []).length === 0 && <div className="empty">Nothing waiting. The agents are on it.</div>}
            {(approvals || []).map((a: any) => (
              <form key={a.id} action={decideApproval} className="card" style={{ padding: 14, boxShadow: "none", background: "var(--surface-2)" }}>
                <input type="hidden" name="id" value={a.id} />
                <div className="between" style={{ marginBottom: 8 }}>
                  <div className="flex">
                    <span className="strong">{a.title}</span>
                    {a.lane === "escalate" && <Badge tone="red">Escalated</Badge>}
                    <Badge tone="teal">{(a.agent || "").replace("agent:", "")}</Badge>
                  </div>
                  <span className="faint" style={{ fontSize: 11 }}>{timeAgo(a.created_at)}</span>
                </div>
                {(a.kind === "email_reply" || a.kind === "donor_thankyou") ? (
                  <>
                    <div className="faint" style={{ fontSize: 12, marginBottom: 6 }}>To {a.proposed?.to || "—"}</div>
                    <input name="subject" defaultValue={a.proposed?.subject || ""} style={{ marginBottom: 8, fontSize: 13 }} />
                    <textarea name="body" defaultValue={a.proposed?.body || ""} rows={5} style={{ fontSize: 13, lineHeight: 1.55 }} />
                  </>
                ) : (
                  <pre style={{ fontSize: 12, whiteSpace: "pre-wrap", color: "var(--ink-2)" }}>{JSON.stringify(a.proposed, null, 2)}</pre>
                )}
                <div className="flex" style={{ marginTop: 10 }}>
                  <button className="btn sm teal" name="decision" value="approve" type="submit"><Send size={13} /> Approve &amp; send</button>
                  <button className="btn sm ghost" name="decision" value="reject" type="submit" formNoValidate>Decline</button>
                </div>
              </form>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card">
            <div className="card-h">Activity</div>
            <div style={{ padding: "6px 16px" }}>
              {(events || []).length === 0 && <div className="empty">No activity yet.</div>}
              {(events || []).map((e: any, i: number) => {
                const m = EVENT_META[e.type]; const I = m?.icon || Bot;
                return (
                  <div key={i} className="actrow">
                    <span className={`aico ${m?.aico || "gray"}`}><I size={15} /></span>
                    <div className="abody"><div className="atitle">{m?.label(e.payload || {}) || e.type}</div></div>
                    <span className="aright">{timeAgo(e.created_at)}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="card">
            <div className="card-h">Tasks</div>
            <div style={{ padding: "6px 16px" }}>
              {(tasks || []).length === 0 && <div className="empty">No open tasks.</div>}
              {(tasks || []).map((t: any, i: number) => (
                <div key={i} className="between" style={{ padding: "10px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
                  <span style={{ fontSize: 13 }}>{t.title}</span>
                  <span className="flex">
                    {t.assignee?.name && <span className="faint" style={{ fontSize: 11 }}>{t.assignee.name}</span>}
                    <Badge tone={t.priority === "high" ? "red" : t.priority === "low" ? "gray" : "gold"}>{t.priority || "med"}</Badge>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* row 4: fundraising chart */}
      <div className="card">
        <div className="card-h">Fundraising · last 6 months</div>
        <div className="card-pad"><BarChart data={bars} /></div>
      </div>
    </div>
  );
}
