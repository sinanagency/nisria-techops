// THE UNIFIED CALENDAR (one lens, many sources). The /calendar page, the home
// "This week" widget, and Sasa's calendar tools all read THROUGH here, so there
// is exactly one definition of "what is on the calendar". This module owns no
// data of its own except native events (calendar_events); it READS tasks,
// payments, grants, and content in place and normalizes them to one shape, then
// overlays the operator's Google Calendar + Kenya holidays when that link is
// live. A grant deadline still lives in /grants — the calendar is a window, not
// a copy, so clicking an item jumps to its real record.
//
// MONEY LAW (matches lib/agents/sasa.ts): a team-tier reader (the group bot,
// any team member) never sees a financial figure. Payroll and other payment
// events are returned to the team tier WITHOUT the amount and as read-only, and
// grant/payment items they cannot edit. The admin tier (Nur, the 727, the web
// console) sees and controls everything.
import { admin } from "./supabase-admin";
import { today as todayFor } from "./now";
import { listEvents, listHolidays, PRIMARY_CAL } from "./gcal";

export type CalSource = "task" | "payment" | "grant" | "content" | "event" | "gcal" | "holiday";

export type CalEvent = {
  id: string;                 // source-prefixed, stable: "task:<uuid>" etc.
  source: CalSource;
  type: string;               // human sub-label, e.g. "Payroll", "Grant deadline"
  title: string;
  date: string;               // YYYY-MM-DD (the day it sits on)
  end?: string;               // optional multi-day end
  time?: string;              // HH:MM if timed, else undefined (all-day)
  allDay: boolean;
  color: string;              // CSS var token, drives the chip color
  link?: string;              // where clicking the chip takes you in the app
  editable: boolean;          // can THIS tier move/delete it?
  amount?: { value: number; currency: string }; // omitted entirely for team tier
  meta?: Record<string, any>;
};

// Token-per-source so the month grid reads at a glance (matches globals.css).
const COLOR: Record<string, string> = {
  task: "var(--blue)",        // #2563EB
  payment: "var(--green)",    // #16A34A
  grant: "var(--red)",        // #E5484D
  content: "var(--ahadi)",    // #5B5BD6
  event: "var(--nisria)",     // #00C4C2 teal — manual / meetings
  gcal: "var(--nisria)",
  holiday: "var(--gold)",     // #D97706 — public holiday / Eid
};

const isAdmin = (tier: "admin" | "team") => tier === "admin";

// Doctrine (hard rule): no em-dashes / en-dashes in any output, commas / colons
// / periods only. Titles here come STRAIGHT from source rows (a grant program
// name, an imported task), so a dash can slip onto the grid. Strip it once at
// this single source, so the month grid, the home "Coming up" widget, and every
// Sasa calendar answer all read clean. Cheap deterministic pass, not the heavy
// humanize() (which fills placeholders / org facts the calendar never needs).
const noDash = (s: string): string =>
  String(s || "").replace(/\s*[—–]\s*/g, ", ").replace(/\s+-{2,}\s+/g, ", ").trim();

// Grant statuses still "live" on the calendar (a deadline only matters until the
// thing is in/decided). Submitted/won/lost/rejected drop off.
const OPEN_GRANT = new Set(["researching", "drafting", "review"]);

type Range = { from: string; to: string };

// The one fetch. Returns every dated item between from..to (inclusive) for the
// given tier, already normalized, money-stripped where required, and sorted.
export async function getCalendar({ from, to, tier = "admin" }: Range & { tier?: "admin" | "team" }): Promise<CalEvent[]> {
  const db = admin();
  const admin_ = isAdmin(tier);
  const out: CalEvent[] = [];

  // Run the four DB sources + native events together. GCal is fetched separately
  // and is best-effort (a missing share must never break the page).
  const [tasksR, paysR, grantsR, contentR, eventsR] = await Promise.all([
    db.from("tasks").select("id,title,due_on,priority,status,assignee:team_members(name)").not("due_on", "is", null).neq("status", "done").gte("due_on", from).lte("due_on", to),
    db.from("payments").select("id,payee,amount,currency,category,status,due_on").not("due_on", "is", null).gte("due_on", from).lte("due_on", to),
    db.from("grant_applications").select("id,funder,program,deadline,status").not("deadline", "is", null).gte("deadline", from).lte("deadline", to),
    db.from("content_posts").select("id,title,status,channels,scheduled_for").not("scheduled_for", "is", null).gte("scheduled_for", from).lte("scheduled_for", to + "T23:59:59"),
    db.from("calendar_events").select("*").gte("starts_on", from).lte("starts_on", to),
  ]);

  for (const t of (tasksR.data || []) as any[]) {
    out.push({ id: `task:${t.id}`, source: "task", type: "Task", title: noDash(t.title), date: t.due_on, allDay: true,
      color: COLOR.task, link: "/tasks", editable: true, meta: { priority: t.priority, assignee: t.assignee?.name || null } });
  }

  for (const p of (paysR.data || []) as any[]) {
    const label = (p.category || "Payment").replace(/^\w/, (c: string) => c.toUpperCase());
    // Team tier: a money figure can never reach them. Strip the amount and make
    // it read-only — they SEE that a payment day exists, not what it is worth.
    const ev: CalEvent = {
      id: `payment:${p.id}`, source: "payment", type: label,
      title: noDash(admin_ ? `${label}${p.payee ? ` · ${p.payee}` : ""}` : `${label} day`),
      date: p.due_on, allDay: true, color: COLOR.payment, link: admin_ ? "/finance" : undefined,
      editable: admin_, meta: { status: p.status },
    };
    if (admin_ && p.amount != null) ev.amount = { value: Number(p.amount), currency: p.currency || "USD" };
    out.push(ev);
  }

  for (const g of (grantsR.data || []) as any[]) {
    if (!OPEN_GRANT.has(g.status)) continue;
    out.push({ id: `grant:${g.id}`, source: "grant", type: "Grant deadline",
      title: noDash(g.program ? `${g.funder}: ${g.program}` : g.funder), date: g.deadline, allDay: true,
      color: COLOR.grant, link: admin_ ? "/grants" : undefined, editable: admin_, meta: { status: g.status } });
  }

  for (const c of (contentR.data || []) as any[]) {
    const d = String(c.scheduled_for).slice(0, 10);
    const time = String(c.scheduled_for).slice(11, 16);
    out.push({ id: `content:${c.id}`, source: "content", type: "Content",
      title: noDash(c.title || (c.channels?.length ? c.channels.join(", ") : "Scheduled post")),
      date: d, time: time && time !== "00:00" ? time : undefined, allDay: !time || time === "00:00",
      color: COLOR.content, link: "/content", editable: true, meta: { status: c.status } });
  }

  for (const e of (eventsR.data || []) as any[]) {
    // Native events: team may freely manage their OWN (manual/ai), but a native
    // row Sasa minted from a finance/grant context is admin-only by source.
    const editable = admin_ || e.source !== "gcal";
    out.push({ id: `event:${e.id}`, source: "event", type: e.kind || "event", title: noDash(e.title),
      date: e.starts_on, end: e.ends_on || undefined, time: e.start_time ? String(e.start_time).slice(0, 5) : undefined,
      allDay: !!e.all_day, color: COLOR.event, editable, meta: { location: e.location, brand: e.brand, gcal: !!e.gcal_event_id, native: true } });
  }

  // ---- Google overlay (best-effort): her real meetings + Kenya holidays. ----
  // Wrapped so a missing service account or un-shared calendar degrades to "DB
  // only" silently. Native rows already mirrored to GCal are de-duped by id.
  const mirrored = new Set((eventsR.data || []).map((e: any) => e.gcal_event_id).filter(Boolean));
  try {
    const [meetings, holidays] = await Promise.all([
      listEvents(from, to + "T23:59:59", PRIMARY_CAL()).catch(() => [] as any[]),
      listHolidays(from, to + "T23:59:59").catch(() => ({} as Record<string, string>)),
    ]);
    for (const m of meetings) {
      if (mirrored.has(m.id)) continue; // already shown as a native row
      out.push({ id: `gcal:${m.id}`, source: "gcal", type: "Meeting", title: noDash(m.title), date: m.starts_on,
        end: m.ends_on, time: m.start_time, allDay: m.all_day, color: COLOR.gcal, link: m.htmlLink,
        editable: admin_, meta: { location: m.location, google: true } });
    }
    for (const [date, name] of Object.entries(holidays)) {
      out.push({ id: `holiday:${date}`, source: "holiday", type: "Holiday", title: noDash(name), date, allDay: true,
        color: COLOR.holiday, editable: false, meta: { kenya: true } });
    }
  } catch {
    // Google layer unavailable — the DB calendar still stands on its own.
  }

  // Sort: by day, then timed-before-allday within a day, then by time.
  out.sort((a, b) => a.date.localeCompare(b.date) || Number(a.allDay) - Number(b.allDay) || (a.time || "").localeCompare(b.time || ""));
  return out;
}

// Is a given YYYY-MM-DD a Kenya public holiday? Used by Sasa's create_task guard
// so she can flag "that lands on Eid, the team is off". Best-effort: if the
// Google link is not live, returns null (no false positives) rather than guess.
export async function holidayOn(date: string): Promise<string | null> {
  try {
    const map = await listHolidays(date, date + "T23:59:59");
    return map[date] || null;
  } catch {
    return null;
  }
}

// Convenience window: the next `days` days starting today (home widget + Sasa
// "what's coming"). tz keeps "today" correct for Nairobi.
export async function upcoming(tier: "admin" | "team" = "admin", days = 7, tz = "Africa/Nairobi"): Promise<CalEvent[]> {
  const from = todayFor(tz);
  const d = new Date(from + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + days);
  const to = d.toISOString().slice(0, 10);
  return getCalendar({ from, to, tier });
}
