// Pure, runtime-timezone-independent extraction of a meeting's scheduled start
// from a WhatsApp message. Returns an ISO (UTC) timestamp for a genuinely future
// start, or null (meaning: join immediately). Imported by BOTH the worker (.ts)
// and its wall (.mjs) so the logic cannot drift (the agent-clock pattern, KT #360).
//
// Why this exists (KT #364): the old inline parser only matched "at/for 7:30pm".
// Nur forwards Zoom invites whose time line reads "Time: Jun 22, 2026 07:30 PM
// Dubai" — no "at"/"for" — so the parser found nothing, scheduledAt stayed
// undefined, and the bot was dispatched IMMEDIATELY, ~100 minutes before the room
// opened. It walked into an empty/closed room and reported "nothing to summarize".
//
// Dubai is UTC+4, no DST. `nowMs` is injected so the wall can test any clock.

const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000;
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

export function parseMeetingTime(text, nowMs) {
  const t = String(text || "");

  // 1) Time of day. Prefer an explicit "at/for HH(:MM) am/pm"; else any "HH:MM am/pm"
  //    (the Zoom-invite "Time: ... 07:30 PM" line); else a bare "7pm". We are only
  //    called when a meeting link is present, so a lone clock time is the meeting's.
  const mColon = t.match(/(?:at|for)\s+(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)/i)
    || t.match(/\b(\d{1,2}):(\d{2})\s*([ap]\.?m\.?)/i);
  const mBare = mColon ? null : t.match(/\b(\d{1,2})\s*([ap]\.?m\.?)(?![a-z])/i);
  if (!mColon && !mBare) return null;

  let hour, min, ap;
  if (mColon) { hour = parseInt(mColon[1], 10); min = parseInt(mColon[2] || "0", 10); ap = mColon[3]; }
  else { hour = parseInt(mBare[1], 10); min = 0; ap = mBare[2]; }
  if (Number.isNaN(hour) || Number.isNaN(min)) return null;
  const isPm = /p/i.test(ap);
  if (isPm && hour < 12) hour += 12;
  if (!isPm && hour === 12) hour = 0;
  if (hour > 23 || min > 59) return null;

  // 2) Date. Default to Dubai "today"; honor "tomorrow"; honor an explicit
  //    "Mon DD[, YYYY]" (the Zoom-invite date), which is the robust case.
  const nd = new Date(Number(nowMs) + DUBAI_OFFSET_MS);
  let y = nd.getUTCFullYear(), mo = nd.getUTCMonth(), d = nd.getUTCDate();
  const dm = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?/i);
  if (dm) {
    mo = MONTHS[dm[1].toLowerCase().slice(0, 3)];
    d = parseInt(dm[2], 10);
    if (dm[3]) y = parseInt(dm[3], 10);
  } else if (/\btomorrow\b/i.test(t)) {
    const tm = new Date(Date.UTC(y, mo, d) + 24 * 60 * 60 * 1000);
    y = tm.getUTCFullYear(); mo = tm.getUTCMonth(); d = tm.getUTCDate();
  }

  // 3) Build the UTC instant for that Dubai wall-clock time (components are Dubai
  //    local, so subtract the offset). Only schedule a genuinely future start
  //    (>60s out); otherwise return null so the caller joins immediately.
  const scheduledMs = Date.UTC(y, mo, d, hour, min, 0, 0) - DUBAI_OFFSET_MS;
  if (scheduledMs > Number(nowMs) + 60_000) return new Date(scheduledMs).toISOString();
  return null;
}
