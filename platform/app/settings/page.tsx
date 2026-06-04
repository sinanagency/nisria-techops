import Shell from "../../components/Shell";
import { Badge } from "../../components/ui";
import { admin } from "../../lib/supabase-admin";
import { addAccount, getGrantDocStatus } from "./actions";
import BrainOnboarding from "../../components/BrainOnboarding";
import GrantReadiness from "../../components/GrantReadiness";
import SignatureEditor from "../../components/SignatureEditor";
import MonthlyGoalEditor from "../../components/MonthlyGoalEditor";
import IngestDock from "../../components/IngestDock";
import LogoUploader from "../../components/LogoUploader";
import IntegrationsCard from "../../components/IntegrationsCard";
import { getIntegration } from "../../lib/integrations";
import { getMonthlyGoal } from "../../lib/org-settings";
import { money } from "../../lib/supabase-admin";
import { SECTION_KEYS, MULTI_SECTION_KEYS } from "../../lib/brain";
import { getLogos } from "../../lib/logos";
import { GRANT_DOC_SPECS } from "../../lib/grant-docs";
import { Building2, Mail, Bot, MessageSquareQuote, ChevronRight, Plus } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Settings() {
  const db = admin();
  const [{ data: accounts }, { data: connectors }, { data: voice }, { data: profile }, { data: grantDocs }, { data: entryRows }, grantStatus, monthlyGoal, logos, zanii] = await Promise.all([
    db.from("email_accounts").select("*").order("created_at"),
    db.from("connector_registry").select("key,name,enabled"),
    db.from("agent_memory").select("title,content,brand").eq("kind", "brand_voice"),
    db.from("org_profile").select("section,content"),
    db
      .from("studio_documents")
      .select("id,kind,title,doc_type,html,created_at")
      .in("kind", GRANT_DOC_SPECS.map((s) => s.kind))
      .order("created_at", { ascending: false })
      .limit(40),
    db.from("brain_entries").select("id,section,title,content,source").in("section", MULTI_SECTION_KEYS).order("sort").order("created_at"),
    getGrantDocStatus(),
    getMonthlyGoal(db),
    getLogos(),
    getIntegration("zanii"),
  ]);
  const enabled = (connectors || []).filter((c: any) => c.enabled).length;

  // map saved onboarding sections -> { section: content } for the Brain UI
  const saved: Record<string, string> = {};
  for (const k of SECTION_KEYS) saved[k] = "";
  for (const row of (profile || []) as any[]) {
    if (row?.section) saved[row.section] = row.content || "";
  }

  // group multi-entry rows by section for the multi-entry panels
  const entries: Record<string, { id: string; title: string; content: string; source?: string | null }[]> = {};
  for (const r of (entryRows || []) as any[]) {
    (entries[r.section] ||= []).push({ id: r.id, title: r.title, content: r.content, source: r.source });
  }

  return (
    <Shell title="Settings" sub="The Brain, organization, accounts, automation, and voice">
      {/* ── Organization ─────────────────────────────────────────────
          Who Nisria is. Identity facts + the configurable fundraising goal. */}
      <SectionLabel first>Organization</SectionLabel>
      <div className="grid cols-2">
        {/* organization */}
        <div className="card">
          <div className="card-h"><span className="flex"><Building2 size={15} /> Organization</span></div>
          <div className="card-pad stack" style={{ gap: 10, fontSize: 13 }}>
            <div className="between"><span className="muted">Name</span><span className="strong">By Nisria Inc</span></div>
            <div className="between"><span className="muted">Org email</span><span>sasa@nisria.co</span></div>
            <div className="between"><span className="muted">Type</span><span>US nonprofit (Florida)</span></div>
            <div className="between"><span className="muted">Brands</span><span className="flex"><span className="chip nisria"><span className="bdot" />Nisria</span><span className="chip maisha"><span className="bdot" />Maisha</span><span className="chip ahadi"><span className="bdot" />AHADI</span></span></div>
            <div className="between"><span className="muted">Monthly goal</span><span className="strong">{money(monthlyGoal)}</span></div>
          </div>
        </div>

        {/* configurable monthly fundraising goal, the dashboard gauge target */}
        <MonthlyGoalEditor goal={monthlyGoal} />
      </div>

      {/* ── The Brain ────────────────────────────────────────────────
          Sasa's knowledge: ingestion, onboarding/voice, grant readiness. */}
      <SectionLabel>The Brain</SectionLabel>
      <div className="grid cols-2">
        {/* One ingestion pipeline, drop everything, Sasa routes it (P7) */}
        <IngestDock />

        {/* The Brain, first-run onboarding, re-runnable + editable, voice + multi-entry */}
        <BrainOnboarding saved={saved} entries={entries} />

        {/* Grant readiness, funder-required inputs + the standard documents */}
        <GrantReadiness saved={saved} docs={(grantDocs || []) as any[]} initialStatus={grantStatus} entries={entries} />

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

      {/* ── Brand & signature ────────────────────────────────────────
          Visual identity that goes out the door: logos + email signatures. */}
      <SectionLabel>Brand &amp; signature</SectionLabel>
      <div className="grid cols-2">
        {/* Brand logos, upload with a live preview, used in signature + docs (P8) */}
        <LogoUploader logos={logos} />

        {/* email signature, branded, per account, auto-appended, with logo (R2-5 #44 / P8) */}
        <SignatureEditor accounts={(accounts || []) as any[]} logos={logos} />
      </div>

      {/* ── Channels & integrations ──────────────────────────────────
          Where Sasa reaches the world: connected accounts + integrations. */}
      <SectionLabel>Channels &amp; integrations</SectionLabel>
      <div className="grid cols-2">
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

        {/* integrations, Zanii stub (P12). Shape now, real code drops in later. */}
        <IntegrationsCard zanii={zanii} />
      </div>

      {/* ── Automation ───────────────────────────────────────────────
          What the agents may do on their own. Links into the Agents surface. */}
      <SectionLabel>Automation</SectionLabel>
      <div className="grid cols-2">
        {/* automation */}
        <a className="card hover" href="/agents" style={{ textDecoration: "none" }}>
          <div className="card-h"><span className="flex"><Bot size={15} /> Automation</span><ChevronRight size={15} /></div>
          <div className="card-pad" style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.6 }}>
            {enabled} of {(connectors || []).length} connectors on. Tune what the agents can do on their own, toggle connectors, and watch the activity stream in <span style={{ color: "var(--teal-700)", fontWeight: 600 }}>Agents</span>.
          </div>
        </a>
      </div>
    </Shell>
  );
}

// A quiet, consistent section heading for grouping the settings surface.
// Presentation-only; matches the uppercase faint-label convention used elsewhere.
function SectionLabel({ children, first }: { children: React.ReactNode; first?: boolean }) {
  return (
    <div
      className="faint disp2"
      style={{
        fontSize: 11.5,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: ".08em",
        margin: first ? "2px 2px 12px" : "26px 2px 12px",
      }}
    >
      {children}
    </div>
  );
}
