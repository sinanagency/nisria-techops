import { admin } from "../../lib/supabase-admin";
import { cleanEmail, isAutomatedSender } from "../../lib/email-render";
import WorkspacePortal from "../../components/WorkspacePortal";
import MissionControlButton from "../../components/MissionControlButton";
import { MessageCircle, Activity, Bot, Send, CheckCircle2, Inbox, Sparkles, FileCheck } from "lucide-react";
import { filterHumanEvents } from "../../lib/events-filter";

export const dynamic = "force-dynamic";

// Turn a raw event row (type + actor + source) into a one-line "what changed"
// label for the live feed. Only the columns this page fetches are used; no
// payload is read here (it is not selected), so labels stay shape-honest.
function eventLabel(e: any): { text: string; icon: any; tone: string } {
  const who = (e.actor || "").trim();
  const by = who && who.toLowerCase() !== "system" ? ` by ${who}` : "";
  const map: Record<string, { text: string; icon: any; tone: string }> = {
    "message.received": { text: "New message arrived", icon: Inbox, tone: "teal" },
    "agent.decided": { text: `Sasa drafted a reply${by}`, icon: Sparkles, tone: "peri" },
    "approval.created": { text: "An action was queued for review", icon: FileCheck, tone: "gold" },
    "approval.approved": { text: `Action approved${by}`, icon: CheckCircle2, tone: "green" },
    "action.executed": { text: `Message sent${by}`, icon: Send, tone: "green" },
    "task.assigned": { text: `Task assigned${by}`, icon: CheckCircle2, tone: "teal" },
    "payment.verified": { text: "Payment logged", icon: CheckCircle2, tone: "green" },
    "grants.refreshed": { text: "Grant opportunities refreshed", icon: Activity, tone: "peri" },
    "asset.ingested": { text: "A document was filed to Library", icon: FileCheck, tone: "gold" },
  };
  return map[e.type] || { text: `${e.type.replace(/\./g, " ")}${by}`, icon: Bot, tone: "gray" };
}

function eventAgo(d: string): string {
  if (!d) return "";
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

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
    // exclude backfilled chat history + live group traffic: those belong on the
    // Groups page and the person profiles, not the 1:1 comms threads (otherwise
    // 4.5-year-old group messages surface here as live conversations).
    db.from("messages").select("id,contact_id,channel,direction,body,subject,status,sender_type,created_at,contact:contacts(id,name,phone,email)").not("handled_by", "in", "(backfill,group-bot)").order("created_at", { ascending: true }).limit(600),
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
    // Most recent first, always. Unread state surfaces via the badge per
    // conversation, not by reordering rows (Taona 2026-06-08: "messages
    // alwyays start with the most recent").
    .sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));

  // The two open-work signals that frame the header (what is open, in numbers).
  const needsReply = threads.reduce((n, t) => n + (t.unread > 0 ? 1 : 0), 0);
  const openTasks = (tasks || []).length;
  const feed = filterHumanEvents(events as any[]);

  return (
    <div className="pagewrap rise">
      {/* Header: the two questions this surface answers, at a glance. */}
      <div className="hero">
        <div>
          <div className="eyebrow"><MessageCircle size={14} style={{ verticalAlign: -2 }} /> Workspace</div>
          <h1>What is open. What changed.</h1>
          <div className="muted" style={{ fontSize: 13.5, marginTop: 6 }}>
            {needsReply > 0 ? `${needsReply} ${needsReply === 1 ? "thread needs" : "threads need"} a reply` : "Nothing needs a reply"}
            {" · "}
            {openTasks > 0 ? `${openTasks} ${openTasks === 1 ? "task" : "tasks"} in progress` : "No open tasks"}
          </div>
        </div>
        <MissionControlButton />
      </div>

      {/* Two panes: LEFT, the open work (portal: conversations, tasks, tabs).
          RIGHT, the live activity feed (recent events, what just changed).
          A simple two-column grid; the feed column stretches to the portal's
          height. Collapses to one column on narrow viewports. */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 320px", gap: 16, alignItems: "stretch" }}>
        <div style={{ minWidth: 0 }}>
          <WorkspacePortal
            threads={threads}
            team={team || []}
            tasks={tasks || []}
            events={events || []}
          />
        </div>

        <aside className="card" style={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
          <div className="wp-railhead">
            <span className="flex" style={{ gap: 7 }}><Activity size={15} /> Live activity</span>
            <span className="faint" style={{ fontSize: 12 }}>{feed.length} recent</span>
          </div>
          <div style={{ padding: "6px 14px", overflowY: "auto", flex: 1, minHeight: 0 }}>
            {feed.length === 0 && <div className="empty" style={{ padding: 36, fontSize: 13 }}>Quiet so far. Activity shows here as messages, drafts, and actions land.</div>}
            {feed.map((e: any, i: number) => {
              const { text, icon: Icon, tone } = eventLabel(e);
              return (
                <div key={i} className="actrow">
                  <span className={`aico ${tone}`}><Icon size={14} /></span>
                  <div className="abody">
                    <div className="atitle">{text}</div>
                    {e.source && <div className="ameta">{e.source}</div>}
                  </div>
                  <span className="aright">{eventAgo(e.created_at)}</span>
                </div>
              );
            })}
          </div>
        </aside>
      </div>
    </div>
  );
}
