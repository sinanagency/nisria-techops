import Shell from "../../components/Shell";
import { Card, Table, Badge, Col, statusTone } from "../../components/ui";
import { admin, date } from "../../lib/supabase-admin";
import { Money } from "../../components/Money";
import DonorPeek from "../../components/DonorPeek";
import FilterBar, { FilterField, Segment } from "../../components/FilterBar";

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

// Saved views (segments). Each maps to a slice of the existing querystring
// filters. A segment is "active" when the current filters match its patch
// exactly (ignoring search + sort, which are orthogonal refinements).
const SEGMENTS: { label: string; patch: Record<string, string | undefined>; match: (f: { status: string; recurring: string }) => boolean }[] = [
  { label: "All donors", patch: { status: undefined, recurring: undefined }, match: (f) => !f.status && !f.recurring },
  { label: "Recurring", patch: { status: undefined, recurring: "yes" }, match: (f) => f.recurring === "yes" && !f.status },
  { label: "Major", patch: { status: "major", recurring: undefined }, match: (f) => f.status === "major" },
  { label: "Lapsed", patch: { status: "lapsed", recurring: undefined }, match: (f) => f.status === "lapsed" },
  { label: "Prospects", patch: { status: "prospect", recurring: undefined }, match: (f) => f.status === "prospect" },
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
    { key: "lifetime_value", label: "Lifetime", align: "right", render: (r: any) => (
      <span className="flex" style={{ gap: 4, justifyContent: "flex-end", alignItems: "baseline" }}>
        <Money className="strong" amount={r.lifetime_value} currency={r.currency || "USD"} />
        {!r.currency && <span className="faint" style={{ fontSize: 10, fontStyle: "italic" }}>?</span>}
      </span>
    ) },
  ];

  // Group rows by status for the grouped table view. Status drives the group
  // header + its tone. Groups are ordered by the canonical STATUS_OPTS order,
  // with anything unknown (or blank) collected last under "other". Within each
  // group the rows keep the DB sort already applied above.
  const groupOrder = [...STATUS_OPTS, "other"];
  const groupsMap = new Map<string, any[]>();
  for (const r of rows) {
    const s = (r.status || "").toLowerCase();
    const key = STATUS_OPTS.includes(s) ? s : "other";
    if (!groupsMap.has(key)) groupsMap.set(key, []);
    groupsMap.get(key)!.push(r);
  }
  const groups = groupOrder
    .filter((k) => groupsMap.has(k))
    .map((k) => ({ key: k, rows: groupsMap.get(k)! }));

  const sub = `${rows.length} ${rows.length === 1 ? "record" : "records"} · the CRM`;

  // Modern filter omnibar config (Filtering v2). Fields map 1:1 to the
  // querystring params the server already filters on, so the chip builder is
  // fully functional with the existing data logic.
  const filterFields: FilterField[] = [
    { key: "status", label: "Status", type: "select", options: STATUS_OPTS.map((s) => ({ v: s, label: s })) },
    { key: "type", label: "Type", type: "select", options: TYPE_OPTS.map((t) => ({ v: t, label: t })) },
    { key: "recurring", label: "Cadence", type: "select", options: [{ v: "yes", label: "Monthly" }, { v: "no", label: "One-off" }] },
  ];
  const filterSegments: Segment[] = SEGMENTS.map((seg) => ({
    label: seg.label,
    patch: { ...seg.patch, ...(seg.label === "All donors" ? { type: undefined } : {}) },
    on: seg.match({ status, recurring }) && (seg.label === "All donors" ? !type : true),
  }));
  const filterValues: Record<string, string> = { q, status, type, recurring, sort };

  return (
    <Shell title="Donors" sub={sub}>
      <FilterBar
        basePath="/donors"
        fields={filterFields}
        values={filterValues}
        segments={filterSegments}
        sort={sort}
        sortOptions={SORT_OPTS}
        count={rows.length}
        searchKey="q"
        searchPlaceholder="Search name or email…"
      />

      <Card title="All donors" scroll>
        {rows.length === 0 ? (
          <div className="empty">
            {isFiltered ? "No donors match these filters." : "No donors yet. They'll appear here as Givebutter syncs in."}
          </div>
        ) : (
          groups.map((g, i) => (
            <div key={g.key} style={{ marginTop: i === 0 ? 0 : 22 }}>
              <div
                className="flex"
                style={{ alignItems: "center", gap: 10, padding: "0 4px 8px" }}
              >
                <Badge tone={statusTone(g.key === "other" ? "" : g.key)}>{g.key}</Badge>
                <span className="faint" style={{ fontSize: 12, fontWeight: 600 }}>
                  {g.rows.length} {g.rows.length === 1 ? "donor" : "donors"}
                </span>
              </div>
              <Table columns={cols} rows={g.rows} />
            </div>
          ))
        )}
      </Card>
    </Shell>
  );
}

