import Shell from "../../components/Shell";
import { Badge } from "../../components/ui";
import { admin } from "../../lib/supabase-admin";
import { addAccount } from "./actions";
import { Building2, Mail, Bot, MessageSquareQuote, ChevronRight, Plus } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Settings() {
  const db = admin();
  const [{ data: accounts }, { data: connectors }, { data: voice }] = await Promise.all([
    db.from("email_accounts").select("*").order("created_at"),
    db.from("connector_registry").select("key,name,enabled"),
    db.from("agent_memory").select("title,content,brand").eq("kind", "brand_voice"),
  ]);
  const enabled = (connectors || []).filter((c: any) => c.enabled).length;

  return (
    <Shell title="Settings" sub="Organization, accounts, automation, and voice">
      <div className="grid cols-2">
        {/* organization */}
        <div className="card">
          <div className="card-h"><span className="flex"><Building2 size={15} /> Organization</span></div>
          <div className="card-pad stack" style={{ gap: 10, fontSize: 13 }}>
            <div className="between"><span className="muted">Name</span><span className="strong">By Nisria Inc</span></div>
            <div className="between"><span className="muted">Org email</span><span>sasa@nisria.co</span></div>
            <div className="between"><span className="muted">Type</span><span>US nonprofit (Florida)</span></div>
            <div className="between"><span className="muted">Brands</span><span className="flex"><span className="chip nisria"><span className="bdot" />Nisria</span><span className="chip maisha"><span className="bdot" />Maisha</span><span className="chip ahadi"><span className="bdot" />AHADI</span></span></div>
            <div className="between"><span className="muted">Monthly goal</span><span className="strong">$5,000</span></div>
          </div>
        </div>

        {/* automation */}
        <a className="card hover" href="/agents" style={{ textDecoration: "none" }}>
          <div className="card-h"><span className="flex"><Bot size={15} /> Automation</span><ChevronRight size={15} /></div>
          <div className="card-pad" style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.6 }}>
            {enabled} of {(connectors || []).length} connectors on. Tune what the agents can do on their own, toggle connectors, and watch the activity stream in <span style={{ color: "var(--teal-700)", fontWeight: 600 }}>Agents</span>.
          </div>
        </a>

        {/* connected accounts */}
        <div className="card">
          <div className="card-h"><span className="flex"><Mail size={15} /> Connected accounts</span><Badge tone="gray">{(accounts || []).length}</Badge></div>
          <div style={{ padding: "4px 18px 14px" }}>
            {(accounts || []).map((a: any) => (
              <div key={a.id} className="between" style={{ padding: "10px 0", borderTop: "1px solid var(--line)" }}>
                <div><div className="strong" style={{ fontSize: 13 }}>{a.address}</div><div className="faint" style={{ fontSize: 11.5 }}>{a.label || a.brand} · {a.channel}</div></div>
                <Badge tone={a.active ? "green" : "gray"}>{a.active ? "active" : "off"}</Badge>
              </div>
            ))}
            <form action={addAccount} className="stack" style={{ gap: 8, marginTop: 12 }}>
              <input name="address" placeholder="email address or handle" />
              <div className="flex" style={{ gap: 8 }}>
                <select name="brand" defaultValue="nisria"><option value="nisria">Nisria</option><option value="maisha">Maisha</option><option value="ahadi">AHADI</option></select>
                <select name="channel" defaultValue="email"><option value="email">Email</option><option value="whatsapp">WhatsApp</option><option value="social">Social</option></select>
                <button className="btn sm" type="submit"><Plus size={13} /> Add</button>
              </div>
            </form>
          </div>
        </div>

        {/* brand voice */}
        <div className="card">
          <div className="card-h"><span className="flex"><MessageSquareQuote size={15} /> Brand voice</span><Badge tone="teal">learned</Badge></div>
          <div style={{ padding: "4px 18px 14px" }}>
            {(voice || []).length === 0 && <div className="empty">No voice guidance yet.</div>}
            {(voice || []).map((v: any, i: number) => (
              <div key={i} style={{ padding: "10px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
                <div className="strong" style={{ fontSize: 12.5 }}>{v.title}</div>
                <div className="faint" style={{ fontSize: 11.5, lineHeight: 1.5, marginTop: 2 }}>{(v.content || "").slice(0, 150)}…</div>
              </div>
            ))}
            <div className="faint" style={{ fontSize: 11.5, marginTop: 10 }}>Sasa learns your voice from every reply you approve.</div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
