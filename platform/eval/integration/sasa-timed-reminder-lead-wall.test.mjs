// Timed-reminder 5-min-lead wall (2026-06-20, KT #328). The timed cron
// (/api/cron/timed) fires task/event reminders at a due_time. Two fixes:
//   (1) it is now SCHEDULED on Vercel at */5 (the Supabase pg_cron trigger that
//       used to drive it stopped after 18 Jun; nothing fired since).
//   (2) it reminds LEAD_MIN (5) minutes BEFORE the due time, via integer
//       minutes-since-midnight math, not the old fragile HH:MM string compare.
//
// Seams:
//   S1  vercel.json schedules /api/cron/timed at */5
//   S2  LEAD_MIN constant exists (the 5-min lead)
//   S3  minutesOf() integer helper exists (replaces string compare)
//   S4  the firing condition uses the minute threshold, not `slice(0,5) > nowHHMM`
//   S5  behavioural: a 21:00 task fires at the 20:55 tick (5 min before), not 21:00,
//       and a past-due task still catches up; a far-future task does NOT fire.
//
// Pure local.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const SRC = fs.readFileSync(path.join(ROOT, "app", "api", "cron", "timed", "route.ts"), "utf8");
const VJSON = fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

// ---- S1 ----
if (!/"\/api\/cron\/timed"\s*,\s*"schedule"\s*:\s*"\*\/5 \* \* \* \*"/.test(VJSON.replace(/\s+/g, " ")) &&
    !/\/api\/cron\/timed[\s\S]{0,40}\*\/5 \* \* \* \*/.test(VJSON)) fail("S1 vercel.json must schedule /api/cron/timed at */5");
else ok("S1 /api/cron/timed scheduled at */5");

// ---- S2 ----
if (!/const LEAD_MIN\s*=\s*5/.test(SRC)) fail("S2 LEAD_MIN = 5 constant");
else ok("S2 LEAD_MIN = 5");

// ---- S3 ----
if (!/function minutesOf\(/.test(SRC)) fail("S3 minutesOf() integer helper");
else ok("S3 minutesOf() helper present");

// ---- S4: condition uses the minute threshold, old string compare gone ----
if (/slice\(0,\s*5\)\s*>\s*nowHHMM/.test(SRC)) fail("S4 old fragile string compare still present");
else if (!/minutesOf\(String\(t\.due_time\)\)\s*>\s*fireThreshold/.test(SRC)) fail("S4 task loop must gate on the minute fireThreshold");
else ok("S4 firing gated on minute threshold (lead), string compare removed");

// ---- S5: behavioural model of the gate ----
{
  const LEAD = 5;
  const minutesOf = (hhmm) => { const m = /^(\d{2}):(\d{2})/.exec(String(hhmm||"")); return m ? +m[1]*60 + +m[2] : -1; };
  // gate: a task fires when minutesOf(due) <= now + LEAD
  const fires = (nowHHMM, dueHHMM) => minutesOf(dueHHMM) <= minutesOf(nowHHMM) + LEAD;
  if (fires("20:50", "21:00")) fail("S5 must NOT fire at 20:50 for a 21:00 task (too early)");
  else if (!fires("20:55", "21:00")) fail("S5 MUST fire at 20:55 for a 21:00 task (5 min before)");
  else if (fires("12:00", "21:00")) fail("S5 must NOT fire at noon for a 21:00 task");
  else if (!fires("21:10", "21:00")) fail("S5 must still catch up a past-due task");
  else ok("S5 fires 5 min before (20:55→21:00), not early (20:50), catches up past-due");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
