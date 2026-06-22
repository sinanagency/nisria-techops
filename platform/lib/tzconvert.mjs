// Deterministic wall-clock timezone conversion (no deps). The model must NEVER do tz
// arithmetic — it added 2h instead of 1h for Nairobi->Dubai (2026-06-22) and stored a
// wrong calendar time. This does the conversion in code. KT #206540: deterministic route
// for the action, grounded model for understanding (the model names the source zone; code
// converts). Pure .mjs so the wall imports the EXACT module the app runs (agent-clock).

// Map a loose zone name (a city, an abbreviation, or an IANA id) to an IANA zone.
const ZONE_ALIASES = {
  nairobi: "Africa/Nairobi", kenya: "Africa/Nairobi", eat: "Africa/Nairobi", gilgil: "Africa/Nairobi",
  dubai: "Asia/Dubai", uae: "Asia/Dubai", gst: "Asia/Dubai", "abu dhabi": "Asia/Dubai", emirates: "Asia/Dubai",
  kampala: "Africa/Kampala", uganda: "Africa/Kampala", "dar es salaam": "Africa/Dar_es_Salaam", tanzania: "Africa/Dar_es_Salaam",
  lagos: "Africa/Lagos", nigeria: "Africa/Lagos", cairo: "Africa/Cairo", egypt: "Africa/Cairo",
  london: "Europe/London", uk: "Europe/London", utc: "UTC", gmt: "UTC", "new york": "America/New_York", est: "America/New_York",
};
export function normalizeZone(z) {
  const s = String(z || "").trim();
  if (!s) return null;
  if (/^[A-Za-z]+\/[A-Za-z_]+/.test(s)) { try { new Intl.DateTimeFormat("en-US", { timeZone: s }); return s; } catch { /* fall through */ } }
  const k = s.toLowerCase().replace(/\s+time$/, "").trim();
  if (ZONE_ALIASES[k]) return ZONE_ALIASES[k];
  try { new Intl.DateTimeFormat("en-US", { timeZone: s }); return s; } catch { return null; }
}

// Offset (ms) of an IANA tz at a given UTC instant.
function tzOffsetMs(instant, tz) {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const m = {};
  for (const p of dtf.formatToParts(instant)) m[p.type] = p.value;
  const hour = m.hour === "24" ? "00" : m.hour;
  const asIfUtc = Date.UTC(+m.year, +m.month - 1, +m.day, +hour, +m.minute, +m.second);
  return asIfUtc - instant.getTime();
}

// A wall-clock (y/mo/d/h/mi) in `tz` -> the true UTC Date.
function zonedWallToUtc(y, mo, d, h, mi, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off = tzOffsetMs(new Date(guess), tz);
  let utc = guess - off;
  const off2 = tzOffsetMs(new Date(utc), tz); // one re-check covers a DST-boundary guess
  if (off2 !== off) utc = guess - off2;
  return new Date(utc);
}

// Convert "YYYY-MM-DD" + "HH:MM" wall-clock from fromZone to toZone. Returns {date,time}
// in toZone. If either zone or the inputs cannot be parsed, returns the input UNCHANGED
// (fail-safe: a bad conversion must never silently shift a time).
export function convertWallClock(dateStr, timeStr, fromZone, toZone) {
  const from = normalizeZone(fromZone), to = normalizeZone(toZone);
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ""));
  const tm = /^(\d{1,2}):(\d{2})$/.exec(String(timeStr || ""));
  if (!from || !to || !dm || !tm) return { date: dateStr, time: timeStr };
  const t = `${String(tm[1]).padStart(2, "0")}:${tm[2]}`;
  if (from === to) return { date: `${dm[1]}-${dm[2]}-${dm[3]}`, time: t };
  const utc = zonedWallToUtc(+dm[1], +dm[2], +dm[3], +tm[1], +tm[2], from);
  const out = new Intl.DateTimeFormat("en-CA", { timeZone: to, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const m = {};
  for (const p of out.formatToParts(utc)) m[p.type] = p.value;
  const hh = m.hour === "24" ? "00" : m.hour;
  return { date: `${m.year}-${m.month}-${m.day}`, time: `${hh}:${m.minute}` };
}
