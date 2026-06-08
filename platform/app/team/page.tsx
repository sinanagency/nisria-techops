import Shell from "../../components/Shell";
import { Badge, Stat } from "../../components/ui";
import { admin } from "../../lib/supabase-admin";
import TeamPeek from "../../components/TeamPeek";
import TeamAdd from "../../components/TeamAdd";
import TabbedPane, { type TabbedTab } from "../../components/TabbedPane";
import { Users } from "lucide-react";

export const dynamic = "force-dynamic";

// Build a querystring for a filter pill while preserving other active params.
function qs(current: Record<string, string>, patch: Record<string, string | undefined>) {
  const next: Record<string, string> = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === "") delete next[k];
    else next[k] = v;
  }
  const s = new URLSearchParams(next).toString();
  return s ? `/team?${s}` : "/team";
}

const TYPE_OPTS: { v: string; label: string }[] = [
  { v: "staff", label: "Staff" },
  { v: "tailor", label: "Tailors" },
  { v: "volunteer", label: "Volunteers" },
  { v: "contractor", label: "Contractors" },
];
const STATUS_OPTS = ["active", "paused", "exited"];

export default async function Team({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  const sp = searchParams || {};
  const one = (k: string) => (Array.isArray(sp[k]) ? (sp[k] as string[])[0] : (sp[k] as string | undefined)) || "";
  const type = one("type");
  const status = one("status");

  const active: Record<string, string> = {};
  if (type) active.type = type;
  if (status) active.status = status;

  const db = admin();
  const { data: teamRows } = await db.from("team_members").select("*").order("created_at");
  const all = (teamRows || []) as any[];

  // open-task load per member (status != done), one query.
  const { data: taskRows } = await db.from("tasks").select("assignee_id,status");
  const openTasks = (id: string) =>
    (taskRows || []).filter((t: any) => t.assignee_id === id && t.status !== "done").length;

  // counts for the filter pills (always off the full set, not the filtered view)
  const countType = (v: string) => all.filter((m) => (m.member_type || "staff") === v).length;
  const countStatus = (v: string) => all.filter((m) => (m.status || "active") === v).length;

  // apply filters
  let rows = all;
  if (type) rows = rows.filter((m) => (m.member_type || "staff") === type);
  if (status) rows = rows.filter((m) => (m.status || "active") === status);

  const isFiltered = !!(type || status);

  // Summary derived only from data already fetched. We do NOT sum a payroll
  // total: pay lives in payments (not team_members.pay) and the amounts on these
  // rows span multiple currencies, which Law 2 forbids blending into one figure.
  const headcount = all.length;
  const activeCount = countStatus("active");
  const openTotal = (taskRows || []).filter((t: any) => t.status !== "done").length;

  const sub = `${headcount} ${headcount === 1 ? "person" : "people"} · who does what, how long`;

  return (
    <Shell title="Team" sub={sub} action={<TeamAdd />}>
      {/* summary: headcount-led, no fabricated payroll total */}
      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <Stat label="People" value={headcount} delta={`${activeCount} active`} />
        <Stat label="Active" value={activeCount} delta={headcount ? `of ${headcount}` : undefined} />
        <Stat label="Open tasks" value={openTotal} delta="across the team" />
      </div>

      {/* filters */}
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="stack" style={{ gap: 14 }}>
          <div className="flex wrap" style={{ gap: 6 }}>
            <span className="faint" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em", minWidth: 64 }}>Type</span>
            <a className={`pill ${!type ? "on" : ""}`} href={qs(active, { type: undefined })}>All <span className="muted">{all.length}</span></a>
            {TYPE_OPTS.map((o) => (
              <a key={o.v} className={`pill ${type === o.v ? "on" : ""}`} href={qs(active, { type: o.v })}>
                {o.label} <span className="muted">{countType(o.v)}</span>
              </a>
            ))}
          </div>
          <div className="flex wrap" style={{ gap: 6 }}>
            <span className="faint" style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em", minWidth: 64 }}>Status</span>
            <a className={`pill ${!status ? "on" : ""}`} href={qs(active, { status: undefined })}>All</a>
            {STATUS_OPTS.map((sv) => (
              <a key={sv} className={`pill ${status === sv ? "on" : ""}`} href={qs(active, { status: sv })}>
                {sv} <span className="muted">{countStatus(sv)}</span>
              </a>
            ))}
          </div>
        </div>
      </div>

      {rows.length > 0 ? (
        (() => {
          // Group the roster by department (the first non-marker tag). Each
          // department becomes a TabbedPane tab so the page reads at one
          // viewport instead of stacking every department vertically (the
          // pre-Phase-2.6 layout produced 8,218px on mobile).
          const DEPT_ORDER = [
            "Leadership", "Operations & Programs", "Finance & Admin",
            "Maisha Training", "Maisha Production", "Kwetu Haven & Field",
            "Communications & Content", "Logistics",
          ];
          const deptOf = (m: any) => ((m.tags || []).find((t: string) => t && t !== "2026 directory")) || "Other";
          const groups: Record<string, any[]> = {};
          for (const m of rows) (groups[deptOf(m)] ||= []).push(m);
          const ordered = [
            ...DEPT_ORDER.filter((d) => groups[d]),
            ...Object.keys(groups).filter((d) => !DEPT_ORDER.includes(d)).sort(),
          ];

          // tabs[0] is "All" so the operator can browse the full directory
          // without picking a department first; subsequent tabs are per-dept.
          const tabs: TabbedTab[] = [
            {
              id: "all",
              label: "All",
              count: rows.length,
              hint: "the whole directory",
              body: (
                <div className="stack" style={{ gap: 24 }}>
                  {ordered.map((d) => (
                    <div key={d}>
                      <div className="flex" style={{ gap: 8, margin: "0 2px 12px", alignItems: "center" }}>
                        <span className="report-subhead">{d}</span>
                        <Badge tone="gray">{groups[d].length}</Badge>
                      </div>
                      <div className="grid cols-3">
                        {groups[d].map((m) => (
                          <TeamPeek key={m.id} m={m} openTasks={openTasks(m.id)} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ),
            },
            ...ordered.map<TabbedTab>((d) => ({
              id: `dept-${d.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
              label: d,
              count: groups[d].length,
              body: (
                <div className="grid cols-3">
                  {groups[d].map((m) => (
                    <TeamPeek key={m.id} m={m} openTasks={openTasks(m.id)} />
                  ))}
                </div>
              ),
            })),
          ];

          return <TabbedPane tabs={tabs} initialId={ordered.length > 0 ? `dept-${ordered[0].toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : "all"} />;
        })()
      ) : (
        <div className="card">
          <div className="empty">
            <div className="flex" style={{ justifyContent: "center", marginBottom: 12 }}>
              <span className="aico gray" style={{ width: 44, height: 44 }}><Users size={20} /></span>
            </div>
            {isFiltered ? (
              <>No team members match these filters yet.</>
            ) : (
              <>No team members yet. Add your first one above. The WhatsApp bot will populate the rest once it is live.</>
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}
