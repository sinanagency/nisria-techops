import { admin } from "../../lib/supabase-admin";
import { cleanEmail, isAutomatedSender } from "../../lib/email-render";
import WorkspacePortal from "../../components/WorkspacePortal";

export const dynamic = "force-dynamic";

// A WhatsApp/media placeholder ("[document]", "[document message]", "[image]")
// reads as broken in a chat. Turn it into a plain human label so the thread shows
// what arrived even before the file content is pulled in.
function readableBody(raw: string, channel: string): string {
  const s = (raw || "").trim();
  const m = s.match(/^\[(document|image|photo|video|audio|voice|sticker|file)(?:\s+message)?\]$/i);
  if (m) {
    const kind = m[1].toLowerCase();
    if (kind === "document" || kind === "file") return "Document attachment";
    if (kind === "image" || kind === "photo") return "Photo";
    if (kind === "voice" || kind === "audio") return "Voice note";
    if (kind === "video") return "Video";
    return "Attachment";
  }
  // Emails arrive as raw HTML; never render that raw (lib rule: cleanEmail is the
  // only render path for a body). WhatsApp text passes through untouched.
  return channel === "email" ? cleanEmail(s) : s;
}

// The Workspace portal: one place to chat (every channel), assign tasks, and open
// whoever you're talking to as a tab. Threads are messages grouped by contact;
// WhatsApp folds straight in once the token lands (inbound already writes here).
export default async function WorkspacePage() {
  const db = admin();
  const [{ data: msgs }, { data: team }, { data: tasks }, { data: events }] = await Promise.all([
    db.from("messages").select("id,contact_id,channel,direction,body,subject,status,sender_type,created_at,contact:contacts(id,name,phone,email)").order("created_at", { ascending: true }).limit(600),
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
        lastBody: "",
        lastSubject: "",
        hasAutomated: false,
      });
    }
    const t = byContact.get(cid);
    t.messages.push({ id: m.id, direction: m.direction, body: readableBody(m.body, m.channel), subject: m.subject, channel: m.channel, status: m.status, sender_type: m.sender_type, created_at: m.created_at });
    t.lastAt = m.created_at;
    t.lastBody = m.body || "";
    t.lastSubject = m.subject || "";
    if (m.direction === "in" && m.sender_type === "automated") t.hasAutomated = true;
    // Unread = the canonical "needs a reply" definition (see lib/counts.ts):
    // inbound, from an individual, still new or only drafted.
    if (m.direction === "in" && m.sender_type === "individual" && (m.status === "new" || m.status === "drafted")) t.unread += 1;
    if (m.channel && m.channel !== "email") t.channel = m.channel; // prefer a non-email channel label if present
  }

  // HUMANS ONLY (Workspace doctrine, hard rule 1). A thread shows when a real
  // person wrote in. Two gates, both must pass:
  //   1. the sender is not a machine / billing / marketing address, and the latest
  //      message body is not machine-generated (calendar/Drive/reminder/blast), and
  //   2. at least one inbound message is not classified 'automated'.
  // sender_type is set by the out-of-repo Gmail sync, so it can be wrong; the
  // address+content veto above is the safety net that catches what it misses
  // (PayPal, Charity Navigator, I&M, Goodstack, calendar invites, etc.).
  const isHuman = (t: any) => {
    const sample = `${t.lastSubject} ${String(t.lastBody).slice(0, 200)}`;
    if (isAutomatedSender(t.name, t.email, sample)) return false;
    const hasInbound = t.messages.some((m: any) => m.direction === "in");
    const allInboundAutomated = hasInbound && t.messages.filter((m: any) => m.direction === "in").every((m: any) => m.sender_type === "automated");
    return hasInbound && !allInboundAutomated;
  };
  const threads = [...byContact.values()]
    .filter(isHuman)
    // needs-a-reply first (like the inbox "Needs reply" view), then most recent.
    .sort((a, b) => (b.unread > 0 ? 1 : 0) - (a.unread > 0 ? 1 : 0) || (a.lastAt < b.lastAt ? 1 : -1));

  return (
    <WorkspacePortal
      threads={threads}
      team={team || []}
      tasks={tasks || []}
      events={events || []}
    />
  );
}
