import Link from "next/link";
import Shell from "../../components/Shell";
import { Badge, Stat, statusTone } from "../../components/ui";
import { admin, date } from "../../lib/supabase-admin";
import { openTasksCount } from "../../lib/counts";
import { getCurrentUser } from "../../lib/auth";
import { getCurrentTeamMember } from "../../lib/profile";
import DispatchBox from "../../components/DispatchBox";
import TaskManage from "../../components/TaskManage";
import { setTaskStatus } from "./actions";
import { CheckCircle2, Clock, Circle } from "lucide-react";

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

  // Drill-to-core summary, computed from the same task set (no extra fetch).
  const today = new Date().toISOString().slice(0, 10);
  const isDone = (t: any) => t.status === "done";
  const isOpen = (t: any) => !isDone(t);
  const openTasks = tasks.filter(isOpen);
  const overdue = openTasks.filter((t: any) => t.due_on && t.due_on < today);
  const assignedCount = openTasks.filter((t: any) => t.assignee_id).length;
  const unassignedCount = openTasks.length - assignedCount;
  // #6: the headline "Open tasks" must be the canonical count (counts.ts, a head:true exact
  // count), not openTasks.length off the capped limit(300) fetch — past 300 tasks the header
  // would silently undercount and disagree with the dashboard + bell. The "mine" view counts
  // the filtered set, which is small, so its length is accurate.
  const openCount = mine ? openTasks.length : await openTasksCount(db);

  const pill = (active: boolean) => ({
    fontSize: 12.5, padding: "5px 12px", borderRadius: 999,
    border: `1px solid ${active ? "var(--ink-2)" : "var(--border)"}`,
    color: active ? "var(--ink-2)" : "var(--muted)",
    fontWeight: active ? 600 : 500, textDecoration: "none",
  });

  return (
    <Shell title="Tasks" sub={`${tasks.length} ${mine ? "of yours" : "tasks"} · assign by just telling the AI`}>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <Link href="/tasks" style={pill(!mine)}>Everyone</Link>
        <Link href="/tasks?mine=1" style={pill(mine)}>Assigned to me</Link>
      </div>

      <div className="grid cols-4">
        <Stat label="Open tasks" value={<span className="disp2">{openCount}</span>} />
        <Stat label="Overdue" value={<span className="disp2" style={overdue.length ? { color: "var(--danger)" } : undefined}>{overdue.length}</span>} delta={overdue.length ? "needs attention" : "on track"} />
        <Stat label="Assigned" value={<span className="disp2">{assignedCount}</span>} delta={`${unassignedCount} unassigned`} />
        <Stat label="Done" value={<span className="disp2">{tasks.filter(isDone).length}</span>} />
      </div>

      <div style={{ marginTop: 16 }}>
        <DispatchBox />
      </div>

      {/* Vertical task list (Nur request 2026-06-24): replaced the horizontal
          swipe kanban (.tboard / .lanestrip) with three stacked status cards,
          each a vertical list using the shared `.actrow` row primitive (same
          one on /team/[id]). To do / In progress / Done grouping is preserved
          so nothing is lost; the change is swipe -> scroll only. */}
      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 16 }}>
        {COLUMNS.map((col) => {
          const items = tasks.filter((t: any) => t.status === col.key || (col.key === "todo" && t.status === "blocked"));
          const Icon = col.key === "done" ? CheckCircle2 : col.key === "in_progress" ? Clock : Circle;
          const tone = col.key === "done" ? "green" : col.key === "in_progress" ? "teal" : "gray";
          // Open lanes render in full; Done can be long, so cap the render but
          // keep the true total in the header badge (honesty law).
          const DONE_CAP = 30;
          const shown = col.key === "done" ? items.slice(0, DONE_CAP) : items;
          const hidden = items.length - shown.length;
          const next = col.key === "done" ? "todo" : col.key === "todo" ? "in_progress" : "done";
          const label = col.key === "done" ? "Reopen" : col.key === "todo" ? "Start" : "Done";
          return (
            <div className="card" key={col.key}>
              <div className="card-h">
                <span className="flex" style={{ gap: 7 }}><Icon size={15} /> {col.label}</span>
                <Badge tone={statusTone(col.key) as any}>{items.length}</Badge>
              </div>
              <div style={{ padding: "6px 18px 12px" }}>
                {items.length === 0 ? (
                  <div className="empty">Nothing here.</div>
                ) : (
                  <>
                    {shown.map((t: any) => {
                      const od = isOpen(t) && t.due_on && t.due_on < today;
                      return (
                        <div key={t.id} className="actrow">
                          <span className={`aico ${tone}`}><Icon size={15} /></span>
                          <div className="abody">
                            <div className="atitle">{t.title}</div>
                            <div className="ameta">
                              {[t.assignee?.name || "Unassigned", t.source === "ai" ? "✦AI" : null, t.priority].filter(Boolean).join(" · ")}
                              {t.due_on && <span style={od ? { color: "var(--danger)" } : undefined}>{" · "}due {date(t.due_on)}</span>}
                            </div>
                          </div>
                          <div className="flex" style={{ gap: 4 }}>
                            <TaskManage t={t} team={team} />
                            <form action={setTaskStatus}>
                              <input type="hidden" name="id" value={t.id} />
                              <input type="hidden" name="status" value={next} />
                              <button className="pill" type="submit">{label}</button>
                            </form>
                          </div>
                        </div>
                      );
                    })}
                    {hidden > 0 && <div className="muted" style={{ fontSize: 12.5, padding: "8px 2px 0" }}>+{hidden} more {col.label.toLowerCase()}</div>}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Shell>
  );
}
