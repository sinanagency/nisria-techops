import Shell from "../../components/Shell";
import { Badge, statusTone } from "../../components/ui";
import { admin, date } from "../../lib/supabase-admin";
import DispatchBox from "../../components/DispatchBox";
import { setTaskStatus } from "./actions";

export const dynamic = "force-dynamic";

const COLUMNS: { key: string; label: string }[] = [
  { key: "todo", label: "To do" },
  { key: "in_progress", label: "In progress" },
  { key: "done", label: "Done" },
];

export default async function Tasks() {
  const db = admin();
  const { data } = await db.from("tasks").select("*,assignee:team_members(name)").order("created_at", { ascending: false }).limit(300);
  const tasks = data || [];
  const prioTone = (p: string) => (p === "high" ? "red" : p === "low" ? "" : "yellow");

  return (
    <Shell title="Tasks" sub={`${tasks.length} tasks · assign by just telling the AI`}>
      <DispatchBox />
      <div className="grid cols-3" style={{ marginTop: 16 }}>
        {COLUMNS.map((col) => {
          const items = tasks.filter((t: any) => t.status === col.key || (col.key === "todo" && t.status === "blocked"));
          return (
            <div className="card" key={col.key}>
              <div className="card-h">{col.label}<Badge>{items.length}</Badge></div>
              <div className="card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {items.length === 0 && <div className="muted" style={{ fontSize: 12.5 }}>Nothing here.</div>}
                {items.map((t: any) => (
                  <div key={t.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
                    <div className="between">
                      <span className="strong" style={{ fontSize: 13.5 }}>{t.title}</span>
                      <Badge tone={prioTone(t.priority) as any}>{t.priority}</Badge>
                    </div>
                    {t.description && <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>{t.description}</div>}
                    <div className="between" style={{ marginTop: 8 }}>
                      <span className="muted" style={{ fontSize: 12 }}>
                        {t.assignee?.name || "Unassigned"}{t.source === "ai" ? " · ✦AI" : ""}{t.due_on ? ` · due ${date(t.due_on)}` : ""}
                      </span>
                      <form action={setTaskStatus}>
                        <input type="hidden" name="id" value={t.id} />
                        <input type="hidden" name="status" value={col.key === "done" ? "todo" : col.key === "todo" ? "in_progress" : "done"} />
                        <button className="pill" type="submit">{col.key === "done" ? "Reopen" : col.key === "todo" ? "Start" : "Done"}</button>
                      </form>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Shell>
  );
}
