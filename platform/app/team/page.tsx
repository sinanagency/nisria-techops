import Shell from "../../components/Shell";
import { Badge } from "../../components/ui";
import { admin } from "../../lib/supabase-admin";
import TeamPeek from "../../components/TeamPeek";
import TeamAdd from "../../components/TeamAdd";
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
  const sub = `${all.length} ${all.length === 1 ? "person" : "people"} · who does what, what they cost, how long`;

  return (
    <Shell title="Team" sub={sub} action={<TeamAdd />}>
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
        <div className="grid cols-3">
          {rows.map((m) => (
            <TeamPeek key={m.id} m={m} openTasks={openTasks(m.id)} />
          ))}
        </div>
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
