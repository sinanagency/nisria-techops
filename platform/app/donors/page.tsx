import Shell from "../../components/Shell";
import { Card, Table, Badge, Col, statusTone } from "../../components/ui";
import { admin, money, date } from "../../lib/supabase-admin";
import DonorPeek from "../../components/DonorPeek";
import { Search } from "lucide-react";

export const dynamic = "force-dynamic";

// Build a querystring for a filter/sort pill while preserving the other active
// params (so clicking a status pill keeps the current search + sort, etc.).
function qs(current: Record<string, string>, patch: Record<string, string | undefined>) {
  const next: Record<string, string> = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === "") delete next[k];
    else next[k] = v;
  }
  const s = new URLSearchParams(next).toString();
  return s ? `/donors?${s}` : "/donors";
}

const STATUS_OPTS = ["active", "recurring", "major", "prospect", "lapsed"];
const TYPE_OPTS = ["individual", "organization", "foundation"];
const SORT_OPTS: { v: string; label: string }[] = [
  { v: "recent", label: "Most recent gift" },
  { v: "lifetime", label: "Highest giving" },
  { v: "lifetime_asc", label: "Lowest giving" },
  { v: "name", label: "Name A–Z" },
];

export default async function Donors({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  // normalize incoming params
  const sp = searchParams || {};
  const one = (k: string) => (Array.isArray(sp[k]) ? (sp[k] as string[])[0] : (sp[k] as string | undefined)) || "";
  const q = one("q").trim();
  const status = one("status");
  const type = one("type");
  const recurring = one("recurring"); // yes | no | ""
  const sort = one("sort") || "recent"; // recent (default) | lifetime | name

  // querystring base (used to build pill links without losing other params)
  const active: Record<string, string> = {};
  if (q) active.q = q;
  if (status) active.status = status;
  if (type) active.type = type;
  if (recurring) active.recurring = recurring;
  if (sort && sort !== "recent") active.sort = sort;

  // DEFAULT sort is most-recent-gift first. We pull the full set ordered by the
  // primary sort at the DB, then apply in-memory filters (small dataset).
  const db = admin();
  const order =
    sort === "lifetime"
      ? { col: "lifetime_value", asc: false } // highest first
      : sort === "lifetime_asc"
      ? { col: "lifetime_value", asc: true } // lowest first
      : sort === "name"
      ? { col: "full_name", asc: true }
      : { col: "last_gift_at", asc: false };
  const { data } = await db
    .from("donors")
    .select("*")
    .order(order.col, { ascending: order.asc, nullsFirst: false })
    .limit(500);

  let rows = (data || []) as any[];
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter(
      (r: any) =>
        (r.full_name || "").toLowerCase().includes(needle) ||
        (r.email || "").toLowerCase().includes(needle),
    );
  }
  if (status) rows = rows.filter((r: any) => (r.status || "").toLowerCase() === status);
  if (type) rows = rows.filter((r: any) => (r.type || "").toLowerCase() === type);
  if (recurring === "yes")
    rows = rows.filter((r: any) => !!r.is_recurring || (r.status || "").toLowerCase() === "recurring");
  if (recurring === "no")
    rows = rows.filter((r: any) => !r.is_recurring && (r.status || "").toLowerCase() !== "recurring");

  const isFiltered = !!(q || status || type || recurring);

  const cols: Col<any>[] = [
    { key: "full_name", label: "Name", render: (r: any) => <DonorPeek donor={r} /> },
    { key: "email", label: "Email", render: (r: any) => r.email || "—" },
    { key: "type", label: "Type" },
    { key: "status", label: "Status", render: (r: any) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
    { key: "last_gift_at", label: "Last gift", render: (r: any) => date(r.last_gift_at) },
    { key: "lifetime_value", label: "Lifetime", align: "right", render: (r: any) => <span className="strong money">{money(r.lifetime_value)}</span> },
  ];

  const sub = `${rows.length} ${rows.length === 1 ? "record" : "records"} · the CRM`;

  return (
    <Shell title="Donors" sub={sub}>
      {/* filters + sort */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="stack" style={{ gap: 14 }}>
          {/* search (GET form, preserves the other params via hidden inputs) */}
          <form method="GET" action="/donors" className="flex" style={{ gap: 8 }}>
            <input type="hidden" name="status" value={status} />
            <input type="hidden" name="type" value={type} />
            <input type="hidden" name="recurring" value={recurring} />
            <input type="hidden" name="sort" value={sort} />
            <input id="donor-search" name="q" defaultValue={q} placeholder="Search name or email…" style={{ maxWidth: 320 }} />
            <button className="btn ghost sm" type="submit"><Search size={14} /> Search</button>
            {q && <a className="pill" href={qs(active, { q: undefined })}>Clear “{q}”</a>}
          </form>

          {/* status */}
          <div className="flex wrap" style={{ gap: 6 }}>
            <span className="faint" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em", minWidth: 76 }}>Status</span>
            <a className={`pill ${!status ? "on" : ""}`} href={qs(active, { status: undefined })}>All</a>
            {STATUS_OPTS.map((s) => (
              <a key={s} className={`pill ${status === s ? "on" : ""}`} href={qs(active, { status: s })}>{s}</a>
            ))}
          </div>

          {/* type */}
          <div className="flex wrap" style={{ gap: 6 }}>
            <span className="faint" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em", minWidth: 76 }}>Type</span>
            <a className={`pill ${!type ? "on" : ""}`} href={qs(active, { type: undefined })}>All</a>
            {TYPE_OPTS.map((t) => (
              <a key={t} className={`pill ${type === t ? "on" : ""}`} href={qs(active, { type: t })}>{t}</a>
            ))}
          </div>

          {/* recurring */}
          <div className="flex wrap" style={{ gap: 6 }}>
            <span className="faint" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em", minWidth: 76 }}>Recurring</span>
            <a className={`pill ${!recurring ? "on" : ""}`} href={qs(active, { recurring: undefined })}>All</a>
            <a className={`pill ${recurring === "yes" ? "on" : ""}`} href={qs(active, { recurring: "yes" })}>Monthly</a>
            <a className={`pill ${recurring === "no" ? "on" : ""}`} href={qs(active, { recurring: "no" })}>One-off</a>
          </div>

          {/* sort */}
          <div className="flex wrap" style={{ gap: 6 }}>
            <span className="faint" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em", minWidth: 76 }}>Sort</span>
            {SORT_OPTS.map((s) => (
              <a key={s.v} className={`pill ${sort === s.v ? "on" : ""}`} href={qs(active, { sort: s.v === "recent" ? undefined : s.v })}>{s.label}</a>
            ))}
          </div>
        </div>
      </div>

      <Card title="All donors">
        <Table
          columns={cols}
          rows={rows}
          empty={isFiltered ? "No donors match these filters." : "No donors yet. They'll appear here as Givebutter syncs in."}
        />
      </Card>
    </Shell>
  );
}
