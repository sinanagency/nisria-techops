import SmartConsole from "../../components/SmartConsole";
import { Badge } from "../../components/ui";
import { admin, money } from "../../lib/supabase-admin";
import { buildBrief } from "../../lib/agents/conductor";
import { Wand2, Sparkles, RefreshCw, ThumbsUp, ListChecks, Inbox as InboxIcon } from "lucide-react";

export const dynamic = "force-dynamic";

const ago = (iso: string) => { const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); return s < 3600 ? `${Math.max(1, Math.floor(s / 60))}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`; };

export default async function Smart() {
  const db = admin();
  const [
    { data: don }, { data: donors }, { data: approvals }, { data: tasks }, { count: newMsgs }, { data: events },
  ] = await Promise.all([
    db.from("donations").select("amount,status,donated_at"),
    db.from("donors").select("id", { count: "exact", head: false }),
    db.from("approvals").select("id,title,kind,created_at").eq("status", "pending").order("created_at", { ascending: false }).limit(6),
    db.from("tasks").select("id,title,priority").neq("status", "done").limit(6),
    db.from("messages").select("id", { count: "exact", head: true }).eq("direction", "in").eq("status", "new"),
    db.from("events").select("type,payload,created_at").in("type", ["agent.decided", "action.executed", "approval.approved"]).order("created_at", { ascending: false }).limit(5),
  ]);

  const succ = (don || []).filter((d: any) => d.status === "succeeded");
  const now = new Date();
  const raisedMtd = succ.filter((d: any) => new Date(d.donated_at).getMonth() === now.getMonth() && new Date(d.donated_at).getFullYear() === now.getFullYear()).reduce((s: number, d: any) => s + Number(d.amount), 0);
  const raisedAll = succ.reduce((s: number, d: any) => s + Number(d.amount), 0);

  const brief = await buildBrief({
    raisedMtd: money(raisedMtd), raisedAll: money(raisedAll), donors: donors?.length || 0,
    newMessages: newMsgs || 0, pendingApprovals: (approvals || []).length, openTasks: (tasks || []).length,
    recentAgentActions: (events || []).map((e: any) => e.type.replace(/\./g, " ")), liveCampaigns: [],
  });

  return (
    <div className="pagewrap rise">
      <div className="hero">
        <div>
          <div className="eyebrow"><Wand2 size={14} style={{ verticalAlign: -2 }} /> Smart Mode</div>
          <h1>Tell me what to do.</h1>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1.5fr 1fr", alignItems: "start" }}>
        <SmartConsole />

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* daily summary (scrollable) */}
          <div className="card">
            <div className="card-h"><span className="flex"><Sparkles size={15} color="var(--teal)" /> Today</span><span className="faint" style={{ fontSize: 11 }}>{now.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}</span></div>
            <div style={{ padding: "14px 18px", maxHeight: 200, overflowY: "auto", color: "var(--ink-2)", lineHeight: 1.6, fontSize: 13.5 }}>{brief}</div>
          </div>

          {/* continuity */}
          <div className="card">
            <div className="card-h"><span className="flex"><RefreshCw size={14} /> Pick up where you left off</span></div>
            <div style={{ padding: "6px 16px 12px" }}>
              {(approvals || []).map((a: any) => (
                <a key={a.id} href="/" className="actrow" style={{ textDecoration: "none" }}>
                  <span className="aico gold"><ThumbsUp size={14} /></span>
                  <div className="abody"><div className="atitle">{a.title}</div><div className="ameta">awaiting your approval</div></div>
                  <span className="aright">{ago(a.created_at)}</span>
                </a>
              ))}
              {(tasks || []).map((t: any) => (
                <a key={t.id} href="/tasks" className="actrow" style={{ textDecoration: "none" }}>
                  <span className="aico peri"><ListChecks size={14} /></span>
                  <div className="abody"><div className="atitle">{t.title}</div><div className="ameta">open task · {t.priority}</div></div>
                </a>
              ))}
              {(newMsgs || 0) > 0 && (
                <a href="/inbox" className="actrow" style={{ textDecoration: "none" }}>
                  <span className="aico teal"><InboxIcon size={14} /></span>
                  <div className="abody"><div className="atitle">{newMsgs} messages to triage</div><div className="ameta">in the inbox</div></div>
                </a>
              )}
              {!(approvals || []).length && !(tasks || []).length && !(newMsgs || 0) && <div className="empty">All caught up.</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
