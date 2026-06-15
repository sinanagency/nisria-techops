import Link from "next/link";
import Shell from "../../components/Shell";
import { Badge, Stat, statusTone } from "../../components/ui";
import { admin, date } from "../../lib/supabase-admin";
import { getCurrentUser } from "../../lib/auth";
import { getCurrentTeamMember } from "../../lib/profile";
import DispatchBox from "../../components/DispatchBox";
import TaskManage from "../../components/TaskManage";
import { setTaskStatus } from "./actions";

export const dynamic = "force-dynamic";

const COLUMNS: { key: string; label: string }[] = [
  { key: "todo", label: "To do" },
  { key: "in_progress", label: "In progress" },
  { key: "done", label: "Done" },
];

export default async function Tasks({ searchParams }: { searchParams?: { mine?: string } }) {
  const mine = searchParams?.mine === "1";
  const db = admin();
  const { data } = await db.from("tasks").select("*,assignee:team_members!tasks_assignee_id_fkey(name)").order("created_at", { ascending: false }).limit(300);
  let tasks = data || [];

  const { data: teamRows } = await db.from("team_members").select("id,name").eq("status", "active").order("name");
  const team = (teamRows || []) as { id: string; name: string }[];

  // Personal lens: keep full visibility, just filter the view to what's mine,
  // either assigned to my profile (reliable team_member id) or created by me.
  if (mine) {
    const me = await getCurrentTeamMember();
    const myName = getCurrentUser()?.name;
    tasks = tasks.filter((t: any) => (me && t.assignee_id === me.id) || (myName && t.created_by === myName));
  }

  const prioTone = (p: string) => (p === "high" ? "red" : p === "low" ? "" : "yellow");

  // Drill-to-core summary, computed from the same task set (no extra fetch).
  const today = new Date().toISOString().slice(0, 10);
  const isDone = (t: any) => t.status === "done";
  const isOpen = (t: any) => !isDone(t);
  const openTasks = tasks.filter(isOpen);
  const overdue = openTasks.filter((t: any) => t.due_on && t.due_on < today);
  const assignedCount = openTasks.filter((t: any) => t.assignee_id).length;
  const unassignedCount = openTasks.length - assignedCount;

  const pill = (active: boolean) => ({
    fontSize: 12.5, padding: "5px 12px", borderRadius: 999,
    border: `1px solid ${active ? "var(--ink-2)" : "var(--border)"}`,
    color: active ? "var(--ink-2)" : "var(--muted)",
    fontWeight: active ? 600 : 500, textDecoration: "none",
  });

  const initials = (name?: string | null) =>
    (name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";

  return (
    <Shell title="Tasks" sub={`${tasks.length} ${mine ? "of yours" : "tasks"} · assign by just telling the AI`}>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <Link href="/tasks" style={pill(!mine)}>Everyone</Link>
        <Link href="/tasks?mine=1" style={pill(mine)}>Assigned to me</Link>
      </div>

      <div className="grid cols-4">
        <Stat label="Open tasks" value={<span className="disp2">{openTasks.length}</span>} />
        <Stat label="Overdue" value={<span className="disp2" style={overdue.length ? { color: "var(--danger)" } : undefined}>{overdue.length}</span>} delta={overdue.length ? "needs attention" : "on track"} />
        <Stat label="Assigned" value={<span className="disp2">{assignedCount}</span>} delta={`${unassignedCount} unassigned`} />
        <Stat label="Done" value={<span className="disp2">{tasks.filter(isDone).length}</span>} />
      </div>

      <div style={{ marginTop: 16 }}>
        <DispatchBox />
      </div>

      {/* Kanban board: three column-cards SIDE BY SIDE on one row, fixed in
          place. Inside each column, tasks lay out HORIZONTALLY and scroll
          left/right within that lane. So the page stays short and you swipe
          through the backlog one column at a time instead of an infinite
          vertical scroll. The pattern is a shared `.lanestrip` body inside
          a `.lanecol` card; same primitive used on /cases. */}
      <div className="tboard" style={{ marginTop: 16 }}>
        {COLUMNS.map((col) => {
          const items = tasks.filter((t: any) => t.status === col.key || (col.key === "todo" && t.status === "blocked"));
          return (
            <div className="card lanecol" key={col.key}>
              <div className="card-h">{col.label}<Badge tone={statusTone(col.key) as any}>{items.length}</Badge></div>
              <div className="lanestrip">
                {items.length === 0 && <div className="muted lanestrip-empty">Nothing here.</div>}
                {items.map((t: any) => {
                  const od = isOpen(t) && t.due_on && t.due_on < today;
                  return (
                    <div key={t.id} className="lanecard">
                      <div className="between" style={{ alignItems: "flex-start" }}>
                        <span className="strong" style={{ fontSize: 13.5 }}>{t.title}</span>
                        <Badge tone={prioTone(t.priority) as any}>{t.priority}</Badge>
                      </div>
                      {t.description && <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>{t.description}</div>}
                      <div className="between" style={{ marginTop: 10 }}>
                        <div className="avstack" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span className="av" title={t.assignee?.name || "Unassigned"} style={!t.assignee?.name ? { background: "var(--line-2)", color: "var(--muted)" } : undefined}>
                            {t.assignee?.name ? initials(t.assignee.name) : "·"}
                          </span>
                          <span className="muted" style={{ fontSize: 12 }}>
                            {t.assignee?.name || "Unassigned"}{t.source === "ai" ? " · ✦AI" : ""}
                          </span>
                        </div>
                        {t.due_on && (
                          <span className="badge" style={od ? { color: "var(--danger)", borderColor: "var(--danger)" } : undefined}>
                            due {date(t.due_on)}
                          </span>
                        )}
                      </div>
                      <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end", gap: 6 }}>
                        <TaskManage t={t} team={team} />
                        <form action={setTaskStatus}>
                          <input type="hidden" name="id" value={t.id} />
                          <input type="hidden" name="status" value={col.key === "done" ? "todo" : col.key === "todo" ? "in_progress" : "done"} />
                          <button className="pill" type="submit">{col.key === "done" ? "Reopen" : col.key === "todo" ? "Start" : "Done"}</button>
                        </form>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Shell>
  );
}
