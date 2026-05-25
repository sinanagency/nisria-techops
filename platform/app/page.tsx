import Live from "../components/Live";
import HeroSearch from "../components/HeroSearch";
import ActionChips from "../components/ActionChips";
import { Badge } from "../components/ui";
import { Gauge, BarChart, AvatarStack } from "../components/charts";
import { admin, money, num } from "../lib/supabase-admin";
import { getBrief, fallbackPoints } from "../lib/brief";
import { cleanEmail } from "../lib/email-render";
import ApprovalCard from "../components/ApprovalCard";
import { Sparkles, ChevronRight, Bot } from "lucide-react";

export const dynamic = "force-dynamic";
const MONTHLY_GOAL = 5000;

export default async function MissionControl() {
  const db = admin();
  const [
    { data: don }, { data: donors }, { data: approvals }, { data: tasks }, { count: newMsgs }, cached, { data: events },
  ] = await Promise.all([
    db.from("donations").select("amount,status,is_recurring,donated_at"),
    db.from("donors").select("id,full_name"),
    db.from("approvals").select("*").eq("status", "pending").order("created_at", { ascending: false }).limit(12),
    db.from("tasks").select("title,status,priority,assignee:team_members(name)").neq("status", "done").limit(7),
    db.from("messages").select("id", { count: "exact", head: true }).eq("direction", "in").eq("status", "new").eq("sender_type", "individual"),
    getBrief(),
    db.from("events").select("type,payload,created_at").order("created_at", { ascending: false }).limit(7),
  ]);
  const evAgo = (iso: string) => { const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); return s < 60 ? "now" : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`; };
  const evLabel = (e: any) => { const p = e.payload || {}; const m: Record<string, string> = { "agent.decided": `Sasa drafted a reply${p.from ? ` to ${p.from}` : ""}`, "approval.created": `${p.title || "Item"} queued`, "approval.approved": "You approved an action", "action.executed": `Sent${p.to ? ` to ${p.to}` : ""}`, "task.assigned": `Task assigned${p.assignee ? ` to ${p.assignee}` : ""}`, "payment.verified": "Payment logged", "grants.refreshed": `${p.found || ""} grant opportunities refreshed`, "asset.ingested": `Filed "${p.title || "asset"}" to Library` }; return m[e.type] || e.type.replace(/\./g, " "); };

  const succ: any[] = (don || []).filter((d: any) => d.status === "succeeded");
  const now = new Date();
  const inMonth = (d: any, off = 0) => { const x = new Date(d.donated_at); const m = new Date(now.getFullYear(), now.getMonth() - off, 1); return x.getMonth() === m.getMonth() && x.getFullYear() === m.getFullYear(); };
  const raisedMtd = succ.filter((d: any) => inMonth(d)).reduce((s: number, d: any) => s + Number(d.amount), 0);
  const raisedAll = succ.reduce((s: number, d: any) => s + Number(d.amount), 0);
  const recurring = succ.filter((d: any) => d.is_recurring).length;
  const donorNames = (donors || []).map((d: any) => d.full_name).filter(Boolean);

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const bars = Array.from({ length: 6 }).map((_, i) => {
    const off = 5 - i; const m = new Date(now.getFullYear(), now.getMonth() - off, 1);
    const val = succ.filter((d: any) => inMonth(d, off)).reduce((s: number, d: any) => s + Number(d.amount), 0);
    return { label: MONTHS[m.getMonth()], value: val, tip: money(val) };
  });

  // fetch the original inbound message for each pending reply, for context
  const msgIds = (approvals || []).map((a: any) => a.context?.message_id).filter(Boolean);
  const origMap: Record<string, any> = {};
  if (msgIds.length) {
    const { data: origs } = await db.from("messages").select("id,subject,body,contact:contacts(name)").in("id", msgIds);
    for (const o of (origs || []) as any[]) origMap[o.id] = { subject: o.subject, body: cleanEmail(o.body || "").slice(0, 900), from: o.contact?.name };
  }
  const origFor = (a: any) => origMap[a.context?.message_id] || (a.context?.original ? { subject: a.context.subject, body: cleanEmail(a.context.original).slice(0, 900), from: a.context.from } : null);

  const points = cached.points.length ? cached.points : fallbackPoints({ pending: (approvals || []).length, newMsgs: newMsgs || 0, tasks: (tasks || []).length, raisedMtd: money(raisedMtd) });
  const goalPct = Math.round((raisedMtd / MONTHLY_GOAL) * 100);

  return (
    <div className="pagewrap rise">
      <div className="hero">
        <div>
          <div className="eyebrow">Welcome back, Nur</div>
          <h1>Let's do some good today.</h1>
        </div>
        <HeroSearch />
      </div>

      <ActionChips />

      {/* brief (clickable bullets, scrollable) + monthly gauge */}
      <div className="grid" style={{ gridTemplateColumns: "1.5fr 1fr", marginBottom: 16 }}>
        <div className="feature teal">
          <div className="between" style={{ marginBottom: 10 }}>
            <div className="flex"><div className="ficon" style={{ background: "var(--teal)", color: "#fff", width: 34, height: 34, marginBottom: 0 }}><Sparkles size={18} /></div><div className="ftitle">Sasa's brief</div></div>
            <Live />
          </div>
          <div style={{ maxHeight: 138, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
            {points.map((p: any, i: number) => (
              <a key={i} href={p.href} className="briefpt">
                <span className="dot" />
                <span style={{ flex: 1 }}>{p.text}</span>
                <ChevronRight size={15} className="chev" />
              </a>
            ))}
          </div>
        </div>
        <div className="card card-pad" style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <Gauge pct={goalPct} value={`${goalPct}%`} label="of goal" />
          <div>
            <div className="muted" style={{ fontSize: 12.5 }}>Raised this month</div>
            <div className="money" style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 700, letterSpacing: "-0.03em", marginTop: 4 }}>{money(raisedMtd)}</div>
            <div className="faint" style={{ fontSize: 12, marginTop: 3 }}>goal <span className="money">{money(MONTHLY_GOAL)}</span></div>
          </div>
        </div>
      </div>

      {/* KPIs — clickable */}
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <a className="card card-pad stat hover" href="/donations"><div className="label">Raised all-time</div><div className="value money">{money(raisedAll)}</div><div className="delta">{recurring} recurring gifts</div></a>
        <a className="card card-pad stat hover" href="/donors"><div className="label">Donors</div><div className="value">{num(donors?.length || 0)}</div><div style={{ marginTop: 8 }}><AvatarStack names={donorNames} /></div></a>
        <a className="card card-pad stat hover" href="/inbox"><div className="label">Inbox</div><div className="value">{num(newMsgs || 0)}</div><div className="delta">need a reply</div></a>
        <a className="card card-pad stat hover" href="/tasks"><div className="label">Open tasks</div><div className="value">{num((tasks || []).length)}</div><div className="delta">across the team</div></a>
      </div>

      {/* Needs you — the important part, sideways scroll */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-h">Needs you <Badge tone="gold">{(approvals || []).length}</Badge></div>
        {(approvals || []).length === 0
          ? <div className="empty">Nothing waiting. Sasa only surfaces real people who need a reply.</div>
          : <div className="hscroll">{(approvals || []).map((a: any) => <ApprovalCard key={a.id} a={a} original={origFor(a)} />)}</div>}
      </div>

      {/* Tasks */}
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 16 }}>
        <div className="card">
          <div className="card-h"><a href="/tasks" style={{ textDecoration: "none" }} className="flex">Tasks <ChevronRight size={15} /></a></div>
          <div style={{ padding: "6px 16px" }}>
            {(tasks || []).length === 0 && <div className="empty">No open tasks. Ask Sasa to assign one.</div>}
            {(tasks || []).map((t: any, i: number) => (
              <a key={i} href="/tasks" className="between" style={{ padding: "10px 0", borderTop: i ? "1px solid var(--line)" : "none", textDecoration: "none" }}>
                <span style={{ fontSize: 13 }}>{t.title}</span>
                <span className="flex">
                  {t.assignee?.name && <span className="faint" style={{ fontSize: 11 }}>{t.assignee.name}</span>}
                  <Badge tone={t.priority === "high" ? "red" : t.priority === "low" ? "gray" : "gold"}>{t.priority || "med"}</Badge>
                </span>
              </a>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card-h"><a href="/agents" style={{ textDecoration: "none" }} className="flex">Recent activity <ChevronRight size={15} /></a></div>
          <div style={{ padding: "6px 16px" }}>
            {(events || []).length === 0 && <div className="empty">Quiet so far today.</div>}
            {(events || []).map((e: any, i: number) => (
              <div key={i} className="actrow">
                <span className="aico teal"><Bot size={14} /></span>
                <div className="abody"><div className="atitle">{evLabel(e)}</div></div>
                <span className="aright">{evAgo(e.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-h">Fundraising · last 6 months</div>
        <div className="card-pad"><BarChart data={bars} /></div>
      </div>
    </div>
  );
}
