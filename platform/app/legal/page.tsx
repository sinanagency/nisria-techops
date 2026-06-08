import Shell from "../../components/Shell";
import { Card, Badge, Stat } from "../../components/ui";
import Collapsible from "../../components/Collapsible";
import DocReader from "../../components/DocReader";
import { admin, date } from "../../lib/supabase-admin";
import { ShieldCheck, Landmark, Globe2, FileCheck2, Scale, Building2, ChevronRight, CalendarClock } from "lucide-react";

export const dynamic = "force-dynamic";

// Legal & Compliance: the entity facts and compliance posture as NATIVE structured
// data, not a file viewer. The facts are authoritative (US IRS determination letter +
// Kenya CBO registration, mirrored in the Brain). The document register self-populates
// from the filed compliance docs; the original file is demoted to a small source link.

// Authoritative entity facts (US IRS determination letter + Organization identity Brain fact).
const US = {
  name: "By Nisria Inc",
  status: "501(c)(3) public charity",
  clause: "IRC 170(b)(1)(A)(vi)",
  ein: "92-2509133",
  effective: "25 December 2023",
  address: "18117 Biscayne Blvd #61652, Miami, FL 33160",
  obligations: "Contributions tax-deductible · annual Form 990 required · TechSoup verified",
};
const KE = {
  name: "Nisria Community Programme (CBO)",
  reg: "GIL/DSS/CBO/105",
  cert: "Certificate 51260",
  registered: "13 July 2020",
  location: "Gilgil, Nakuru County, Kenya",
  banks: "I&M Bank · Stanbic Bank (mandates on file)",
};

// Compliance obligations with a cadence — the recurring filings Nur must not miss.
const OBLIGATIONS = [
  { label: "IRS Form 990", who: "By Nisria Inc (US)", cadence: "Annual", note: "Federal information return for tax-exempt status" },
  { label: "Kenya Tax Compliance Certificate (TCC)", who: "Nisria Community Programme", cadence: "Annual", note: "KRA compliance renewal" },
  { label: "CBO annual returns", who: "Nisria Community Programme", cadence: "Annual", note: "Department of Social Services reporting" },
  { label: "Land rent & rates clearance", who: "Loving Hand Safe House (Kwetu)", cadence: "Annual", note: "Property at L.R. 1317/221" },
];

type Group = { key: string; label: string; icon: any; tone: string };
const GROUPS: Group[] = [
  { key: "us", label: "US incorporation & tax-exempt", icon: Landmark, tone: "teal" },
  { key: "ke", label: "Kenya registration", icon: Globe2, tone: "peri" },
  { key: "gov", label: "Governance & policies", icon: Scale, tone: "gold" },
  { key: "tax", label: "Tax & clearance certificates", icon: FileCheck2, tone: "green" },
  { key: "prop", label: "Property & safe house", icon: Building2, tone: "blue" },
  { key: "other", label: "Other compliance documents", icon: ShieldCheck, tone: "gray" },
];

function classify(d: any): string {
  const t = (d.title || "").toLowerCase();
  if (/determinat|\bein\b|cp575|finalletter_92|articles of org|\b990\b|usa registration|by nisria inc/.test(t)) return "us";
  if (/tcc|tax compliance|clearance|rates|land rent/.test(t)) return "tax";
  if (/constitution|bylaw|policy|policies|handbook|board members|hr /.test(t)) return "gov";
  if (/lhsh|loving hand|lease|lra 63|coulson|l\.r\. 1317|1317|safe house|transfer of lease/.test(t)) return "prop";
  if (/cbo|kenya registration|\bngo\b|kra pin|nisria - registration|nisria registration|copy of nisria/.test(t)) return "ke";
  return "other";
}

const TYPE_TONE: Record<string, string> = { registration: "teal", policy: "gold", contract: "peri", document: "gray", grant: "peri" };

export default async function Legal() {
  const db = admin();
  const { data } = await db
    .from("documents")
    .select("id,title,doc_type,folder,doc_date,drive_url,summary")
    .or("doc_type.in.(registration,policy,contract),folder.ilike.%Compliance%")
    .limit(500);

  // keep only governance-relevant docs; drop finance noise that happens to sit in the folder
  let docs = (data || []).filter((d: any) => !/expense|budget|receipt|invoice|statement|salaries|payroll/i.test(d.title || ""));
  // collapse duplicate/redundant copies (same normalized title), keep one
  const ntitle = (t: string) => (t || "").toLowerCase().replace(/\[ns\]/g, "").replace(/\bcopy of\b/g, "").replace(/\.(pdf|docx?|doc|xlsx?)$/i, "").replace(/[\s_]*\(?\d+\)?\s*$/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const seenL = new Set<string>();
  docs = docs.filter((d: any) => { const k = ntitle(d.title); if (seenL.has(k)) return false; seenL.add(k); return true; });
  const byGroup: Record<string, any[]> = {};
  for (const d of docs) (byGroup[classify(d)] ||= []).push(d);
  for (const k of Object.keys(byGroup)) byGroup[k].sort((a, b) => (a.title || "").localeCompare(b.title || ""));

  const Fact = ({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) => (
    <div className="between" style={{ fontSize: 13, padding: "8px 0", borderTop: "1px solid var(--line)" }}>
      <span className="muted">{label}</span>
      <span style={{ textAlign: "right", fontWeight: 500, fontVariantNumeric: mono ? "tabular-nums" : undefined }}>{children || "—"}</span>
    </div>
  );

  return (
    <Shell title="Legal & Compliance" sub={`${docs.length} compliance documents on file · entity status verified`} action={<Badge tone="green"><ShieldCheck size={11} /> 501(c)(3) active</Badge>}>
      {/* COMPLIANCE STATUS HEADER (Law 5): lead with the posture that matters.
          Both legal entities are registered and in good standing; the right rail
          states the recurring obligations being tracked. All values are the
          authoritative entity facts above, no new query. */}
      <div className="feature dark" style={{ marginBottom: 16 }}>
        <div className="between" style={{ alignItems: "flex-start", gap: 22, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <div className="fmeta" style={{ marginTop: 0, marginBottom: 8, letterSpacing: "0.14em", textTransform: "uppercase", fontSize: 11, fontWeight: 800 }}>Registration status</div>
            <div className="disp2" style={{ fontSize: 36, fontWeight: 700, lineHeight: 1.0 }}>Both entities registered, in good standing</div>
            <div className="flex" style={{ gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              <Badge tone="green"><Landmark size={11} /> US 501(c)(3) active</Badge>
              <Badge tone="green"><Globe2 size={11} /> Kenya CBO registered</Badge>
              <Badge tone="gold"><CalendarClock size={11} /> {OBLIGATIONS.length} recurring filings tracked</Badge>
            </div>
          </div>
          <div className="stack" style={{ gap: 6, minWidth: 220, flex: "1 1 220px", maxWidth: 360, textAlign: "right" }}>
            <div className="fmeta" style={{ marginTop: 0, letterSpacing: "0.14em", textTransform: "uppercase", fontSize: 11, fontWeight: 800 }}>Documents on file</div>
            <div className="disp2" style={{ fontSize: 40, fontWeight: 700, lineHeight: 0.95 }}>{docs.length}</div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "#7df3f1" }}>across registration, governance, leases and certificates</div>
          </div>
        </div>
      </div>

      {/* status strip: the headline facts per entity as stat cards */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 16 }}>
        <Stat label="US tax-exempt status" value={<span style={{ fontSize: 18 }} className="disp2">501(c)(3)</span>} delta={`EIN ${US.ein} · effective ${US.effective}`} />
        <Stat label="Kenya CBO registration" value={<span style={{ fontSize: 18 }} className="disp2">{KE.reg}</span>} delta={`Cert. ${KE.cert} · ${KE.registered}`} />
        <Stat label="Recurring filings" value={<span className="disp2">{OBLIGATIONS.length}</span>} delta="annual obligations tracked" />
        <Stat label="Compliance documents" value={<span className="disp2">{docs.length}</span>} delta="self-populating from the register" />
      </div>

      {/* entity registration: the two legal entities as cards with status badges + dates */}
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 16 }}>
        <Card title={<span className="flex"><Landmark size={15} /> Entity registration · United States</span> as any} action={<Badge tone="green"><ShieldCheck size={11} /> active</Badge>}>
          <div className="card-pad" style={{ paddingTop: 16, paddingBottom: 16 }}>
            <div className="flex" style={{ gap: 9, marginBottom: 6 }}><span className="aico teal" style={{ width: 30, height: 30, borderRadius: 9 }}><Landmark size={15} /></span><div><div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15 }}>{US.name}</div><div className="faint" style={{ fontSize: 12 }}>United States</div></div></div>
            <div className="stack" style={{ gap: 0 }}>
              <Fact label="Status"><Badge tone="green">{US.status}</Badge></Fact>
              <Fact label="IRS clause">{US.clause}</Fact>
              <Fact label="EIN" mono>{US.ein}</Fact>
              <Fact label="Effective">{US.effective}</Fact>
              <Fact label="Registered address">{US.address}</Fact>
            </div>
            <div className="faint" style={{ fontSize: 11.5, lineHeight: 1.5, marginTop: 10 }}>{US.obligations}</div>
          </div>
        </Card>
        <Card title={<span className="flex"><Globe2 size={15} /> Entity registration · Kenya</span> as any} action={<Badge tone="green"><ShieldCheck size={11} /> registered</Badge>}>
          <div className="card-pad" style={{ paddingTop: 16, paddingBottom: 16 }}>
            <div className="flex" style={{ gap: 9, marginBottom: 6 }}><span className="aico peri" style={{ width: 30, height: 30, borderRadius: 9 }}><Globe2 size={15} /></span><div><div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15 }}>{KE.name}</div><div className="faint" style={{ fontSize: 12 }}>Kenya</div></div></div>
            <div className="stack" style={{ gap: 0 }}>
              <Fact label="Registration no.">{KE.reg}</Fact>
              <Fact label="Certificate">{KE.cert}</Fact>
              <Fact label="Registered">{KE.registered}</Fact>
              <Fact label="Location">{KE.location}</Fact>
              <Fact label="Banking">{KE.banks}</Fact>
            </div>
            <div className="faint" style={{ fontSize: 11.5, lineHeight: 1.5, marginTop: 10 }}>Operates under By Nisria Inc; ground spend deployed in Kenya, mostly via M-Pesa.</div>
          </div>
        </Card>
      </div>

      {/* recurring compliance obligations: governance filings with cadence + status */}
      <Collapsible title={<span className="flex"><CalendarClock size={15} /> Recurring filings & obligations</span>} action={<Badge tone="gold"><CalendarClock size={11} /> annual cadence · {OBLIGATIONS.length}</Badge>} defaultOpen>
        <div className="stack" style={{ gap: 0 }}>
          {OBLIGATIONS.map((o) => (
            <div key={o.label} className="between" style={{ padding: "12px 22px", borderTop: "1px solid var(--line)", gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{o.label}</div>
                <div className="faint" style={{ fontSize: 12, marginTop: 1 }}>{o.who} · {o.note}</div>
              </div>
              <Badge tone="gray"><CalendarClock size={10} /> {o.cadence}</Badge>
            </div>
          ))}
        </div>
      </Collapsible>

      {/* document register — self-populating, grouped, original demoted to a source link */}
      <div style={{ marginTop: 16 }} className="stack">
        {GROUPS.filter((g) => (byGroup[g.key] || []).length > 0).map((g) => {
          const list = byGroup[g.key];
          const Icon = g.icon;
          return (
            <Collapsible key={g.key} title={<span className="flex"><Icon size={15} /> {g.label}</span>} action={<Badge tone={g.tone as any}>{list.length}</Badge>} defaultOpen={list.length <= 8}>
              <div className="stack" style={{ gap: 0 }}>
                {list.map((d: any) => (
                  <DocReader key={d.id} doc={{ id: d.id, title: (d.title || "").replace(/^\[NS\]\s*/, "").replace(/\.(pdf|docx?|doc)$/i, ""), drive_url: d.drive_url, icon: "shield" }} className="docrow">
                    <span className="between" style={{ padding: "11px 22px", borderTop: "1px solid var(--line)", gap: 12, alignItems: "flex-start" }}>
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: "block", fontWeight: 600, fontSize: 13, lineHeight: 1.35 }}>{(d.title || "").replace(/^\[NS\]\s*/, "").replace(/\.(pdf|docx?|doc)$/i, "")}</span>
                        {d.summary
                          ? <span className="muted" style={{ display: "block", fontSize: 12, marginTop: 2, lineHeight: 1.5 }}>{d.summary}</span>
                          : <span className="faint" style={{ display: "block", fontSize: 11.5, marginTop: 2 }}>On file{d.doc_date ? ` · ${date(d.doc_date)}` : ""}</span>}
                      </span>
                      <span className="flex" style={{ gap: 8, flexShrink: 0 }}>
                        <Badge tone={(TYPE_TONE[d.doc_type] || "gray") as any}>{d.doc_type}</Badge>
                        <ChevronRight size={14} style={{ color: "var(--faint)" }} />
                      </span>
                    </span>
                  </DocReader>
                ))}
              </div>
            </Collapsible>
          );
        })}
      </div>
    </Shell>
  );
}
