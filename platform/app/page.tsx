import Shell from "../components/Shell";
import Live from "../components/Live";
import { Stat, Badge, Meter } from "../components/ui";
import { admin, money, num } from "../lib/supabase-admin";
import { buildBrief } from "../lib/agents/conductor";
import { decideApproval } from "./approvals/actions";
import { CheckCircle2, Inbox as InboxIcon, Bot, Send, AlertTriangle, ThumbsUp } from "lucide-react";

export const dynamic = "force-dynamic";

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const EVENT_META: Record<string, { label: (p: any) => string; tone: any; icon: any }> = {
  "message.received": { label: (p) => `New message${p.from ? ` from ${p.from}` : ""}`, tone: "blue", icon: InboxIcon },
  "agent.decided":    { label: (p) => `Comms agent drafted a reply${p.from ? ` to ${p.from}` : ""}`, tone: "teal", icon: Bot },
  "approval.created": { label: (p) => `${p.title || "Item"} queued for you`, tone: "gold", icon: ThumbsUp },
  "approval.approved":{ label: () => `You approved an action`, tone: "green", icon: CheckCircle2 },
  "approval.rejected":{ label: () => `You declined a draft`, tone: "gray", icon: AlertTriangle },
  "action.executed":  { label: (p) => `Sent (${p.action || "action"})`, tone: "green", icon: Send },
  "action.failed":    { label: (p) => `Action failed`, tone: "red", icon: AlertTriangle },
};

export default async function MissionControl() {
  const db = admin();
  const [
    { data: don }, { data: donors }, { data: camps },
    { data: approvals }, { data: events }, { data: tasks }, { count: newMsgs },
  ] = await Promise.all([
    db.from("donations").select("amount,status,is_recurring,donated_at"),
    db.from("donors").select("id"),
    db.from("campaigns").select("name,goal_amount,raised_amount,status").eq("status", "live"),
    db.from("approvals").select("*").eq("status", "pending").order("created_at", { ascending: false }).limit(12),
    db.from("events").select("type,actor,payload,created_at").order("created_at", { ascending: false }).limit(16),
    db.from("tasks").select("title,status,priority,assignee:team_members(name)").neq("status", "done").limit(8),
    db.from("messages").select("id", { count: "exact", head: true }).eq("direction", "in").eq("status", "new"),
  ]);

  const succ = (don || []).filter((d: any) => d.status === "succeeded");
  const now = new Date();
  const raisedMtd = succ.filter((d: any) => new Date(d.donated_at).getMonth() === now.getMonth() && new Date(d.donated_at).getFullYear() === now.getFullYear()).reduce((s: number, d: any) => s + Number(d.amount), 0);
  const raisedAll = succ.reduce((s: number, d: any) => s + Number(d.amount), 0);

  const recentActions = (events || [])
    .filter((e: any) => ["agent.decided", "action.executed", "approval.approved"].includes(e.type))
    .slice(0, 5)
    .map((e: any) => EVENT_META[e.type]?.label(e.payload || {}) || e.type);

  const brief = await buildBrief({
    raisedMtd: money(raisedMtd), raisedAll: money(raisedAll),
    donors: donors?.length || 0, newMessages: newMsgs || 0,
    pendingApprovals: (approvals || []).length, openTasks: (tasks || []).length,
    recentAgentActions: recentActions, liveCampaigns: (camps || []).map((c: any) => c.name),
  });

  return (
    <Shell title="Mission Control" sub="Your day, run by the agents" action={<Live />}>
      {/* Conductor brief */}
      <div className="card card-pad rise" style={{ display: "flex", gap: 14, alignItems: "flex-start", borderLeft: "3px solid var(--teal)" }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: "var(--teal)", color: "#fff", display: "grid", placeItems: "center", flexShrink: 0, fontWeight: 800 }}>S</div>
        <div>
          <div style={{ fontWeight: 700, fontFamily: "var(--font-display)" }}>Sasa's brief</div>
          <div style={{ marginTop: 4, color: "var(--ink-2)", lineHeight: 1.6 }}>{brief}</div>
        </div>
      </div>

      <div className="grid cols-4" style={{ marginTop: 14 }}>
        <Stat label="Raised this month" value={money(raisedMtd)} delta={`${money(raisedAll)} all-time`} />
        <Stat label="Donors" value={num(donors?.length || 0)} />
        <Stat label="Needs you" value={num((approvals || []).length)} delta="awaiting approval" />
        <Stat label="New messages" value={num(newMsgs || 0)} delta="unhandled inbound" />
      </div>

      <div className="grid cols-2" style={{ marginTop: 14, gridTemplateColumns: "1.3fr 1fr" }}>
        {/* NEEDS YOU */}
        <div className="card">
          <div className="card-h">Needs you <Badge tone="gold">{(approvals || []).length}</Badge></div>
          <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
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
                {a.kind === "email_reply" ? (
                  <>
                    <div className="faint" style={{ fontSize: 12, marginBottom: 6 }}>To {a.proposed?.to || "—"}</div>
                    <input name="subject" defaultValue={a.proposed?.subject || ""} style={{ marginBottom: 8, fontSize: 13 }} />
                    <textarea name="body" defaultValue={a.proposed?.body || ""} rows={5} style={{ fontSize: 13, lineHeight: 1.55 }} />
                  </>
                ) : (
                  <pre style={{ fontSize: 12, whiteSpace: "pre-wrap", color: "var(--ink-2)" }}>{JSON.stringify(a.proposed, null, 2)}</pre>
                )}
                <div className="flex" style={{ marginTop: 10 }}>
                  <button className="btn sm" name="decision" value="approve" type="submit"><Send size={13} style={{ marginRight: 5 }} /> Approve &amp; send</button>
                  <button className="btn sm ghost" name="decision" value="reject" type="submit" formNoValidate>Decline</button>
                </div>
              </form>
            ))}
          </div>
        </div>

        {/* ACTIVITY + TASKS */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="card">
            <div className="card-h">Activity</div>
            <div style={{ padding: "6px 4px" }}>
              {(events || []).length === 0 && <div className="empty">No activity yet.</div>}
              {(events || []).map((e: any, i: number) => {
                const m = EVENT_META[e.type];
                const I = m?.icon || Bot;
                return (
                  <div key={i} className="flex" style={{ padding: "8px 16px", gap: 10 }}>
                    <span style={{ color: "var(--muted)", display: "grid", placeItems: "center" }}><I size={15} /></span>
                    <span style={{ flex: 1, fontSize: 13 }}>{m?.label(e.payload || {}) || e.type}</span>
                    <span className="faint" style={{ fontSize: 11 }}>{timeAgo(e.created_at)}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card">
            <div className="card-h">Tasks</div>
            <div style={{ padding: "6px 4px" }}>
              {(tasks || []).length === 0 && <div className="empty">No open tasks.</div>}
              {(tasks || []).map((t: any, i: number) => (
                <div key={i} className="between" style={{ padding: "9px 16px" }}>
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
    </Shell>
  );
}
