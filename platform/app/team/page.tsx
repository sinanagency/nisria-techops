import Shell from "../../components/Shell";
import { Card, Badge } from "../../components/ui";
import { admin } from "../../lib/supabase-admin";
import { addMember, toggleMember } from "./actions";

export const dynamic = "force-dynamic";

export default async function Team() {
  const db = admin();
  const { data: team } = await db.from("team_members").select("*").order("created_at");
  const { data: tasks } = await db.from("tasks").select("assignee_id,status");
  const load = (id: string) => (tasks || []).filter((t: any) => t.assignee_id === id && t.status !== "done").length;

  return (
    <Shell title="Team" sub={`${team?.length || 0} people · who does what`}>
      <div className="grid cols-3">
        {(team || []).map((m: any) => (
          <div className="card card-pad" key={m.id}>
            <div className="between">
              <strong style={{ fontSize: 15 }}>{m.name}</strong>
              <Badge tone={m.status === "active" ? "green" : ""}>{m.status}</Badge>
            </div>
            <div className="muted" style={{ fontSize: 13, marginTop: 3 }}>{m.role || "—"}</div>
            {m.email && <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>{m.email}</div>}
            <div className="between" style={{ marginTop: 12 }}>
              <Badge tone="purple">{load(m.id)} open task{load(m.id) === 1 ? "" : "s"}</Badge>
              <form action={toggleMember}>
                <input type="hidden" name="id" value={m.id} />
                <input type="hidden" name="status" value={m.status === "active" ? "inactive" : "active"} />
                <button className="pill" type="submit">{m.status === "active" ? "Deactivate" : "Activate"}</button>
              </form>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 16, maxWidth: 520 }}>
        <Card title="Add a team member">
          <form action={addMember} className="card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input name="name" placeholder="Name" required />
            <input name="role" placeholder="Role (e.g. Content Lead, Kenya Field, VA)" />
            <input name="email" placeholder="Email (optional)" />
            <button className="btn" type="submit" style={{ alignSelf: "flex-start" }}>Add member</button>
          </form>
        </Card>
      </div>
    </Shell>
  );
}
