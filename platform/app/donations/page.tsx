import Shell from "../../components/Shell";
import { Card, Table, Badge, Col, statusTone } from "../../components/ui";
import { admin, money, date } from "../../lib/supabase-admin";
import { Search } from "lucide-react";

export const dynamic = "force-dynamic";

// Build a querystring for a filter pill while preserving the other active filters.
function qs(current: Record<string, string>, patch: Record<string, string | undefined>) {
  const next: Record<string, string> = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === "") delete next[k];
    else next[k] = v;
  }
  const s = new URLSearchParams(next).toString();
  return s ? `/donations?${s}` : "/donations";
}

const STATUS_OPTS = ["succeeded", "pending", "refunded", "failed"];
const RANGE_OPTS: { v: string; label: string }[] = [
  { v: "30", label: "30 days" },
  { v: "90", label: "90 days" },
  { v: "365", label: "1 year" },
  { v: "all", label: "All time" },
];

export default async function Donations({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  // normalize incoming filters
  const sp = searchParams || {};
  const one = (k: string) => (Array.isArray(sp[k]) ? (sp[k] as string[])[0] : (sp[k] as string | undefined)) || "";
  const q = one("q").trim();
  const recurring = one("recurring"); // yes | no | ""
  const status = one("status"); // succeeded | pending | refunded | failed | ""
  const range = one("range") || "all"; // 30 | 90 | 365 | all

  // querystring base (used to build pill links without losing other filters)
  const active: Record<string, string> = {};
  if (q) active.q = q;
  if (recurring) active.recurring = recurring;
  if (status) active.status = status;
  if (range && range !== "all") active.range = range;

  const db = admin();
  const { data } = await db
    .from("donations")
    .select("*,donor:donors(full_name),campaign:campaigns(name)")
    .order("donated_at", { ascending: false })
    .limit(500);

  // apply filters in-memory (small dataset, keeps the joined select intact)
  let rows = (data || []) as any[];
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter((r) => (r.donor?.full_name || "Anonymous").toLowerCase().includes(needle));
  }
  if (recurring === "yes") rows = rows.filter((r) => !!r.is_recurring);
  if (recurring === "no") rows = rows.filter((r) => !r.is_recurring);
  if (status) rows = rows.filter((r) => (r.status || "").toLowerCase() === status);
  if (range !== "all") {
    const days = Number(range);
    if (!Number.isNaN(days)) {
      const cutoff = Date.now() - days * 86400000;
      rows = rows.filter((r) => r.donated_at && new Date(r.donated_at).getTime() >= cutoff);
    }
  }

  const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
  const isFiltered = !!(q || recurring || status || (range && range !== "all"));

  const cols: Col<any>[] = [
    { key: "donor", label: "Donor", render: (r) => <span className="strong">{r.donor?.full_name || "Anonymous"}</span> },
    { key: "campaign", label: "Campaign", render: (r) => r.campaign?.name || "—" },
    { key: "channel", label: "Channel" },
    { key: "is_recurring", label: "Recurring", render: (r) => (r.is_recurring ? <Badge tone="blue">monthly</Badge> : "—") },
    { key: "status", label: "Status", render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
    { key: "donated_at", label: "Date", render: (r) => date(r.donated_at) },
    { key: "amount", label: "Amount", align: "right", render: (r) => <span className="strong">{money(r.amount)}</span> },
  ];

  const sub = `${rows.length} ${rows.length === 1 ? "gift" : "gifts"}${isFiltered ? ` · ${money(total)} matched` : ""}`;

  return (
    <Shell title="Donations" sub={sub}>
      {/* filters */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="stack" style={{ gap: 14 }}>
          {/* search */}
          <form method="GET" action="/donations" className="flex" style={{ gap: 8 }}>
            <input type="hidden" name="recurring" value={recurring} />
            <input type="hidden" name="status" value={status} />
            <input type="hidden" name="range" value={range} />
            <input name="q" defaultValue={q} placeholder="Search donor name…" style={{ maxWidth: 320 }} />
            <button className="btn ghost sm" type="submit"><Search size={14} /> Search</button>
            {q && (
              <a className="pill" href={qs(active, { q: undefined })}>Clear “{q}”</a>
            )}
          </form>

          {/* recurring */}
          <div className="flex wrap" style={{ gap: 6 }}>
            <span className="faint" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em", minWidth: 76 }}>Recurring</span>
            <a className={`pill ${!recurring ? "on" : ""}`} href={qs(active, { recurring: undefined })}>All</a>
            <a className={`pill ${recurring === "yes" ? "on" : ""}`} href={qs(active, { recurring: "yes" })}>Monthly</a>
            <a className={`pill ${recurring === "no" ? "on" : ""}`} href={qs(active, { recurring: "no" })}>One-off</a>
          </div>

          {/* status */}
          <div className="flex wrap" style={{ gap: 6 }}>
            <span className="faint" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em", minWidth: 76 }}>Status</span>
            <a className={`pill ${!status ? "on" : ""}`} href={qs(active, { status: undefined })}>All</a>
            {STATUS_OPTS.map((s) => (
              <a key={s} className={`pill ${status === s ? "on" : ""}`} href={qs(active, { status: s })}>{s}</a>
            ))}
          </div>

          {/* range */}
          <div className="flex wrap" style={{ gap: 6 }}>
            <span className="faint" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em", minWidth: 76 }}>Period</span>
            {RANGE_OPTS.map((r) => (
              <a key={r.v} className={`pill ${range === r.v ? "on" : ""}`} href={qs(active, { range: r.v === "all" ? undefined : r.v })}>{r.label}</a>
            ))}
          </div>
        </div>
      </div>

      <Card title="All donations">
        <Table
          columns={cols}
          rows={rows}
          empty={isFiltered ? "No donations match these filters." : "No donations yet."}
        />
      </Card>
    </Shell>
  );
}
