import Shell from "../../components/Shell";
import { Badge } from "../../components/ui";
import { admin } from "../../lib/supabase-admin";
import { setLane, toggleConnector } from "./actions";
import { Bot, Mail, HeartHandshake, PenLine, Megaphone, Database, Plug } from "lucide-react";

export const dynamic = "force-dynamic";

// Each badge reflects what ACTUALLY runs in app/api/agents/tick (the 6am cron)
// and app/api/grants/prepare (the 6:30am cron):
//  - live    : runs autonomously today, end to end
//  - partial : a real engine runs for part of the job; the rest is not built yet
//  - soon    : not built; on the roadmap, shown so the surface stays honest
const AGENTS = [
  { key: "conductor", name: "Sasa · Chief of Staff", icon: Bot, desc: "Writes your daily brief on the cron and answers you in chat. Routing across the other agents is still growing.", status: "live" },
  { key: "comms", name: "Comms agent", icon: Mail, desc: "Reads inbound mail, classifies it, drafts replies in your voice, and queues them for approval.", status: "live" },
  { key: "steward", name: "Donor Steward", icon: HeartHandshake, desc: "Drafts a thank-you for each new gift and queues it for you. Lapsing-donor outreach is next.", status: "live" },
  { key: "fundraising", name: "Fundraising agent", icon: Megaphone, desc: "Auto-pursues strong grant opportunities and drafts the full application into Review for you. Campaign pushes are not built yet.", status: "partial" },
  { key: "content", name: "Content agent", icon: PenLine, desc: "Will draft posts and the newsletter from activity and assets. Not built yet.", status: "soon" },
  { key: "field", name: "Field / Data agent", icon: Database, desc: "Will keep beneficiary and inventory records clean from the WhatsApp feed. Not built yet.", status: "soon" },
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
    <Shell title="Agents" sub="The mesh: who's working, what they can do on their own, and what they've done" action={<Badge tone="teal">Sasa active</Badge>}>
      {/* the fleet */}
      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        {AGENTS.map((a) => (
          <div key={a.key} className="card card-pad hover">
            <div className="flex" style={{ marginBottom: 8 }}>
              <span className="aico teal"><a.icon size={16} /></span>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{a.name}</span>
              <span style={{ marginLeft: "auto" }}><Badge tone={STATUS_TONE[a.status] || "gray"}>{a.status}</Badge></span>
            </div>
            <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>{a.desc}</div>
          </div>
        ))}
      </div>

      {/* activity stream (moved here from Mission Control) */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-h">Activity stream</div>
        <div style={{ padding: "6px 18px 12px", maxHeight: 240, overflowY: "auto" }}>
          {(events || []).length === 0 && <div className="empty">No activity yet.</div>}
          {(events || []).map((e: any, i: number) => (
            <div key={i} className="actrow">
              <span className="aico teal"><Bot size={14} /></span>
              <div className="abody"><div className="atitle">{evLabel(e)}</div></div>
              <span className="aright">{ago(e.created_at)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        {/* autonomy dials */}
        <div className="card">
          <div className="card-h">Autonomy dials</div>
          <div style={{ padding: "8px 18px 16px" }}>
            <div className="muted" style={{ fontSize: 12.5, margin: "6px 0 12px" }}>How much each kind of action can do on its own. Tighten or loosen as you learn to trust it.</div>
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
        </div>

        {/* connectors + runs */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card">
            <div className="card-h"><span className="flex"><Plug size={15} /> Connectors</span></div>
            <div style={{ padding: "4px 18px 14px" }}>
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
          </div>

          <div className="card">
            <div className="card-h">Recent agent runs</div>
            <div style={{ padding: "4px 18px 14px" }}>
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
          </div>
        </div>
      </div>
    </Shell>
  );
}
