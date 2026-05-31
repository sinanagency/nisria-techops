"use server";

// Server actions for NATIVE calendar events (meetings, team travel, site visits)
// driven from the /calendar UI. Ops items (tasks/payments/grants/content) are
// edited on their own pages — this file only owns calendar_events. Every write
// mirrors to Google Calendar when the link is live (best-effort) and carries the
// gcal_event_id back so a later move/delete stays in sync both ways. The web
// console is Nur, so these run at admin tier.
import { revalidatePath } from "next/cache";
import { admin } from "../../lib/supabase-admin";
import { emit } from "../../lib/events";
import { createEvent, patchEvent, deleteEvent, gcalConfigured } from "../../lib/gcal";

export type EventInput = {
  title: string;
  starts_on: string;            // YYYY-MM-DD
  ends_on?: string | null;
  start_time?: string | null;   // HH:MM, omit for all-day
  end_time?: string | null;
  location?: string | null;
  notes?: string | null;
  kind?: string;                // event | meeting | travel | visit | reminder
  brand?: string;               // nisria | maisha | ahadi
  attendee_ids?: string[];
};

function clean(i: EventInput) {
  const allDay = !i.start_time;
  return {
    title: String(i.title || "").trim(),
    starts_on: i.starts_on,
    ends_on: i.ends_on || null,
    start_time: i.start_time || null,
    end_time: i.end_time || null,
    all_day: allDay,
    location: i.location || null,
    notes: i.notes || null,
    kind: ["event", "meeting", "travel", "visit", "reminder"].includes(i.kind || "") ? i.kind : "event",
    brand: ["nisria", "maisha", "ahadi"].includes(i.brand || "") ? i.brand : "nisria",
    attendee_ids: i.attendee_ids || [],
  };
}

export async function createCalendarEvent(input: EventInput) {
  const db = admin();
  const row = clean(input);
  if (!row.title || !/^\d{4}-\d{2}-\d{2}$/.test(row.starts_on)) return { ok: false, error: "title and a valid date are required" };

  // Mirror to Google first (best-effort) so we can store the id atomically.
  let gcal_event_id: string | null = null;
  if (gcalConfigured()) {
    try { gcal_event_id = (await createEvent(row)).id; } catch { /* link not live yet — keep the native row */ }
  }
  const { data, error } = await db.from("calendar_events").insert({ ...row, gcal_event_id, source: "manual", created_by: "Nur" }).select("id").single();
  if (error) return { ok: false, error: error.message };
  await emit({ type: "calendar.event_created", source: "console", actor: "Nur", subject_type: "calendar_event", subject_id: data.id, payload: { title: row.title, date: row.starts_on, synced: !!gcal_event_id } });
  revalidatePath("/calendar");
  return { ok: true, id: data.id, synced: !!gcal_event_id };
}

export async function updateCalendarEvent(id: string, input: Partial<EventInput>) {
  const db = admin();
  const { data: existing } = await db.from("calendar_events").select("*").eq("id", id).single();
  if (!existing) return { ok: false, error: "event not found" };
  const merged = clean({ ...existing, ...input } as EventInput);
  const { error } = await db.from("calendar_events").update({ ...merged, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  if (existing.gcal_event_id && gcalConfigured()) {
    try { await patchEvent(existing.gcal_event_id, merged); } catch { /* best-effort */ }
  }
  await emit({ type: "calendar.event_updated", source: "console", actor: "Nur", subject_type: "calendar_event", subject_id: id, payload: { title: merged.title, date: merged.starts_on } });
  revalidatePath("/calendar");
  return { ok: true };
}

export async function deleteCalendarEvent(id: string) {
  const db = admin();
  const { data: existing } = await db.from("calendar_events").select("gcal_event_id,title").eq("id", id).single();
  const { error } = await db.from("calendar_events").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  if (existing?.gcal_event_id && gcalConfigured()) {
    try { await deleteEvent(existing.gcal_event_id); } catch { /* best-effort */ }
  }
  await emit({ type: "calendar.event_deleted", source: "console", actor: "Nur", subject_type: "calendar_event", subject_id: id, payload: { title: existing?.title } });
  revalidatePath("/calendar");
  return { ok: true };
}
