import Refresh from "../components/Refresh";
import ActionChips from "../components/ActionChips";
import AskSasa from "../components/AskSasa";
import { Badge } from "../components/ui";
import { Gauge, BarChart } from "../components/charts";
import { Money, MoneyHideToggle } from "../components/Money";
import { admin, money, num } from "../lib/supabase-admin";
import { getCounts } from "../lib/counts";
import { getMonthlyGoal } from "../lib/org-settings";
import { getBrief, fallbackPoints } from "../lib/brief";
import { cleanEmail } from "../lib/email-render";
import ApprovalCard from "../components/ApprovalCard";
import { getCurrentUser } from "../lib/auth";
import { Sparkles, ChevronRight, Bot } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function MissionControl() {
  const db = admin();
  // Greet whoever actually logged in (Nur or Taona), not a hardcoded name. The
  // signed identity cookie carries WHO; fall back gracefully if it is absent.
  const firstName = getCurrentUser()?.name?.split(" ")[0] || "there";
  const [
    { data: don }, { data: approvals }, { data: tasks }, counts, cached, { data: events }, MONTHLY_GOAL,
  ] = await Promise.all([
    db.from("donations").select("amount,status,is_recurring,donated_at,currency"),
    db.from("approvals").select("*").eq("status", "pending").order("created_at", { ascending: false }).limit(12),
    db.from("tasks").select("title,status,priority,assignee:team_members(name)").neq("status", "done").limit(7),
    getCounts(db),
    getBrief(),
    db.from("events").select("type,payload,created_at").order("created_at", { ascending: false }).limit(7),
    getMonthlyGoal(db),
  ]);
  const evAgo = (iso: string) => { const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); return s < 60 ? "now" : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`; };
  const evLabel = (e: any) => { const p = e.payload || {}; const m: Record<string, string> = { "agent.decided": `Sasa drafted a reply${p.from ? ` to ${p.from}` : ""}`, "approval.created": `${p.title || "Item"} queued`, "approval.approved": "You approved an action", "action.executed": `Sent${p.to ? ` to ${p.to}` : ""}`, "task.assigned": `Task assigned${p.assignee ? ` to ${p.assignee}` : ""}`, "payment.verified": "Payment logged", "grants.refreshed": `${p.found || ""} grant opportunities refreshed`, "asset.ingested": `Filed "${p.title || "asset"}" to Library` }; return m[e.type] || e.type.replace(/\./g, " "); };

  // USD only for the $ headline figures — never mix KES (bank/M-Pesa donations)
  // into a dollar total. KES gifts live on donor records and the donations page.
  const succ: any[] = (don || []).filter((d: any) => d.status === "succeeded" && (d.currency || "USD").toUpperCase() === "USD");
  const now = new Date();
  const inMonth = (d: any, off = 0) => { const x = new Date(d.donated_at); const m = new Date(now.getFullYear(), now.getMonth() - off, 1); return x.getMonth() === m.getMonth() && x.getFullYear() === m.getFullYear(); };
  const raisedMtd = succ.filter((d: any) => inMonth(d)).reduce((s: number, d: any) => s + Number(d.amount), 0);
  const raisedAll = succ.reduce((s: number, d: any) => s + Number(d.amount), 0);
  const recurring = succ.filter((d: any) => d.is_recurring).length;

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
    // R4-1: do NOT slice the original body. The FocusTab "In reply to" quote
    // scrolls (.peek-quote owns its own scroll), so the FULL original message is
    // available, never cut to a char limit. The full row is read from `messages`
    // when we have a message_id, so even an old approval whose stored context was
    // truncated shows the complete original here.
    for (const o of (origs || []) as any[]) origMap[o.id] = { subject: o.subject, body: cleanEmail(o.body || ""), from: o.contact?.name };
  }
  const origFor = (a: any) => origMap[a.context?.message_id] || (a.context?.original ? { subject: a.context.subject, body: cleanEmail(a.context.original), from: a.context.from } : null);

  const points = cached.points.length ? cached.points : fallbackPoints({ pending: counts.needsYou, newMsgs: counts.needsReply, tasks: counts.openTasks, raisedMtd: money(raisedMtd) });
  const goalPct = Math.round((raisedMtd / MONTHLY_GOAL) * 100);

  return (
    <div className="pagewrap rise">
      <div className="hero">
        <div>
          <div className="eyebrow">Welcome back, {firstName}</div>
          <h1>Let's do some good today.</h1>
        </div>
      </div>

      <ActionChips />

      {/* brief (clickable bullets, scrollable) + monthly gauge */}
      <div className="grid" style={{ gridTemplateColumns: "1.5fr 1fr", marginBottom: 16 }}>
        <div className="feature teal">
          <div className="between" style={{ marginBottom: 10 }}>
            <div className="flex"><div className="ficon" style={{ background: "var(--teal)", color: "#fff", width: 34, height: 34, marginBottom: 0 }}><Sparkles size={18} /></div><div className="ftitle">Sasa's brief</div></div>
            <Refresh />
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
        <div className="card card-pad" style={{ display: "flex", alignItems: "center", gap: 18, position: "relative" }}>
          <MoneyHideToggle style={{ position: "absolute", top: 14, right: 14 }} />
          <Gauge pct={goalPct} value={`${goalPct}%`} label="of goal" />
          <div>
            <div className="muted" style={{ fontSize: 12.5 }}>Raised this month</div>
            <Money amount={raisedMtd} style={{ display: "block", fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 700, letterSpacing: "-0.03em", marginTop: 4 }} />
            <div className="faint" style={{ fontSize: 12, marginTop: 3 }}>goal <Money amount={MONTHLY_GOAL} /></div>
          </div>
        </div>
      </div>

      {/* KPIs — clickable */}
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <a className="card card-pad stat hover" href="/donations" style={{ position: "relative" }}><MoneyHideToggle style={{ position: "absolute", top: 14, right: 14 }} /><div className="label">Raised all-time</div><div className="value"><Money amount={raisedAll} /></div><div className="delta">{recurring} recurring gifts</div></a>
        <a className="card card-pad stat hover" href="/donors"><div className="label">Donors</div><div className="value">{num(counts.donors)}</div><div className="delta">in your network</div></a>
        <a className="card card-pad stat hover" href="/inbox"><div className="label">Inbox</div><div className="value">{num(counts.needsReply)}</div><div className="delta">need a reply</div></a>
        <a className="card card-pad stat hover" href="/tasks"><div className="label">Open tasks</div><div className="value">{num(counts.openTasks)}</div><div className="delta">across the team</div></a>
      </div>

      {/* Needs you — the important part, sideways scroll */}
      <div className="card" id="needs-you" style={{ marginBottom: 16 }}>
        <div className="card-h">Needs you <Badge tone="gold">{counts.needsYou}</Badge></div>
        {(approvals || []).length === 0
          ? <div className="empty">Nothing needs you yet. Sasa only surfaces real people who need a reply.</div>
          : (() => {
              // serializable sibling set (each approval + its resolved original)
              // so the Focus Tab's prev/next arrows step through Needs-You.
              const sibs = (approvals || []).map((a: any) => ({ a, original: origFor(a) }));
              return <div className="hscroll">{(approvals || []).map((a: any) => <ApprovalCard key={a.id} a={a} original={origFor(a)} siblings={sibs} />)}</div>;
            })()}
      </div>

      {/* Tasks */}
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 16 }}>
        <div className="card">
          <div className="card-h"><a href="/tasks" style={{ textDecoration: "none" }} className="flex">Tasks <ChevronRight size={15} /></a></div>
          <div style={{ padding: "6px 16px" }}>
            {(tasks || []).length === 0 && (
              // empty state: message centered in the body, the "ask Sasa" entry
              // bar pinned to the BOTTOM-center of the card (feedback).
              <div style={{ display: "flex", flexDirection: "column", minHeight: 220 }}>
                <div className="empty" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px 16px" }}>No open tasks.</div>
                <div style={{ paddingBottom: 14 }}>
                  <AskSasa prompt="Suggest and assign a task for the team based on what's happening right now." label="Ask Sasa to assign a task…" />
                </div>
              </div>
            )}
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
        <div className="card-h">
          <span>Fundraising · last 6 months</span>
          <span className="flex" style={{ gap: 14 }}>
            <span className="muted" style={{ fontSize: 12.5 }}>6-mo total <Money amount={bars.reduce((s, b) => s + b.value, 0)} className="strong" /></span>
            {(() => {
              const last = bars[bars.length - 1]?.value || 0;
              const prev = bars[bars.length - 2]?.value || 0;
              const up = last >= prev;
              const pct = prev > 0 ? Math.round(((last - prev) / prev) * 100) : (last > 0 ? 100 : 0);
              return <Badge tone={up ? "green" : "red"}>{up ? "▲" : "▼"} {Math.abs(pct)}% vs last month</Badge>;
            })()}
          </span>
        </div>
        <div className="card-pad"><BarChart data={bars} valueLabels tall /></div>
      </div>
    </div>
  );
}
