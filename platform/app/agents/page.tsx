import Shell from "../../components/Shell";
import { Badge } from "../../components/ui";
import { admin } from "../../lib/supabase-admin";
import { setLane, toggleConnector } from "./actions";
import { Bot, Mail, HeartHandshake, PenLine, Megaphone, Database, Plug } from "lucide-react";

export const dynamic = "force-dynamic";

const AGENTS = [
  { key: "conductor", name: "Sasa · Chief of Staff", icon: Bot, desc: "Routes work, writes your brief, talks to you.", status: "live" },
  { key: "comms", name: "Comms agent", icon: Mail, desc: "Reads inbound mail, drafts replies, learns your voice.", status: "live" },
  { key: "steward", name: "Donor Steward", icon: HeartHandshake, desc: "Thanks donors, flags lapsing relationships.", status: "soon" },
  { key: "content", name: "Content agent", icon: PenLine, desc: "Drafts posts + newsletter from activity + assets.", status: "soon" },
  { key: "fundraising", name: "Fundraising agent", icon: Megaphone, desc: "Drafts grants + campaign pushes.", status: "soon" },
  { key: "field", name: "Field / Data agent", icon: Database, desc: "Keeps beneficiary + inventory records clean.", status: "soon" },
];
const LANES = ["auto", "approve", "escalate"];
const laneTone: any = { auto: "green", approve: "gold", escalate: "red" };
const ago = (iso: string) => { const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); return s < 60 ? "now" : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`; };

export default async function Agents() {
  const db = admin();
  const [{ data: connectors }, { data: rules }, { data: runs }] = await Promise.all([
    db.from("connector_registry").select("*").order("name"),
    db.from("autonomy_rules").select("*").order("scope"),
    db.from("agent_runs").select("agent,decision,output,status,created_at").order("created_at", { ascending: false }).limit(12),
  ]);

  return (
    <Shell title="Agents" sub="The mesh: who's working, what they can do on their own, and what they've done" action={<Badge tone="teal">Sasa active</Badge>}>
      {/* the fleet */}
      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        {AGENTS.map((a) => (
          <div key={a.key} className="card card-pad hover">
            <div className="flex" style={{ marginBottom: 8 }}>
              <span className="aico teal"><a.icon size={16} /></span>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{a.name}</span>
              <span style={{ marginLeft: "auto" }}><Badge tone={a.status === "live" ? "green" : "gray"}>{a.status === "live" ? "live" : "soon"}</Badge></span>
            </div>
            <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>{a.desc}</div>
          </div>
        ))}
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
