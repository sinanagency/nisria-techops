// Meeting scheduled-time parse wall (2026-06-22, KT #364). Nur forwarded a Zoom
// invite ("Time: Jun 22, 2026 07:30 PM Dubai ... Join this call with Digital Nur")
// at 17:50 Dubai. The old inline parser only matched "at/for 7:30pm", found no
// time, left scheduledAt undefined, so the bot was dispatched IMMEDIATELY, ~100
// min early, into a room that had not opened, and reported "nothing to summarize".
// Now parseMeetingTime (pure, tz-independent, shared with the worker — zero drift)
// reads the Zoom-invite "Time:" format and schedules for the real start.
//
// Seams: P1 the real Zoom-invite string schedules for 7:30 PM Dubai (not now);
//        P2 a bare link / no time => null (join immediately, unchanged);
//        P3 the legacy "at/for HH:MM am/pm (today|tomorrow)" still works;
//        P4 a past time today => null (immediate), never a negative schedule;
//        P5 the worker actually calls parseMeetingTime (not the old inline regex).
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { parseMeetingTime } from "../../lib/meeting-time.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
const W = fs.readFileSync(path.resolve(here, "..", "..", "app", "api", "whatsapp", "worker", "route.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

const now = Date.UTC(2026, 5, 22, 13, 50, 0); // 17:50 Dubai
const real = `Topic: Yalla Kenya 3\nTime: Jun 22, 2026 07:30 PM Dubai\nJoin Zoom Meeting\nhttps://us02web.zoom.us/j/83842522081?pwd=x\nJoin this call with Digital Nur`;

// P1: the exact failing message now schedules for 19:30 Dubai = 15:30 UTC.
if (parseMeetingTime(real, now) !== "2026-06-22T15:30:00.000Z") fail(`P1 Zoom-invite 'Time: 7:30 PM' must schedule 19:30 Dubai, got ${parseMeetingTime(real, now)}`);
else ok("P1 Zoom-invite 'Time: ... 07:30 PM Dubai' schedules 19:30 Dubai (not immediate)");

// P2: no time => null (immediate, unchanged behavior).
if (parseMeetingTime("https://zoom.us/j/1", now) !== null) fail("P2 a bare link with no time must return null (join now)");
else ok("P2 bare link / no time => null (immediate)");

// P3: legacy phrasings still work.
if (parseMeetingTime("join the call at 3pm https://zoom.us/j/1", Date.UTC(2026, 5, 22, 6, 0)) !== "2026-06-22T11:00:00.000Z") fail("P3a 'at 3pm' regression");
else if (parseMeetingTime("notes tomorrow at 9am https://zoom.us/j/1", now) !== "2026-06-23T05:00:00.000Z") fail("P3b 'tomorrow at 9am' regression");
else ok("P3 legacy 'at 3pm' / 'tomorrow at 9am' still parse");

// P4: a past time today never schedules in the past.
const past = parseMeetingTime("Time: Jun 22, 2026 02:00 PM Dubai https://zoom.us/j/1", now);
if (past !== null) fail(`P4 a past start must be null (immediate), got ${past}`);
else ok("P4 past time => null (immediate), never a negative schedule");

// P5: the worker wires the shared helper (not the old inline regex).
if (!/parseMeetingTime\(/.test(W)) fail("P5 worker must call parseMeetingTime");
else if (/timeMatch\s*=\s*\(text/.test(W)) fail("P5 the old inline timeMatch regex must be gone (drift risk)");
else ok("P5 worker uses the shared parseMeetingTime (old inline parser removed)");

if (process.exitCode) console.error("\nWALL RED."); else console.log("\nWALL GREEN.");
