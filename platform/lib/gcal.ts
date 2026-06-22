// Server-side Google Calendar client. Same service-account JWT-bearer engine as
// lib/drive.ts (GOOGLE_SERVICE_ACCOUNT_B64), only the SCOPE differs — so the
// calendar reuses the credential the Filing system already runs on. This reads
// and writes the operator's Google Calendar (sasa@nisria.co) and reads the
// public "Holidays in Kenya" calendar (Eid included), so her phone and the
// portal are two windows on the same events.
//
// ENABLEMENT (graceful): every export no-ops or throws a tagged error when the
// service account is not configured (local dev) or the calendar has not yet
// been SHARED with the service-account email (path A). The aggregator catches
// these so the unified calendar always renders from the database alone, and the
// Google layer simply lights up the moment the share is done. Nothing here is a
// hard dependency.
//
// SETUP (one human action, path B / domain-wide delegation): nisria.co blocks
// edit-sharing to external identities, so the SA impersonates sasa@nisria.co
// instead of being shared in. In Workspace admin → Security → API controls →
// Domain-wide delegation, authorize the SA's client ID for the calendar scope
// (https://www.googleapis.com/auth/calendar). The SA then has owner access to
// sasa's primary calendar with no sharing needed. Env (optional, sane defaults):
//   NISRIA_CALENDAR_ID       default "sasa@nisria.co" (calendar to read/write)
//   NISRIA_CAL_IMPERSONATE   default "sasa@nisria.co" (DWD subject user)
//   NISRIA_HOLIDAYS_CAL_ID   default Google's Kenya holiday calendar
import crypto from "crypto";
import { DEFAULT_TZ } from "./now";

const CAL_SCOPE = "https://www.googleapis.com/auth/calendar";
export const PRIMARY_CAL = () => process.env.NISRIA_CALENDAR_ID || "sasa@nisria.co";
export const HOLIDAYS_CAL = () => process.env.NISRIA_HOLIDAYS_CAL_ID || "en.ke#holiday@group.v.calendar.google.com";

type SA = { client_email: string; private_key: string };
function sa(): SA | null {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_B64;
  if (!b64) return null;
  try {
    const j = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    return { client_email: j.client_email, private_key: j.private_key };
  } catch {
    return null;
  }
}

// Is the Google layer even possible in this environment? The UI uses this to
// decide whether to show the "connect your Google Calendar" hint.
export function gcalConfigured(): boolean {
  return !!sa();
}

let _tok: { token: string; exp: number } | null = null;

// OAuth2 access token for the Calendar scope via the JWT-bearer grant. Same
// RS256 assertion shape as driveToken(); cached until ~1 min before expiry.
async function gcalToken(): Promise<string> {
  if (_tok && Date.now() < _tok.exp - 60_000) return _tok.token;
  const s = sa();
  if (!s) throw new Error("gcal: GOOGLE_SERVICE_ACCOUNT_B64 not configured");
  const nowS = Math.floor(Date.now() / 1000);
  const b64u = (o: any) => Buffer.from(JSON.stringify(o)).toString("base64url");
  // Domain-wide delegation: impersonate the Workspace user that owns the calendar
  // (path B). The org blocks edit-sharing to external identities (a service
  // account counts as external), so instead of being shared INTO the calendar the
  // SA acts AS sasa@nisria.co — same mechanism the Gmail/Drive extraction already
  // uses on this SA. Requires the calendar scope authorized on the SA's client ID
  // in Workspace admin (Security → API controls → Domain-wide delegation).
  const claim = { iss: s.client_email, sub: process.env.NISRIA_CAL_IMPERSONATE || "sasa@nisria.co", scope: CAL_SCOPE, aud: "https://oauth2.googleapis.com/token", iat: nowS, exp: nowS + 3600 };
  const input = `${b64u({ alg: "RS256", typ: "JWT" })}.${b64u(claim)}`;
  const sig = crypto.sign("RSA-SHA256", Buffer.from(input), s.private_key).toString("base64url");
  const jwt = `${input}.${sig}`;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
    cache: "no-store",
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(j.error_description || j.error || "gcal token failed");
  _tok = { token: j.access_token, exp: nowS * 1000 + (j.expires_in || 3600) * 1000 };
  return j.access_token;
}

export type GEvent = {
  id: string;
  title: string;
  starts_on: string;          // YYYY-MM-DD
  ends_on?: string;
  start_time?: string;        // HH:MM (omitted for all-day)
  all_day: boolean;
  location?: string;
  notes?: string;
  htmlLink?: string;
};

// Normalize a Google event resource into our flat GEvent. Google all-day events
// carry {date}; timed events carry {dateTime}. The end.date on an all-day event
// is EXCLUSIVE, so we step it back a day for a human "ends_on".
function norm(e: any): GEvent {
  const allDay = !!e.start?.date && !e.start?.dateTime;
  const startsOn = allDay ? e.start.date : String(e.start?.dateTime || "").slice(0, 10);
  let endsOn: string | undefined;
  if (allDay && e.end?.date) {
    const d = new Date(e.end.date + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 1);
    endsOn = d.toISOString().slice(0, 10);
  } else if (e.end?.dateTime) {
    endsOn = String(e.end.dateTime).slice(0, 10);
  }
  const start_time = allDay ? undefined : String(e.start?.dateTime || "").slice(11, 16);
  return {
    id: e.id, title: e.summary || "(busy)", starts_on: startsOn, ends_on: endsOn === startsOn ? undefined : endsOn,
    start_time, all_day: allDay, location: e.location || undefined, notes: e.description || undefined, htmlLink: e.htmlLink,
  };
}

// List events in a window [timeMin, timeMax] (ISO date or datetime) from a
// calendar. Single-events expansion turns recurring rules into concrete dates,
// which is what a month grid needs. Best-effort: throws a tagged error the
// aggregator catches (so a missing share never breaks the page).
export async function listEvents(timeMin: string, timeMax: string, calendarId = PRIMARY_CAL()): Promise<GEvent[]> {
  const token = await gcalToken();
  const out: GEvent[] = [];
  let pageToken = "";
  do {
    const qs = new URLSearchParams({
      timeMin: new Date(timeMin).toISOString(), timeMax: new Date(timeMax).toISOString(),
      singleEvents: "true", orderBy: "startTime", maxResults: "250", showDeleted: "false",
    });
    if (pageToken) qs.set("pageToken", pageToken);
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${qs}`;
    const r = await fetch(url, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
    const j = await r.json();
    if (!r.ok) throw new Error(`gcal:${r.status}:${j?.error?.message || "list failed"}`);
    for (const e of j.items || []) if (e.status !== "cancelled") out.push(norm(e));
    pageToken = j.nextPageToken || "";
  } while (pageToken);
  return out;
}

// Kenya public holidays (incl. Eid al-Fitr / Eid al-Adha, which are lunar and
// shift yearly) read from Google's maintained holiday calendar — so we never
// hard-code a drifting date. Returns a date -> holiday-name map for the window.
export async function listHolidays(timeMin: string, timeMax: string): Promise<Record<string, string>> {
  const evs = await listEvents(timeMin, timeMax, HOLIDAYS_CAL());
  const map: Record<string, string> = {};
  for (const e of evs) map[e.starts_on] = e.title;
  return map;
}

// ---- WRITE side (two-way). Each maps a flat event to the Google resource. ----
function toResource(ev: { title: string; starts_on: string; ends_on?: string | null; start_time?: string | null; end_time?: string | null; all_day?: boolean; location?: string | null; notes?: string | null }) {
  const allDay = ev.all_day !== false && !ev.start_time;
  if (allDay) {
    // all-day end.date is EXCLUSIVE — add a day to the last day shown.
    const last = ev.ends_on || ev.starts_on;
    const d = new Date(last + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1);
    return { summary: ev.title, location: ev.location || undefined, description: ev.notes || undefined,
      start: { date: ev.starts_on }, end: { date: d.toISOString().slice(0, 10) } };
  }
  // The stored start_time is the operator's local wall-clock (create_event converts any
  // stated source zone to DEFAULT_TZ deterministically), so Google must label it with the
  // SAME zone, not a hardcoded Nairobi (the 2026-06-22 Nairobi/Dubai inconsistency).
  const tz = DEFAULT_TZ;
  const startDT = `${ev.starts_on}T${(ev.start_time || "09:00")}:00`;
  const endDT = `${ev.ends_on || ev.starts_on}T${(ev.end_time || ev.start_time || "10:00")}:00`;
  return { summary: ev.title, location: ev.location || undefined, description: ev.notes || undefined,
    start: { dateTime: startDT, timeZone: tz }, end: { dateTime: endDT, timeZone: tz } };
}

export async function createEvent(ev: Parameters<typeof toResource>[0], calendarId = PRIMARY_CAL()): Promise<{ id: string; htmlLink?: string }> {
  const token = await gcalToken();
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const r = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(toResource(ev)), cache: "no-store" });
  const j = await r.json();
  if (!r.ok) throw new Error(`gcal:${r.status}:${j?.error?.message || "create failed"}`);
  return { id: j.id, htmlLink: j.htmlLink };
}

export async function patchEvent(eventId: string, ev: Parameters<typeof toResource>[0], calendarId = PRIMARY_CAL()): Promise<void> {
  const token = await gcalToken();
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
  const r = await fetch(url, { method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(toResource(ev)), cache: "no-store" });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(`gcal:${r.status}:${j?.error?.message || "patch failed"}`); }
}

export async function deleteEvent(eventId: string, calendarId = PRIMARY_CAL()): Promise<void> {
  const token = await gcalToken();
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
  const r = await fetch(url, { method: "DELETE", headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!r.ok && r.status !== 410 && r.status !== 404) { const j = await r.json().catch(() => ({})); throw new Error(`gcal:${r.status}:${j?.error?.message || "delete failed"}`); }
}
