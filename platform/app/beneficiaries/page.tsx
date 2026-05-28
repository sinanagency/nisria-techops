import Shell from "../../components/Shell";
import { Card, Table, Badge, Col, statusTone } from "../../components/ui";
import { admin, money, date } from "../../lib/supabase-admin";
import BeneficiaryPeek from "../../components/BeneficiaryPeek";
import BeneficiaryIntake from "../../components/BeneficiaryIntake";
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
  const cat = one("cat"); // category cohort (the real segmentation)

  const active: Record<string, string> = {};
  if (q) active.q = q;
  if (program) active.program = program;
  if (status) active.status = status;
  if (consent) active.consent = consent;
  if (cat) active.cat = cat;

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
  if (cat) rows = rows.filter((r: any) => (r.category || "") === cat);

  const isFiltered = !!(q || program || status || consent || cat);
  const publicCount = (data || []).filter((r: any) => r.consent_public).length;

  // Cohort overview from the real category + lifecycle segmentation. The
  // transitioned children are honored as Alumni (past children who left care),
  // each still on the platform with their profile. Counts come from the full
  // set (pre-filter) so the band is a stable map of the whole programme.
  const all = (data || []) as any[];
  const inCat = (needle: string) => all.filter((r: any) => (r.category || "").toLowerCase().includes(needle));
  const rescue = inCat("kwetu");
  const rescueInCare = rescue.filter((r: any) => (r.status || "") !== "transitioned");
  const alumni = all.filter((r: any) => (r.status || "") === "transitioned");
  const microfund = inCat("microfund");
  const KWETU = "Kwetu Haven (rescue)", MICRO = "Microfund (women)";
  const COHORTS = [
    { key: "rescue", label: "Rescue children", sub: "In care at Kwetu Haven now", count: rescueInCare.length, tone: "teal", href: qs({}, { cat: KWETU, status: "active" }) },
    { key: "alumni", label: "Alumni", sub: "Past children who transitioned out", count: alumni.length, tone: "peri", href: qs({}, { status: "transitioned" }) },
    { key: "micro", label: "Microfund women", sub: "Jiinue Women's Group entrepreneurs", count: microfund.length, tone: "gold", href: qs({}, { cat: MICRO }) },
  ];
  const cohortActive = (k: string) =>
    (k === "rescue" && cat === KWETU && status === "active") ||
    (k === "alumni" && status === "transitioned") ||
    (k === "micro" && cat === MICRO);

  // resolve signed thumbnail URLs for the rows that have a photo (batch, private bucket)
  const photoIds = [...new Set(rows.filter((r: any) => r.photo_asset_id).map((r: any) => r.photo_asset_id))];
  if (photoIds.length) {
    const { data: assets } = await db.from("assets").select("id,storage_path").in("id", photoIds);
    const pathById = new Map((assets || []).map((a: any) => [a.id, a.storage_path]));
    const paths = [...new Set([...pathById.values()].filter(Boolean))] as string[];
    if (paths.length) {
      const { data: signed } = await db.storage.from("assets").createSignedUrls(paths, 3600);
      const urlByPath = new Map((signed || []).map((s: any) => [s.path, s.signedUrl]));
      for (const r of rows) {
        const p = pathById.get(r.photo_asset_id);
        if (p) r._photoUrl = urlByPath.get(p) || null;
      }
    }
  }

  const cols: Col<any>[] = [
    { key: "ref_code", label: "Ref", render: (r: any) => <span className="strong">{r.ref_code || "—"}</span> },
    { key: "full_name", label: "Name", render: (r: any) => <BeneficiaryPeek b={r} /> },
    {
      key: "category", label: "Cohort", render: (r: any) => {
        const c = r.category || "";
        if (c.toLowerCase().includes("kwetu")) return <Badge tone="teal">Kwetu Haven</Badge>;
        if (c.toLowerCase().includes("microfund")) return <Badge tone="gold">Microfund</Badge>;
        return c ? <Badge tone="gray">{c}</Badge> : "—";
      },
    },
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

  const sub = `${rows.length} ${rows.length === 1 ? "record" : "records"} · private to you and Nur`;

  return (
    <Shell title="Beneficiaries" sub={sub} action={<Badge tone="gold">{publicCount} public profiles live</Badge>}>
      {/* cohort band — the real programme map: who is in care, who transitioned out,
          and the Microfund women. Each tile filters the list. */}
      <div className="cohort-band" style={{ marginBottom: 16 }}>
        {COHORTS.map((c) => (
          <a key={c.key} href={c.href} className={`cohort-tile ${cohortActive(c.key) ? "on" : ""}`}>
            <span className={`cohort-dot ${c.tone}`} />
            <span className="cohort-num">{c.count}</span>
            <span className="cohort-label">{c.label}</span>
            <span className="cohort-sub">{c.sub}</span>
          </a>
        ))}
        <a href="/beneficiaries" className={`cohort-tile ${!isFiltered ? "on" : ""}`}>
          <span className="cohort-dot gray" />
          <span className="cohort-num">{all.length}</span>
          <span className="cohort-label">Everyone</span>
          <span className="cohort-sub">All records, clear filters</span>
        </a>
      </div>

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

      {/* TOOL — below the list: you come here to see people; adding is secondary. PII stays private. */}
      <div id="beneficiary-intake" style={{ marginTop: 16 }}>
        <BeneficiaryIntake />
      </div>
    </Shell>
  );
}
