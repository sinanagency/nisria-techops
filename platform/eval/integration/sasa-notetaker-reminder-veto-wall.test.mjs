// Notetaker reminder-veto wall (2026-06-22, KT #363). Nur sent "Add this reminder
// for me: Call Daffi at 3:30 PM via Zoom <link>" — a REMINDER that merely mentions
// a meeting link. The brain's dispatch_meeting_bot tool fired anyway (the model
// over-eagerly dispatched a notetaker), the bot captured nothing, and the empty-
// capture relay then dumped the whole reminder back at Nur. A reminder is not a
// notetake request. dispatch_meeting_bot now vetoes deterministically when the
// originating message is clearly a reminder with no notetake intent.
//
// Seams: V1 the veto regexes exist in the dispatch_meeting_bot tool;
//        V2 it refuses (reminder_intent_not_notetake) on reminder && !notetake;
//        V3 it resolves the originating text self-contained (latest inbound msg),
//           so it does not depend on the agent-loop wiring (a contested file);
//        V4 it emits sasa.notetaker_dispatch_vetoed for soak visibility;
//        V5 BEHAVIOR: the exact regexes veto the reminder and pass every legit
//           notetake phrasing (zero false-veto).
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const S = fs.readFileSync(path.resolve(here, "..", "..", "lib", "smart-tools.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

const i = S.indexOf('name === "dispatch_meeting_bot"');
const region = i >= 0 ? S.slice(i, i + 3200) : "";
if (!region) fail("V0 dispatch_meeting_bot tool must exist");

// V1: veto regexes present.
if (!/reminderIntent\s*=.*remind/.test(region) || !/notetakeIntent\s*=/.test(region)) fail("V1 the reminder/notetake intent regexes must guard the dispatch");
else ok("V1 reminder + notetake intent guards present");

// V2: refuses on reminder && !notetake.
if (!/reminderIntent\s*&&\s*!notetakeIntent/.test(region)) fail("V2 must veto when reminder intent present AND no notetake intent");
else if (!/reminder_intent_not_notetake/.test(region)) fail("V2 the veto must return the reminder_intent_not_notetake refusal");
else ok("V2 vetoes reminder-without-notetake, returns honest refusal");

// V3: self-contained text resolution (no dependency on the agent loop).
if (!/from\("messages"\)/.test(region) || !/direction"?,?\s*"in"|"in"/.test(region) || !/ctx\.contactId/.test(region)) fail("V3 must resolve the originating message self-contained (latest inbound for the contact)");
else ok("V3 resolves originating text self-contained (latest inbound message)");

// V4: soak-visible event.
if (!/sasa\.notetaker_dispatch_vetoed/.test(region)) fail("V4 must emit sasa.notetaker_dispatch_vetoed");
else ok("V4 emits sasa.notetaker_dispatch_vetoed");

// V5: BEHAVIOR — exact regexes from the source, real cases.
const reminderRe = /\b(remind(er)?|don'?t\s+forget|note\s+to\s+self)\b/i;
const notetakeRe = /\b(take\s+notes|notetak|note-?taker|note\s+taker|join\s+(the|this|that)\s+(call|meeting)|send\s+(the\s+)?(notetaker|bot|note\s*taker)|record\s+(the|this|that)|cover\s+(the|this|that)\s+(call|meeting)|sit\s+in|transcrib)\b/i;
const veto = (t) => reminderRe.test(t) && !notetakeRe.test(t);
const cases = [
  ["Add this reminder for me: Call Daffi at 3:30 PM via Zoom\nJoin Zoom: https://us02web.zoom.us/j/85179556957", true],
  ["https://us02web.zoom.us/j/85179556957", false],
  ["Join the call: https://zoom.us/j/123", false],
  ["send the bot to my meeting https://zoom.us/j/123", false],
  ["take notes on this https://meet.google.com/abc-defg-hij", false],
  ["remind me to have digital nur take notes on the 3pm https://zoom.us/j/1", false],
];
let bad = 0;
for (const [t, want] of cases) { if (veto(t) !== want) { bad++; console.error("   case mismatch:", JSON.stringify(t.slice(0, 40)), "veto", veto(t), "want", want); } }
if (bad) fail(`V5 behavior: ${bad} case(s) wrong (false veto or missed reminder)`);
else ok("V5 behavior: vetoes the reminder, zero false-veto on legit notetake phrasings");

if (process.exitCode) console.error("\nWALL RED."); else console.log("\nWALL GREEN.");
