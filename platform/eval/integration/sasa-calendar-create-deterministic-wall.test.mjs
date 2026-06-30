// Deterministic calendar-create wall (2026-06-30, KT #206540 - the Dorje silent-fail).
// create_event WORKS when called, but the model sometimes fails to call it, narrates
// "scheduled it", and the honesty rail rewrites that to a stub -> the event silently
// never lands. The new worker block detects a calendar-create intent BEFORE the brain
// (imperative scheduling VERB + event noun), extracts fields with a scoped Haiku, then
// CODE calls create_event so the action always fires. This wall mirrors the intent
// detector (must catch real schedules, must NOT hijack reminders/tasks/statements/
// list/move/cancel) and asserts the worker block exists (anti-drift). The Haiku extract
// is the strict gate at runtime; here we prove the deterministic GATE in/out behaviour.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

// --- mirrors of the worker-block detector (keep byte-identical) ---
const calCreate = (c) => /\b(?:schedule|set\s*up|book|arrange|put|add|block|pencil(?:\s+in)?|plan|create)\b[\s\S]{0,40}\b(?:meeting|call|event|appointment|appt|visit|trip|travel|session|catch[- ]?up|sync|review|interview|demo|day)\b/i.test(c || "");
const notCal = (c) => /\b(?:remind\s+me|reminder|^remind|a?\s*task\b|to-?do|todo|list|show|what'?s\s+on|move|reschedule|cancel|delete|remove|did\s+i|do\s+i\s+have)\b/i.test(c || "");
const fires = (c) => calCreate(c) && !notCal(c);
const pad = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || "")); return m ? `${m[1].padStart(2, "0")}:${m[2]}` : undefined; };

// ---- C1: real calendar-create intents fire (the Dorje class) ----
{
  for (const c of [
    "schedule a call at 3pm",
    "put the donor meeting on Tuesday at 3",
    "block Thursday for the Kibera visit",
    "set up a meeting next Friday with the board",
    "book a call with Mwangi tomorrow at 10",
    "add a team day on the 14th",
  ]) if (!fires(c)) fail(`C1 "${c}" must route to deterministic create_event`);
  ok("C1 imperative schedule + event noun fires the deterministic route");
}

// ---- C2: must NOT hijack reminders / tasks / statements / list / move / cancel ----
{
  for (const c of [
    "remind me to call mom tomorrow",        // reminder (task), not calendar
    "I have a meeting tomorrow at 3",          // a statement, no scheduling verb
    "what's on my calendar today",             // a read
    "move the meeting to 4pm",                 // reschedule, not create
    "cancel the call with the donor",          // delete
    "add a task to email the donor",           // task, not event
    "do I have anything on Friday",            // a read
  ]) if (fires(c)) fail(`C2 "${c}" must NOT be hijacked by calendar-create`);
  ok("C2 reminders / tasks / statements / reads / move / cancel are not hijacked");
}

// ---- C3: time normaliser pads to HH:MM (create_event requires 2-digit hour) ----
{
  if (pad("9:00") !== "09:00") fail("C3a '9:00' must pad to '09:00'");
  if (pad("15:30") !== "15:30") fail("C3b '15:30' stays '15:30'");
  if (pad("3pm") !== undefined) fail("C3c non HH:MM ('3pm') must be undefined, not passed raw");
  if (pad(null) !== undefined || pad("") !== undefined) fail("C3d null/empty -> undefined");
  ok("C3 time normaliser pads / rejects correctly");
}

// ---- C4: the worker block exists and calls create_event itself (anti-drift) ----
{
  const src = readFileSync(resolve(HERE, "../../app/api/whatsapp/worker/route.ts"), "utf8");
  const need = ["const calCreate =", "const notCal =", 'runSmartTool("create_event"', "sasa.event_created_deterministic", "claudeJSON(SYS, command, 350, HAIKU)"];
  for (const m of need) if (!src.includes(m)) fail(`C4 worker block missing marker: ${m}`);
  if (!/sasa\.event_needs_date/.test(src)) fail("C4 missing the no-date deterministic ask (must never silently drop)");
  ok("C4 worker block present: detect -> Haiku extract -> CODE calls create_event (action always fires)");
}

if (process.exitCode) console.error("\nsasa-calendar-create-deterministic-wall: FAIL");
else console.log("\nsasa-calendar-create-deterministic-wall: ALL GREEN");
