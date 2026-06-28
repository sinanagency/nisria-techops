// Digital Nur autopilot. Every cron tick, walks nur@nisria.co's Gmail inbox
// for meeting invites (Zoom / Meet / Teams), extracts the join link and the
// start time, schedules the meeting-bot 30s before the meeting, and pings Nur
// on WhatsApp so she is not surprised. Idempotent via the `lr_dispatch_latched`
// kv (same lane as Jensen's pattern, but Nur's id namespace).
//
// We impersonate nur@nisria.co with the same SA + DWD the bank-extraction
// pipeline already uses. No new consent step.

import { fetchFullMessage, searchInboxFor } from "@/lib/gmail";
import { rememberEmail } from "@/lib/memory";
import { dispatchMeetingBot } from "@/lib/digital-u";
import { admin } from "@/lib/supabase-admin";
import { sendTextAndLog, phoneKey } from "@/lib/whatsapp";
import { claudeJSON, NO_DASHES } from "@/lib/anthropic";

const NUR_SUBJECT = "nur@nisria.co";
const KV_KEY = "digital_u_latched_nur";
const CAP = 500;

const MEET_RE = /(https?:\/\/(?:meet\.google\.com|[^\s"<]*zoom\.us|teams\.(?:microsoft|live)\.com)\/[\w\-/?&=#.@]+)/i;

function nurNumber(): string {
  const raw = process.env.NUR_WHATSAPP;
  if (!raw) throw new Error("NUR_WHATSAPP env not set. Set it to Nur's WhatsApp number (digits only, no +).");
  return phoneKey(raw);
}

function extractMeetingUrl(text: string): string | null {
  const m = String(text || "").match(MEET_RE);
  if (!m) return null;
  return m[1].replace(/[).,;'"!?\]<>]+$/, "");
}

// Pull DTSTART out of an ICS-formatted blob. Returns an ISO timestamp string
// in UTC, or null. Supports both naive (UTC-suffix Z) and TZID forms in a
// best-effort way; we treat TZID as Africa/Nairobi if not parseable, which
// matches Nur's timezone.
function parseIcsDtstart(body: string): string | null {
  const m = body.match(/DTSTART(?:;TZID=[^:]+)?:(\d{8}T\d{6}Z?)/);
  if (!m) return null;
  const raw = m[1];
  const yyyy = raw.slice(0, 4), mm = raw.slice(4, 6), dd = raw.slice(6, 8);
  const HH = raw.slice(9, 11), MM = raw.slice(11, 13), SS = raw.slice(13, 15);
  const isUtc = raw.endsWith("Z");
  const iso = `${yyyy}-${mm}-${dd}T${HH}:${MM}:${SS}${isUtc ? "Z" : "+03:00"}`;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

type Extracted = {
  link: string | null;
  startIso: string | null;
  title: string | null;
};

// Best-effort extraction. Try ICS first (deterministic). Fall back to Claude
// if ICS is missing or unparseable. Returns null fields when nothing usable.
async function extractInvite(subject: string, snippet: string, body: string): Promise<Extracted> {
  const link = extractMeetingUrl(`${snippet}\n${body}`);
  const startIso = parseIcsDtstart(body);
  if (link && startIso) {
    return { link, startIso, title: subject || "Meeting" };
  }
  // LLM fallback for trickier bodies (HTML-heavy, time encoded as "Tuesday 3pm",
  // etc). Cheap because we only hit it when the deterministic path missed.
  try {
    const llm = await claudeJSON<{ link: string | null; startIso: string | null; title: string | null }>(
      [
        "You read a meeting invite email and return the meeting URL, the start time as an ISO 8601 timestamp, and a short title.",
        "If the email does not have a real meeting with a concrete date+time AND a Zoom/Meet/Teams URL, return all nulls.",
        "Times that say 'next week' or have no date returned as null for startIso (never guess a date).",
        "Treat Dubai (UTC+04:00) as the default timezone if none is given.",
        NO_DASHES,
      ].join("\n"),
      `Subject: ${subject}\n\n${body.slice(0, 8000)}\n\nReturn JSON: {"link":"https://...","startIso":"YYYY-MM-DDTHH:MM:SS+04:00","title":"..."}`,
      400,
    );
    return {
      link: link || llm?.link || null,
      startIso: startIso || llm?.startIso || null,
      title: llm?.title || subject || null,
    };
  } catch {
    return { link, startIso, title: subject || null };
  }
}

export type SweepResult = {
  ok: boolean;
  scanned: number;
  candidates: number;
  latched: number;
  alreadyLatched: number;
  failed: number;
  errors?: string[];
};

export async function sweepNurInbox(): Promise<SweepResult> {
  const errors: string[] = [];
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_B64) {
    return { ok: false, scanned: 0, candidates: 0, latched: 0, alreadyLatched: 0, failed: 0, errors: ["GOOGLE_SERVICE_ACCOUNT_B64 not configured"] };
  }
  const db = admin();

  // Pull recent invitation-shaped messages. Gmail search filter narrows the
  // candidate set so we don't read 100 newsletters per tick. The query union
  // covers Zoom / Meet / Teams / generic ICS invites.
  let hits: any[] = [];
  try {
    // 30-day window: wide enough to catch invites that landed before this
    // cron came online, narrow enough to keep API cost down. The `latched`
    // kv prevents re-processing the same id once seen. Past-time meetings
    // get marked latched-as-skipped (the future-join check below) so they
    // never reappear in candidates.
    // Two passes because Gmail's `has:attachment filename:ics` doesn't
    // OR-merge cleanly with the URL clauses (silently AND-joins). One pass
    // for explicit URL mentions, one for ICS attachments + invitation subject.
    // De-duplicate by id.
    const [pass1, pass2] = await Promise.all([
      searchInboxFor(NUR_SUBJECT, 'newer_than:30d (zoom.us OR meet.google.com OR teams.microsoft.com OR teams.live.com)', 40),
      searchInboxFor(NUR_SUBJECT, 'newer_than:30d (subject:invitation OR (has:attachment filename:ics))', 40),
    ]);
    const seenIds = new Set<string>();
    hits = [...pass1, ...pass2].filter((h) => { if (seenIds.has(h.id)) return false; seenIds.add(h.id); return true; });
  } catch (e: any) {
    return { ok: false, scanned: 0, candidates: 0, latched: 0, alreadyLatched: 0, failed: 0, errors: [`gmail-list: ${e?.message || String(e)}`] };
  }

  if (hits.length === 0) {
    return { ok: true, scanned: 0, candidates: 0, latched: 0, alreadyLatched: 0, failed: 0 };
  }

  // Idempotency ledger — dedicated digital_u_latched table. (Jensen-PA uses
  // a kv row; Nisria has no kv table so we use a real table.)
  const ids = hits.map((h) => h.id);
  const { data: existing } = await db.from("digital_u_latched").select("gmail_id").in("gmail_id", ids);
  const alreadySet = new Set<string>((existing || []).map((r: any) => r.gmail_id));

  let latchedCount = 0;
  let alreadyLatched = 0;
  let failed = 0;
  let candidates = 0;
  const to = nurNumber();

  for (const hit of hits) {
    if (alreadySet.has(hit.id)) { alreadyLatched++; continue; }
    candidates++;
    try {
      const full = await fetchFullMessage(NUR_SUBJECT, hit.id);
      // Full email awareness: remember every email the sweep reads (deduped by
      // message id), so a later reference resolves on recall. Fire-and-forget.
      void rememberEmail({ id: hit.id, from: hit.from, subject: hit.subject, date: hit.date, body: full.body });
      const ext = await extractInvite(hit.subject || "", hit.snippet || "", full.body);

      if (!ext.link || !ext.startIso) {
        try { await db.from("digital_u_latched").insert({ gmail_id: hit.id, outcome: !ext.link ? "skipped_no_link" : "skipped_unparseable" }); } catch {}
        continue;
      }
      const joinAt = new Date(ext.startIso).getTime();
      if (!Number.isFinite(joinAt) || joinAt < Date.now() + 60_000) {
        try { await db.from("digital_u_latched").insert({ gmail_id: hit.id, outcome: "skipped_past" }); } catch {}
        continue;
      }
      const scheduledAt = new Date(joinAt - 30_000).toISOString();
      // RESERVE-BEFORE-DISPATCH (KT #387, 727 cartography). The ledger row used to be written
      // AFTER dispatch in a swallowed catch — so a ledger failure post-dispatch let the next
      // 5-min tick re-dispatch the same meeting (two bots join, Nur pinged twice). Claim the
      // gmail_id FIRST (outcome "dispatching"); the next tick then sees it and skips. On a
      // dispatch FAILURE we RELEASE the claim so a later tick can retry (no silent never-join).
      const { error: reserveErr } = await db.from("digital_u_latched").insert({ gmail_id: hit.id, outcome: "dispatching" });
      if (reserveErr) { errors.push(`reserve ${hit.id}: ${(reserveErr as any).message || "claim failed"}`); continue; }
      const r = await dispatchMeetingBot({
        link: ext.link,
        title: ext.title || hit.subject || "Meeting",
        scheduledAt,
        displayName: "Digital Nur",
      });
      if (!r.ok) {
        failed++; errors.push(`dispatch ${hit.id}: ${r.error}`);
        try { await db.from("digital_u_latched").delete().eq("gmail_id", hit.id).eq("outcome", "dispatching"); } catch {}
        continue;
      }
      try { await db.from("digital_u_latched").update({ outcome: "dispatched", meeting_id: r.eventId || r.botId || null }).eq("gmail_id", hit.id); } catch {}
      latchedCount++;

      // Heads-up to Nur in Sasa's voice. Best-effort; never blocks the latch.
      if (to) {
        const localTime = new Date(joinAt).toLocaleString("en-GB", { timeZone: "Africa/Nairobi", weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
        const heads = `Hi Nur, I saw an invite for ${ext.title || hit.subject || "a meeting"} on ${localTime}. I will join it as Digital Nur, take the notes, and send you the summary and your action items here when it ends. Reply skip if you would rather I sit this one out.`;
        try { await sendTextAndLog(db, to, heads, { handledBy: "sasa" }); } catch (e: any) { errors.push(`heads-up ${hit.id}: ${e?.message || String(e)}`); }
      }
    } catch (e: any) {
      failed++;
      errors.push(`extract ${hit.id}: ${e?.message || String(e)}`);
    }
  }

  return {
    ok: errors.length === 0,
    scanned: hits.length,
    candidates,
    latched: latchedCount,
    alreadyLatched,
    failed,
    errors: errors.length ? errors : undefined,
  };
}
