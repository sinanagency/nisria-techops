import Shell from "../../components/Shell";
import { Badge } from "../../components/ui";
import { admin } from "../../lib/supabase-admin";
import { setLane, toggleConnector } from "./actions";
import { Bot, Mail, HeartHandshake, PenLine, Megaphone, Database, Plug, Clock, Search, MessageSquare, BellRing, FolderDown, ListChecks } from "lucide-react";
import { filterHumanEvents } from "../../lib/events-filter";
import TabbedPane, { type TabbedTab } from "../../components/TabbedPane";

export const dynamic = "force-dynamic";

// Each badge reflects what ACTUALLY runs in app/api/agents/tick (the 6am cron)
// and app/api/grants/prepare (the 6:30am cron):
//  - live    : runs autonomously today, end to end
//  - partial : a real engine runs for part of the job; the rest is not built yet
//  - soon    : not built; on the roadmap, shown so the surface stays honest
const AGENTS = [
  { key: "conductor", name: "Sasa · Chief of Staff", icon: Bot, desc: "Writes your daily brief on the cron and answers you in chat. Routing across the other agents is still growing.", status: "live", run: "agent:conductor" },
  { key: "comms", name: "Comms agent", icon: Mail, desc: "Reads inbound mail, classifies it, drafts replies in your voice, and queues them for approval.", status: "live", run: "agent:comms" },
  { key: "steward", name: "Donor Steward", icon: HeartHandshake, desc: "Drafts a thank-you for each new gift and queues it for you. Lapsing-donor outreach is next.", status: "live", run: "agent:steward" },
  { key: "fundraising", name: "Fundraising agent", icon: Megaphone, desc: "Auto-pursues strong grant opportunities and drafts the full application into Review for you. Campaign pushes are not built yet.", status: "partial", run: "agent:grant" },
  { key: "content", name: "Content agent", icon: PenLine, desc: "Will draft posts and the newsletter from activity and assets. Not built yet.", status: "soon", run: null },
  { key: "field", name: "Field / Data agent", icon: Database, desc: "Will keep beneficiary and inventory records clean from the WhatsApp feed. Not built yet.", status: "soon", run: null },
];

// SCHEDULED JOBS — mirrors the crons declared in vercel.json. Times are UTC, as
// Vercel runs them; we render UTC honestly rather than guessing the operator's tz.
// "last run" is not persisted per-job in the data we read, so the roster shows the
// trigger only and the agents below carry the real last-run from agent_runs.
const JOBS = [
  { key: "tick", name: "Agent tick", icon: Bot, schedule: "Daily 06:00 UTC", does: "Drains inbound mail to the Comms + Steward agents, rolls recurring events, writes the daily brief.", run: "agent:conductor" },
  { key: "reminders", name: "Reminders", icon: BellRing, schedule: "Daily 06:10 UTC", does: "Pings each assignee on due and scheduled obligations, including payroll.", run: null },
  { key: "grants-prepare", name: "Grant prep worker", icon: Megaphone, schedule: "Daily 06:30 UTC", does: "Auto-pursues strong grant opportunities and drafts full applications into Review.", run: "agent:grant" },
  { key: "wa-worker", name: "WhatsApp worker", icon: MessageSquare, schedule: "Daily 06:20 UTC", does: "Works the WhatsApp send queue and inbound actions.", run: null },
  { key: "drive", name: "Drive extract", icon: FolderDown, schedule: "Daily 05:00 UTC", does: "Pulls new Drive docs and sheets into the Library and the Brain.", run: null },
  { key: "group-digest", name: "Group digest", icon: MessageSquare, schedule: "Daily 04:00 UTC", does: "Summarizes the WhatsApp group feed into the timelines.", run: null },
  { key: "task-digest", name: "Task digest", icon: ListChecks, schedule: "Daily 16:30 UTC", does: "Sends the afternoon roundup of open and shifting tasks.", run: null },
];

const STATUS_TONE: any = { live: "green", partial: "gold", soon: "gray" };
const LANES = ["auto", "approve", "escalate"];
const laneTone: any = { auto: "green", approve: "gold", escalate: "red" };
const ago = (iso: string) => { const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); return s < 60 ? "now" : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`; };

export default async function Agents() {
  const db = admin();
  const [{ data: connectors }, { data: rules }, { data: runs }, { data: events }] = await Promise.all([
    db.from("connector_registry").select("*").order("name"),
    db.from("autonomy_rules").select("*").order("scope"),
    db.from("agent_runs").select("agent,decision,output,status,created_at").order("created_at", { ascending: false }).limit(12),
    db.from("events").select("type,payload,created_at").order("created_at", { ascending: false }).limit(16),
  ]);

  // Real last-run per agent, drawn from agent_runs (the only run history we hold).
  const lastRunByAgent: Record<string, string> = {};
  for (const r of (runs || []) as any[]) {
    if (r.agent && !lastRunByAgent[r.agent]) lastRunByAgent[r.agent] = r.created_at;
  }
  const liveCount = AGENTS.filter((a) => a.status === "live").length;
  const enabledConnectors = (connectors || []).filter((c: any) => c.enabled).length;
  // Last scan = the most recent run we actually recorded, if any.
  const lastScan = (runs && runs[0]) ? ago(runs[0].created_at) : null;

  const evLabel = (e: any) => {
    const p = e.payload || {};
    const map: Record<string, string> = {
      "agent.decided": `Sasa drafted a ${p.kind === "donor_thankyou" ? "thank-you" : "reply"}${p.from ? ` to ${p.from}` : ""}`,
      "approval.created": `${p.title || "Item"} queued for you`,
      "approval.approved": "You approved an action", "approval.rejected": "You declined a draft",
      "action.executed": `Sent${p.to ? ` to ${p.to}` : ""}`, "action.failed": "Action failed",
      "task.assigned": `Task assigned${p.assignee ? ` to ${p.assignee}` : ""}`,
      "asset.ingested": `Filed "${p.title || "asset"}" to the Library`,
      "payment.verified": "Payment logged", "autonomy.changed": `Dial changed: ${p.scope || ""} → ${p.lane || ""}`,
    };
    return map[e.type] || e.type.replace(/\./g, " ");
  };

  return (
    <Shell title="Automations" sub="The control room: every scheduled job and agent, what it does, when it runs, and what it last did" action={<Badge tone="teal">Sasa active</Badge>}>
      {/* status line — the one headline: how much is running right now */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="between" style={{ flexWrap: "wrap", gap: 16 }}>
          <div className="flex" style={{ gap: 14 }}>
            <span className="aico green"><Bot size={18} /></span>
            <div>
              <div className="disp2" style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>
                {liveCount} automation{liveCount === 1 ? "" : "s"} active
              </div>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
                {JOBS.length} scheduled jobs · {enabledConnectors} connector{enabledConnectors === 1 ? "" : "s"} on
                {lastScan ? ` · last scan ${lastScan} ago` : " · no scan recorded yet"}
              </div>
            </div>
          </div>
          <div className="flex" style={{ gap: 6 }}>
            <Badge tone="green">{liveCount} live</Badge>
            <Badge tone="gold">{AGENTS.filter((a) => a.status === "partial").length} partial</Badge>
            <Badge tone="gray">{AGENTS.filter((a) => a.status === "soon").length} planned</Badge>
          </div>
        </div>
      </div>

      {/* scheduled jobs — the roster, one clean row per cron */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-h"><span className="flex"><Clock size={15} /> Scheduled jobs</span><span className="faint" style={{ fontSize: 11.5, fontWeight: 500 }}>times in UTC</span></div>
        <div style={{ padding: "4px 18px 12px" }}>
          {JOBS.map((j, i) => {
            const last = j.run ? lastRunByAgent[j.run] : undefined;
            return (
              <div key={j.key} className="actrow" style={{ padding: "13px 6px", borderTop: i ? "1px solid var(--line)" : "none" }}>
                <span className="aico teal"><j.icon size={15} /></span>
                <div className="abody">
                  <div className="atitle" style={{ fontWeight: 600 }}>{j.name}</div>
                  <div className="ameta">{j.does}</div>
                </div>
                <div className="flex" style={{ gap: 8, flexShrink: 0 }}>
                  <Badge tone="gray">{j.schedule}</Badge>
                  {last
                    ? <span className="aright">ran {ago(last)} ago</span>
                    : <span className="aright faint">last run not tracked</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* the agents — who does the work, with real last-run from agent_runs */}
      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        {AGENTS.map((a) => {
          const last = a.run ? lastRunByAgent[a.run] : undefined;
          return (
            <div key={a.key} className="card card-pad hover">
              <div className="flex" style={{ marginBottom: 8 }}>
                <span className="aico teal"><a.icon size={16} /></span>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{a.name}</span>
                <span style={{ marginLeft: "auto" }}><Badge tone={STATUS_TONE[a.status] || "gray"}>{a.status}</Badge></span>
              </div>
              <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>{a.desc}</div>
              <div className="faint flex" style={{ fontSize: 11, marginTop: 10, gap: 6 }}>
                <Clock size={11} />
                {last ? `last ran ${ago(last)} ago` : a.status === "soon" ? "not running yet" : "no run recorded yet"}
              </div>
            </div>
          );
        })}
      </div>

      {/* control panels (Phase 2.6 Stage C): activity, autonomy, connectors,
          and recent runs collapsed into a TabbedPane so the page reads as
          one viewport instead of 5,702px on mobile. */}
      {(() => {
        const tabs: TabbedTab[] = [
          {
            id: "activity",
            label: "Activity stream",
            hint: "what just happened",
            body: (() => {
              const human = filterHumanEvents(events as any[]);
              if (human.length === 0) return <div className="empty">No activity yet.</div>;
              return (
                <div>
                  {human.map((e: any, i: number) => (
                    <div key={i} className="actrow">
                      <span className="aico teal"><Bot size={14} /></span>
                      <div className="abody"><div className="atitle">{evLabel(e)}</div></div>
                      <span className="aright">{ago(e.created_at)}</span>
                    </div>
                  ))}
                </div>
              );
            })(),
          },
          {
            id: "autonomy",
            label: "Autonomy dials",
            count: (rules || []).length,
            hint: "what runs on its own",
            body: (
              <div>
                <div className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>How much each kind of action can do on its own. Tighten or loosen as you learn to trust it.</div>
                {(rules || []).map((r: any) => (
                  <div key={r.scope} className="between" style={{ padding: "11px 0", borderTop: "1px solid var(--line)" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{r.scope.replace(/^(kind|connector):/, "").replace(/_/g, " ")}</div>
                      {r.note && <div className="faint" style={{ fontSize: 11 }}>{r.note}</div>}
                    </div>
                    <div className="flex" style={{ gap: 4 }}>
                      {LANES.map((l) => (
                        <form action={setLane} key={l}>
                          <input type="hidden" name="scope" value={r.scope} />
                          <input type="hidden" name="lane" value={l} />
                          <button type="submit" className="pill" style={r.lane === l ? { background: "var(--ink)", color: "#fff", borderColor: "var(--ink)" } : {}}>{l}</button>
                        </form>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ),
          },
          {
            id: "connectors",
            label: "Connectors",
            count: (connectors || []).length,
            hint: "what Sasa can reach",
            body: (
              <div>
                {(connectors || []).map((c: any) => (
                  <div key={c.key} className="between" style={{ padding: "10px 0", borderTop: "1px solid var(--line)" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{c.name}</div>
                      <div className="faint" style={{ fontSize: 11 }}>{c.mechanism} · {c.kind}</div>
                    </div>
                    <form action={toggleConnector} className="flex">
                      <input type="hidden" name="key" value={c.key} />
                      <input type="hidden" name="enabled" value={String(c.enabled)} />
                      <button type="submit" className="pill" style={c.enabled ? { background: "#E7F6EC", color: "#15803D", borderColor: "#C7EBD2" } : {}}>{c.enabled ? "on" : "off"}</button>
                    </form>
                  </div>
                ))}
              </div>
            ),
          },
          {
            id: "runs",
            label: "Recent agent runs",
            count: (runs || []).length,
            hint: "the audit trail",
            body: (
              <div>
                {(runs || []).length === 0 && <div className="empty">No runs yet.</div>}
                {(runs || []).map((r: any, i: number) => (
                  <div key={i} className="between" style={{ padding: "9px 0", borderTop: i ? "1px solid var(--line)" : "none", fontSize: 12.5 }}>
                    <span className="flex"><Bot size={13} color="var(--teal-700)" /> {r.agent?.replace("agent:", "")}</span>
                    <span className="flex">
                      <Badge tone={r.status === "error" ? "red" : laneTone[r.output?.lane] || "gray"}>{r.decision}</Badge>
                      <span className="faint">{ago(r.created_at)}</span>
                    </span>
                  </div>
                ))}
              </div>
            ),
          },
        ];
        return <TabbedPane tabs={tabs} initialId="activity" />;
      })()}
    </Shell>
  );
}
