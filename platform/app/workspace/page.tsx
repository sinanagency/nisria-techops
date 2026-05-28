import { admin } from "../../lib/supabase-admin";
import WorkspacePortal from "../../components/WorkspacePortal";

export const dynamic = "force-dynamic";

// The Workspace portal: one place to chat (every channel), assign tasks, and open
// whoever you're talking to as a tab. Threads are messages grouped by contact;
// WhatsApp folds straight in once the token lands (inbound already writes here).
export default async function WorkspacePage() {
  const db = admin();
  const [{ data: msgs }, { data: team }, { data: tasks }, { data: events }] = await Promise.all([
    db.from("messages").select("id,contact_id,channel,direction,body,subject,status,created_at,contact:contacts(id,name,phone,email)").order("created_at", { ascending: true }).limit(600),
    db.from("team_members").select("id,name").order("name").limit(60),
    db.from("tasks").select("id,title,status,priority,due_on,assignee_id,description").neq("status", "done").order("created_at", { ascending: false }).limit(60),
    db.from("events").select("type,actor,source,created_at").order("created_at", { ascending: false }).limit(8),
  ]);

  // group messages into threads by contact
  const byContact = new Map<string, any>();
  for (const m of (msgs || []) as any[]) {
    const cid = m.contact_id || "unknown";
    if (!byContact.has(cid)) {
      byContact.set(cid, {
        contactId: m.contact_id || null,
        name: m.contact?.name || "Unknown",
        channel: m.channel || "email",
        phone: m.contact?.phone || null,
        email: m.contact?.email || null,
        messages: [],
        unread: 0,
        lastAt: m.created_at,
      });
    }
    const t = byContact.get(cid);
    t.messages.push({ id: m.id, direction: m.direction, body: m.body, subject: m.subject, channel: m.channel, status: m.status, created_at: m.created_at });
    t.lastAt = m.created_at;
    if (m.direction === "in" && m.status === "new") t.unread += 1;
    if (m.channel && m.channel !== "email") t.channel = m.channel; // prefer a non-email channel label if present
  }
  const threads = [...byContact.values()].sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));

  return (
    <WorkspacePortal
      threads={threads}
      team={team || []}
      tasks={tasks || []}
      events={events || []}
    />
  );
}
