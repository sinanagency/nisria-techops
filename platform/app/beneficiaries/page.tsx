import Shell from "../../components/Shell";
import { Card, Table, Badge, Col, statusTone } from "../../components/ui";
import { admin, money, date } from "../../lib/supabase-admin";
import BeneficiaryPeek from "../../components/BeneficiaryPeek";
import { Search, Lock } from "lucide-react";

export const dynamic = "force-dynamic";

// Build a querystring for a filter pill while preserving the other active params.
function qs(current: Record<string, string>, patch: Record<string, string | undefined>) {
  const next: Record<string, string> = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === "") delete next[k];
    else next[k] = v;
  }
  const s = new URLSearchParams(next).toString();
  return s ? `/beneficiaries?${s}` : "/beneficiaries";
}

const PROGRAM_OPTS: { v: string; label: string }[] = [
  { v: "safe_house", label: "Safe house" },
  { v: "education", label: "Education" },
  { v: "rescue", label: "Rescue" },
  { v: "nutrition", label: "Nutrition" },
  { v: "other", label: "Other" },
];
const PROGRAM_LABEL: Record<string, string> = Object.fromEntries(PROGRAM_OPTS.map((p) => [p.v, p.label]));
const STATUS_OPTS = ["active", "graduated", "transitioned", "paused", "exited", "inactive"];

export default async function Beneficiaries({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  const sp = searchParams || {};
  const one = (k: string) => (Array.isArray(sp[k]) ? (sp[k] as string[])[0] : (sp[k] as string | undefined)) || "";
  const q = one("q").trim();
  const program = one("program");
  const status = one("status");
  const consent = one("consent"); // public | private | ""

  const active: Record<string, string> = {};
  if (q) active.q = q;
  if (program) active.program = program;
  if (status) active.status = status;
  if (consent) active.consent = consent;

  const db = admin();
  const { data } = await db
    .from("beneficiaries")
    .select("*")
    .order("intake_date", { ascending: false, nullsFirst: false })
    .limit(500);

  let rows = (data || []) as any[];
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter(
      (r: any) =>
        (r.full_name || "").toLowerCase().includes(needle) ||
        (r.public_name || "").toLowerCase().includes(needle) ||
        (r.ref_code || "").toLowerCase().includes(needle) ||
        (r.location || "").toLowerCase().includes(needle),
    );
  }
  if (program) rows = rows.filter((r: any) => (r.program || "").toLowerCase() === program);
  if (status) rows = rows.filter((r: any) => (r.status || "").toLowerCase() === status);
  if (consent === "public") rows = rows.filter((r: any) => !!r.consent_public);
  if (consent === "private") rows = rows.filter((r: any) => !r.consent_public);

  const isFiltered = !!(q || program || status || consent);
  const publicCount = (data || []).filter((r: any) => r.consent_public).length;

  const cols: Col<any>[] = [
    { key: "ref_code", label: "Ref", render: (r: any) => <span className="strong">{r.ref_code || "—"}</span> },
    { key: "full_name", label: "Name", render: (r: any) => <BeneficiaryPeek b={r} /> },
    { key: "program", label: "Program", render: (r: any) => (r.program ? <Badge tone="teal">{PROGRAM_LABEL[r.program] || r.program}</Badge> : "—") },
    { key: "location", label: "Location", render: (r: any) => (r.location || r.region ? <span className="flex" style={{ gap: 5 }}><Lock size={11} color="var(--faint)" /> {r.location || r.region}</span> : "—") },
    { key: "status", label: "Status", render: (r: any) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
    { key: "consent_public", label: "Public", render: (r: any) => (r.consent_public ? <Badge tone="green">consented</Badge> : <Badge tone="gray">private</Badge>) },
    {
      key: "funded", label: "Funded", align: "right", render: (r: any) => {
        const g = Number(r.goal_amount || 0); const f = Number(r.funded_amount || 0);
        return g > 0 ? <span className="money">{money(f)} / {money(g)}</span> : "—";
      },
    },
  ];

  const sub = `${rows.length} ${rows.length === 1 ? "record" : "records"} · PII, handle with care`;

  return (
    <Shell title="Beneficiaries" sub={sub} action={<Badge tone="gold">{publicCount} public profiles live</Badge>}>
      {/* filters */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="stack" style={{ gap: 14 }}>
          {/* search */}
          <form method="GET" action="/beneficiaries" className="flex" style={{ gap: 8 }}>
            <input type="hidden" name="program" value={program} />
            <input type="hidden" name="status" value={status} />
            <input type="hidden" name="consent" value={consent} />
            <input name="q" defaultValue={q} placeholder="Search name, ref or location…" style={{ maxWidth: 320 }} />
            <button className="btn ghost sm" type="submit"><Search size={14} /> Search</button>
            {q && <a className="pill" href={qs(active, { q: undefined })}>Clear &ldquo;{q}&rdquo;</a>}
          </form>

          {/* program */}
          <div className="flex wrap" style={{ gap: 6 }}>
            <span className="faint" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em", minWidth: 76 }}>Program</span>
            <a className={`pill ${!program ? "on" : ""}`} href={qs(active, { program: undefined })}>All</a>
            {PROGRAM_OPTS.map((p) => (
              <a key={p.v} className={`pill ${program === p.v ? "on" : ""}`} href={qs(active, { program: p.v })}>{p.label}</a>
            ))}
          </div>

          {/* status */}
          <div className="flex wrap" style={{ gap: 6 }}>
            <span className="faint" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em", minWidth: 76 }}>Status</span>
            <a className={`pill ${!status ? "on" : ""}`} href={qs(active, { status: undefined })}>All</a>
            {STATUS_OPTS.map((s) => (
              <a key={s} className={`pill ${status === s ? "on" : ""}`} href={qs(active, { status: s })}>{s}</a>
            ))}
          </div>

          {/* consent */}
          <div className="flex wrap" style={{ gap: 6 }}>
            <span className="faint" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em", minWidth: 76 }}>Public</span>
            <a className={`pill ${!consent ? "on" : ""}`} href={qs(active, { consent: undefined })}>All</a>
            <a className={`pill ${consent === "public" ? "on" : ""}`} href={qs(active, { consent: "public" })}>Consented</a>
            <a className={`pill ${consent === "private" ? "on" : ""}`} href={qs(active, { consent: "private" })}>Private only</a>
          </div>
        </div>
      </div>

      <Card title="All beneficiaries" action={<Badge tone="gold">consent-gated for public</Badge>}>
        <Table
          columns={cols}
          rows={rows}
          empty={isFiltered ? "No beneficiaries match these filters." : "No beneficiaries yet. They enter via the intake form."}
        />
      </Card>
    </Shell>
  );
}
