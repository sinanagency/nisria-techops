// Timezone-conversion wall (2026-06-22). Pins the fix for: the bot did Nairobi->Dubai
// math in its head and got it wrong (+2h instead of +1), storing a calendar event an hour
// off. Now CODE converts a stated source zone to the operator zone deterministically;
// the model must never do tz arithmetic. Behavioural half imports the REAL module.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { convertWallClock, normalizeZone } from "../../lib/tzconvert.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ST = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "smart-tools.ts"), "utf8");
const GC = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "gcal.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);
const eq = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? ok(m) : fail(`${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`));

// ---- Z1: the exact bug case + the math ----
{
  eq(convertWallClock("2026-06-23", "12:00", "Nairobi", "Asia/Dubai").time, "13:00", "Z1a 12:00 Nairobi = 13:00 Dubai (the bug stored 14:00)");
  eq(convertWallClock("2026-06-23", "12:00", "Africa/Nairobi", "Asia/Dubai").time, "13:00", "Z1b IANA Africa/Nairobi works too");
  eq(convertWallClock("2026-06-23", "09:00", "UTC", "Asia/Dubai").time, "13:00", "Z1c UTC 09:00 = 13:00 Dubai (+4)");
  eq(convertWallClock("2026-06-23", "15:30", "Asia/Dubai", "Asia/Dubai"), { date: "2026-06-23", time: "15:30" }, "Z1d same-zone is identity");
}

// ---- Z2: zone normalization + fail-safe ----
{
  eq(normalizeZone("Nairobi"), "Africa/Nairobi", "Z2a 'Nairobi' -> Africa/Nairobi");
  eq(normalizeZone("Nairobi time"), "Africa/Nairobi", "Z2b 'Nairobi time' -> Africa/Nairobi");
  eq(normalizeZone("EAT"), "Africa/Nairobi", "Z2c 'EAT' -> Africa/Nairobi");
  eq(normalizeZone("Narnia"), null, "Z2d an unknown zone resolves to null");
  // fail-safe: a bad zone must leave the time UNCHANGED, never silently shift it
  eq(convertWallClock("2026-06-23", "12:00", "Narnia", "Asia/Dubai"), { date: "2026-06-23", time: "12:00" }, "Z2e bad zone -> time unchanged (fail-safe)");
}

// ---- Z3: create_event converts in CODE, not the model ----
{
  if (!/import \{ convertWallClock \} from "\.\/tzconvert\.mjs";/.test(ST)) fail("Z3a smart-tools must import the deterministic converter");
  if (!/convertWallClock\(eventDate, time, String\(input\.source_timezone\), DEFAULT_TZ\)/.test(ST)) fail("Z3b create_event must convert source_timezone -> operator zone in code");
  if (!/source_timezone: \{ type: "string"/.test(ST)) fail("Z3c create_event schema must expose source_timezone");
  if (!/do NOT convert it yourself/.test(ST)) fail("Z3d the schema must instruct the model NOT to do tz math itself");
  else ok("Z3 create_event converts deterministically from the named source zone; model told not to do tz math");
}

// ---- Z4: the Google mirror labels the stored time with the operator zone (not Nairobi) ----
{
  if (/const tz = "Africa\/Nairobi";/.test(GC)) fail("Z4a gcal must NOT hardcode Africa/Nairobi (stored time is operator-local now)");
  if (!/const tz = DEFAULT_TZ;/.test(GC)) fail("Z4b gcal must label the dateTime with the operator zone (DEFAULT_TZ)");
  else ok("Z4 gcal mirror uses the operator zone, consistent with the stored operator-local time");
}

// ---- Z5: move_event ALSO converts (the gap the parallel session caught) ----
{
  const i = ST.indexOf('if (name === "move_event")');
  const region = i >= 0 ? ST.slice(i, i + 2400) : "";
  if (!/convertWallClock\(new_date, inputTime, String\(input\.source_timezone\), DEFAULT_TZ\)/.test(region)) fail("Z5a move_event must convert a new time stated in a source zone (not just create_event)");
  if (!/if \(inputTime && String\(input\.source_timezone \|\| ""\)\.trim\(\)\)/.test(region)) fail("Z5b move_event must only convert the explicitly-provided new time (not the existing stored time)");
  if (!/move_event"[\s\S]{0,1200}?source_timezone: \{ type: "string"/.test(ST)) fail("Z5c move_event schema must expose source_timezone");
  else ok("Z5 move_event converts a stated source zone too (gap closed)");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
