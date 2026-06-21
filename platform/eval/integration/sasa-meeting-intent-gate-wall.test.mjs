// Meeting-link intent gate wall (2026-06-21, KT #338). The worker dispatched a
// notetaker on ANY message containing a meeting link. "Change the meeting to 1PM
// and this is the zoom link: <url>" (Nur, 2026-06-21 00:34) is a SCHEDULING intent
// — save the link / move the meeting — not "send a bot to sit in the call". It
// mis-fired: garbled title (whole message), a 500 from the dispatch, and a
// contradictory double-reply. Fix: only auto-dispatch when notes are clearly
// wanted OR the message is essentially just the link; scheduling messages fall
// through to the brain.
//
// Seams:
//   S1  the worker has an intent gate (wantsNotes / schedulingMeeting) before dispatch
//   S2  the dispatch is gated on (wantsNotes || !schedulingMeeting), not bare link
//   S3  behavioural: Nur's "change the meeting to 1PM + link" does NOT dispatch;
//       a bare link, a "take notes" and a "join the meeting" DO dispatch.
//
// Pure local.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const W = fs.readFileSync(path.resolve(HERE, "..", "..", "app", "api", "whatsapp", "worker", "route.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

// ---- S1 ----
if (!/wantsNotes/.test(W) || !/schedulingMeeting/.test(W)) fail("S1 worker must compute a notetake-intent gate (wantsNotes / schedulingMeeting)");
else ok("S1 intent gate present in the worker");

// ---- S2 ----
if (!/if\s*\(\s*meetingLink\s*&&\s*\(\s*wantsNotes\s*\|\|\s*!schedulingMeeting\s*\)\s*\)/.test(W.replace(/\s+/g, " "))) fail("S2 dispatch must be gated on (wantsNotes || !schedulingMeeting), not bare meetingLink");
else ok("S2 dispatch gated on intent, not bare link");

// ---- S3: behavioural model (mirror the worker's regexes) ----
{
  const wantsNotesRe = /\b(take\s+notes|notetak|note-?taker|note\s+taker|join\s+(the|this|that)\s+(call|meeting)|send\s+(the\s+)?(notetaker|bot|note\s*taker)|record\s+(the|this|that)|cover\s+(the|this|that)\s+(call|meeting)|sit\s+in|minute|transcrib)\b/i;
  const schedRe = /\b(change|chang|move|moved|reschedul|push|shift|set\s?up|schedul|book|cancel|update)\b[\s\S]{0,30}\b(meeting|call|zoom|event)\b|\b(meeting|call|zoom)\b[\s\S]{0,20}\b(to|at|for|is)\b\s*\d|here'?s\s+the\s+(zoom|meeting|link)|this\s+is\s+the\s+(zoom|meeting|link)/i;
  const dispatches = (t) => wantsNotesRe.test(t) || !schedRe.test(t);
  const NUR = "Change the meeting to 1PM and this is the zoom link: https://us02web.zoom.us/j/85179556957?pwd=x";
  if (dispatches(NUR)) fail("S3 Nur's 'change the meeting to 1PM + link' must NOT dispatch a notetaker");
  else if (!dispatches("https://us02web.zoom.us/j/85179556957")) fail("S3 a bare meeting link SHOULD dispatch");
  else if (!dispatches("take notes on this call https://meet.google.com/abc")) fail("S3 'take notes' SHOULD dispatch");
  else if (!dispatches("join the meeting and notetake https://zoom.us/j/1")) fail("S3 'join the meeting' SHOULD dispatch");
  else ok("S3 scheduling skips dispatch; bare link / take-notes / join-meeting dispatch");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
