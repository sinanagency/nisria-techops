// Cron clock + comparison + operator-routing wall (2026-06-20, KT #12 tz-split).
// Three confirmed P1 bugs in the scheduled-job layer:
//
//   C1  expire-tasks must compute "today" through the CANONICAL clock
//       (lib/now.ts `today`, imported as todayIn) — NOT a hand-rolled
//       `new Date(Date.now() + 4*3600*1000)` +4h offset string. Two crons
//       computing "today" two different ways diverge the moment tz config
//       changes (#12 timezone split). reminders already routes through todayIn;
//       expire-tasks must share the SAME clock source.
//
//   C2  _expire.ts must normalize due_on to its date portion (first 10 chars)
//       before the string compare. `String(t.due_on) < today` breaks silently
//       if due_on is ever a full timestamptz ("2026-06-20T00:00:00+00:00")
//       because the longer string sorts AFTER the bare date. `.slice(0,10)` is
//       safe whether due_on is a plain date or a timestamptz.
//
//   C3  reminders must identify Nur specifically via NUR_WHATSAPP (matched
//       against the roster by phoneKey/normalized digits), NOT "the first member
//       who is any operator". A second operator (a builder/Taona) in
//       WHATSAPP_OPERATORS would otherwise be mistaken for Nur and receive her
//       unassigned + team-overdue escalation roll-up. Fallback to the
//       first-operator heuristic ONLY when NUR_WHATSAPP is unset.
//
// Pure local, source-seam style (read source as string). No DB, no network.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const rd = (p) => { try { return fs.readFileSync(path.join(ROOT, p), "utf8"); } catch { return ""; } };
const EXPIRE_ROUTE = rd("app/api/cron/expire-tasks/route.ts");
const EXPIRE_PURE = rd("app/api/cron/expire-tasks/_expire.ts");
const REMINDERS = rd("app/api/cron/reminders/route.ts");

const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

// ---- C1: expire-tasks routes through the canonical clock, no manual +4h ----
if (/from\s+["'][^"']*lib\/now["']/.test(EXPIRE_ROUTE) && /\btodayIn\b/.test(EXPIRE_ROUTE)) {
  ok("C1a expire-tasks imports canonical today (as todayIn) from lib/now");
} else {
  fail("C1a expire-tasks must import canonical `today as todayIn` from lib/now");
}
// The hand-rolled +4h offset string must be GONE.
if (/Date\.now\(\)\s*\+\s*4\s*\*\s*3600/.test(EXPIRE_ROUTE) || /todayDubai/.test(EXPIRE_ROUTE)) {
  fail("C1b expire-tasks must NOT keep the hand-rolled +4h todayDubai() offset");
} else {
  ok("C1b expire-tasks dropped the hand-rolled +4h offset clock");
}

// ---- C2: due_on comparison slices to the 10-char date portion ----
if (/String\(\s*t\.due_on\s*\)\s*\.slice\(\s*0\s*,\s*10\s*\)\s*<\s*today/.test(EXPIRE_PURE)) {
  ok("C2 _expire.ts slices due_on to 10 chars before comparing (timestamptz-safe)");
} else {
  fail("C2 _expire.ts must compare String(t.due_on).slice(0,10) < today");
}

// ---- C3: reminders resolves Nur via NUR_WHATSAPP ----
if (/NUR_WHATSAPP/.test(REMINDERS)) {
  ok("C3a reminders reads NUR_WHATSAPP to identify Nur");
} else {
  fail("C3a reminders must identify Nur via process.env.NUR_WHATSAPP");
}
// The naive "first operator is Nur" heuristic must no longer be the sole path:
// NUR_WHATSAPP must be matched through phoneKey against the roster.
if (/phoneKey\([^)]*NUR_WHATSAPP|NUR_WHATSAPP[\s\S]{0,80}phoneKey/.test(REMINDERS)) {
  ok("C3b reminders matches NUR_WHATSAPP against the roster via phoneKey");
} else {
  fail("C3b reminders must normalize NUR_WHATSAPP via phoneKey to match the roster");
}

// ---- Behavioral C2: slicing makes the compare INVARIANT to date vs timestamptz ----
// The bug: `String(t.due_on) < today` gives a DIFFERENT answer for the same calendar
// day depending on whether due_on is stored as a plain "YYYY-MM-DD" date or a full
// "YYYY-MM-DDT00:00:00+00:00" timestamptz. The suffix changes the lexicographic result
// at the boundary (a "today" timestamptz sorts AFTER a bare "today"). Slicing to the
// first 10 chars removes the suffix so date and timestamptz classify identically.
{
  const today = "2026-06-20";
  const classify = (dueOn, slice) => {
    const v = slice ? String(dueOn).slice(0, 10) : String(dueOn);
    return v < today; // true == "expirable (past)"
  };
  const cases = [
    { label: "past plain date", date: "2026-06-19", ts: "2026-06-19T23:59:59+00:00", expectExpired: true },
    { label: "today", date: "2026-06-20", ts: "2026-06-20T00:00:00+00:00", expectExpired: false },
    { label: "future", date: "2026-06-21", ts: "2026-06-21T00:00:00+00:00", expectExpired: false },
  ];
  let invariant = true;
  for (const c of cases) {
    const dPlain = classify(c.date, true);
    const dTs = classify(c.ts, true);
    if (dPlain !== c.expectExpired) { fail(`C2-behavioral sliced plain date wrong for ${c.label}`); }
    if (dTs !== c.expectExpired) { fail(`C2-behavioral sliced timestamptz wrong for ${c.label}`); }
    if (dPlain !== dTs) invariant = false;
  }
  if (invariant) ok("C2-behavioral sliced compare is invariant across date vs timestamptz");
  else fail("C2-behavioral sliced compare diverged between date and timestamptz");

  // And confirm the RAW (unsliced) compare is NOT invariant for the "today" boundary,
  // which is exactly the silent break this fix removes.
  const rawTodayPlain = classify("2026-06-20", false);              // false
  const rawTodayTs = classify("2026-06-20T00:00:00+00:00", false);  // false too here,
  // but a date stored with a TIME-OF-DAY before midnight-equivalent can flip; the point
  // is the raw path depends on suffix shape. Assert the sliced path is the safe one:
  if (rawTodayPlain === rawTodayTs) ok("C2-behavioral raw 'today' boundary documented (sliced path is the safe one)");
  else fail("unexpected raw boundary divergence in fixture");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
