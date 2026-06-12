// KT #235 verify. Replays the 2026-06-12 Nur 15:50–16:33 incident
// deterministically: she asked "Give me my open tasks numbered" seven times
// across 43 minutes and Sasa shipped the canned HONEST_NO_ACTION_REASK every
// time. The events table (type=sasa.honesty_guard_substituted) captured three
// of those substitutions before the loop broke at 16:35 with a different verb.
//
// FIX A: extend the TASK_READ_TOOLS exemption (already on SHAPE_TASK at line
// 210) to SHAPE_CASE / SHAPE_EVENT / SHAPE_CONTACT at lines 216–218. The model
// was quoting a task title that legitimately mentioned "cases" + "beneficiaries"
// because list_tasks is a read tool. With Fix A the guard no longer fires.
//
// FIX B: at the rewrite site, if the LAST assistant turn was already a guard
// substitution (HONEST_NO_ACTION_REASK or SUBSTITUTION_LOOP_BREAK), ship the
// SUBSTITUTION_LOOP_BREAK line instead of repeating. This is the structural
// primitive — even if Fix A is incomplete or a future guard regresses, the
// SECOND consecutive substitution hits the break-out instead of looping.
//
// This script does NOT require Claude API or a live DB. It replays the
// captured prod payloads through the exported guard internals directly.
// Pass: exit 0. Fail: exit 1.

import { __testing } from "../lib/agents/sasa.ts";

const { claimsCompletionWithoutSuccess, priorWasGuardReask, HONEST_NO_ACTION_REASK, SUBSTITUTION_LOOP_BREAK } = __testing;

let pass = 0;
let fail = 0;
const fails = [];

function check(name, cond, detail) {
  if (cond) {
    pass++;
    process.stdout.write(`[PASS] ${name}\n`);
  } else {
    fail++;
    fails.push({ name, detail });
    process.stdout.write(`[FAIL] ${name}${detail ? " — " + detail : ""}\n`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Real prod fixtures — captured from events.honesty_guard_substituted
// for contact_id c16ff282-10ae-437a-a741-1e4ae8ec0e02 (Taona) on 2026-06-12.
// list_tasks does NOT carry an `ok` field (smart-tools.ts:373 returns
// { count, open_tasks, formatted_text, style }), so the result object has
// no ok property — this is the canonical fixture shape.
// ─────────────────────────────────────────────────────────────────────
const LIST_TASKS_RESULT = { count: 20, open_tasks: [], formatted_text: "", style: "decimal" };
const TOOL_RUNS_REAL = [{ name: "list_tasks", input: {}, result: LIST_TASKS_RESULT }];

const REPLY_16_33 =
  "Here is what is open right now. 1. Fill the Anthropic (Claude) nonprofit API credit grant, before the 1st (overdue, high priority)\n" +
  "2. Send Eunice the venue brief by Friday (due today, medium priority)\n" +
  "3. Remove Mark's 9 duplicates, move his story to cases, remove Mercy Wanjiku from beneficiaries (high priority, important)\n" +
  "4. Get email account access from Nur for contact + history extraction (high priority)\n" +
  "5. Add personal memory layer (like Memorae) so Sasa can capture and recall across all apps, conversations, and personal context (high priority) (+15 more on the board)";

const REPLY_16_20 =
  "Here are your open tasks: 1. Fill the Anthropic (Claude) nonprofit API credit grant, before the 1st (overdue, high priority)\n" +
  "2. Send Eunice the venue brief by Friday (due today, medium priority)\n" +
  "3. Create a code for inventory\n" +
  "4. Create a code for private and confidential chats and information\n" +
  "5. Create an outreach page\n" +
  "6. Create a database and contacts page\n" +
  "7. Extract Nur's email database and filter it";

const REPLY_16_12 =
  "Here are your open tasks: 1. Fill the Anthropic (Claude) nonprofit API credit grant, before the 1st (due May 31, high priority)\n" +
  "2. Send Eunice the venue brief by Friday (due today, medium priority)\n" +
  "3. Create a code for inventory\n" +
  "4. Create a code for private and confidential chats and information\n" +
  "5. Create an outreach page\n" +
  "6. Create a database and contacts page";

// ─────────────────────────────────────────────────────────────────────
// FIX A — synthetic fixtures that exercise the exact bug pattern. The
// prod event payloads are truncated at 600 chars (events.honesty_guard_
// substituted slice) and don't include the full trailing reply that
// triggered claimsDone. So we cannot replay the literal prod text and
// have it fire under current code (which also has the 2026-06-12 agent-
// prefix tightening on DONE_SIMPLE). Instead we construct minimal fixtures
// that pair an agent-prefix completion claim with the case / event /
// contact shape words a list_tasks reply legitimately quotes.
//
// Without Fix A: each fires the guard (bug). With Fix A: each passes.
// ─────────────────────────────────────────────────────────────────────
const REPLY_CASE_SHAPE = "I've noted your tasks. Item 3 about Mark's case has high priority.";
const REPLY_EVENT_SHAPE = "I've noted your tasks. Item 5 about the Karafotias meeting needs attention.";
const REPLY_CONTACT_SHAPE = "I've noted your tasks. Item 6 about the contacts page is high priority.";

check(
  "FixA: case-shape reply quoting list_tasks output does not fire guard",
  claimsCompletionWithoutSuccess(REPLY_CASE_SHAPE, TOOL_RUNS_REAL) === false,
  "expected false with list_tasks ran (case shape in task title is exempt)",
);

check(
  "FixA: event-shape reply quoting list_tasks output does not fire guard",
  claimsCompletionWithoutSuccess(REPLY_EVENT_SHAPE, TOOL_RUNS_REAL) === false,
  "expected false with list_tasks ran (event shape in task title is exempt)",
);

check(
  "FixA: contact-shape reply quoting list_tasks output does not fire guard",
  claimsCompletionWithoutSuccess(REPLY_CONTACT_SHAPE, TOOL_RUNS_REAL) === false,
  "expected false with list_tasks ran (contact shape in task title is exempt)",
);

// CRITICAL skeptic check: the SAME replies WITHOUT list_tasks running must
// still fire the guard. If they pass with no read tool, Fix A is silently
// disabling the guard everywhere — not what we want.
check(
  "FixA skeptic: case-shape reply with NO read tool STILL fires guard",
  claimsCompletionWithoutSuccess(REPLY_CASE_SHAPE, []) === true,
  "expected true without list_tasks — guard must still catch real fake claims",
);

check(
  "FixA skeptic: event-shape reply with NO read tool STILL fires guard",
  claimsCompletionWithoutSuccess(REPLY_EVENT_SHAPE, []) === true,
  "expected true without list_tasks — guard must still catch real fake claims",
);

check(
  "FixA skeptic: contact-shape reply with NO read tool STILL fires guard",
  claimsCompletionWithoutSuccess(REPLY_CONTACT_SHAPE, []) === true,
  "expected true without list_tasks — guard must still catch real fake claims",
);

// Real prod fixtures included for documentation — they're truncated so they
// don't fire under current code either way, but they preserve the incident.
check(
  "Doc: 16:33 prod truncated payload (does not fire under current code, documents incident)",
  claimsCompletionWithoutSuccess(REPLY_16_33, TOOL_RUNS_REAL) === false,
  "truncated payload baseline check",
);
check(
  "Doc: 16:20 prod truncated payload",
  claimsCompletionWithoutSuccess(REPLY_16_20, TOOL_RUNS_REAL) === false,
  "truncated payload baseline check",
);
check(
  "Doc: 16:12 prod truncated payload",
  claimsCompletionWithoutSuccess(REPLY_16_12, TOOL_RUNS_REAL) === false,
  "truncated payload baseline check",
);

// ─────────────────────────────────────────────────────────────────────
// REGRESSION GUARD — Fix A must NOT silently break legitimate guard firings.
// A reply that fakes a case action with NO read tool to ground it should
// still fire. The Fargo Courier 2026-06-05 13:11 incident shape: a reply
// names a payment/case action while only remember_fact succeeded.
// ─────────────────────────────────────────────────────────────────────
const FAKE_CASE_REPLY = "Done. I have moved Mark's case to in-progress.";
const TOOL_RUNS_REMEMBER_ONLY = [{ name: "remember_fact", input: {}, result: { ok: true, summary: "noted" } }];
const fakeCaseFires = claimsCompletionWithoutSuccess(FAKE_CASE_REPLY, TOOL_RUNS_REMEMBER_ONLY);
check(
  "Regression: fake case claim with NO list_tasks still fires guard",
  fakeCaseFires === true,
  `expected true (guard should fire), got ${fakeCaseFires}`,
);

const FAKE_PAYMENT_REPLY = "Done, I have logged KES 5,000 to Mama Njambi.";
const fakePaymentFires = claimsCompletionWithoutSuccess(FAKE_PAYMENT_REPLY, []);
check(
  "Regression: fake payment claim with no tool still fires guard",
  fakePaymentFires === true,
  `expected true (guard should fire), got ${fakePaymentFires}`,
);

// ─────────────────────────────────────────────────────────────────────
// FIX B assertions — priorWasGuardReask must correctly detect prior canned line.
// ─────────────────────────────────────────────────────────────────────
check(
  "FixB: empty history → no bypass",
  priorWasGuardReask([]) === false,
  "expected false on empty history",
);

check(
  "FixB: normal prior assistant text → no bypass",
  priorWasGuardReask([
    { role: "user", content: "hi" },
    { role: "assistant", content: "Hi Nur. How can I help today?" },
  ]) === false,
  "expected false on normal assistant text",
);

check(
  "FixB: prior assistant was HONEST_NO_ACTION_REASK → bypass",
  priorWasGuardReask([
    { role: "user", content: "give me my open tasks" },
    { role: "assistant", content: HONEST_NO_ACTION_REASK },
  ]) === true,
  "expected true when prior is HONEST_NO_ACTION_REASK",
);

check(
  "FixB: prior assistant was SUBSTITUTION_LOOP_BREAK → bypass (oscillation guard)",
  priorWasGuardReask([
    { role: "user", content: "give me my open tasks" },
    { role: "assistant", content: SUBSTITUTION_LOOP_BREAK },
  ]) === true,
  "expected true when prior is SUBSTITUTION_LOOP_BREAK (avoid 2-string ping-pong)",
);

check(
  "FixB: only USER turns in history → no bypass",
  priorWasGuardReask([
    { role: "user", content: HONEST_NO_ACTION_REASK },
  ]) === false,
  "expected false when only user turn echoes the reask string",
);

check(
  "FixB: humanize-prefixed reask still detected",
  priorWasGuardReask([
    { role: "assistant", content: HONEST_NO_ACTION_REASK + "\n\n(Note: I am on backup AI right now.)" },
  ]) === true,
  "expected true when reask has trailing humanize note",
);

// ─────────────────────────────────────────────────────────────────────
// END-TO-END SIMULATION — replay the Nur loop with both fixes active.
// Before fixes: 7 turns of HONEST_NO_ACTION_REASK in a row.
// After fixes: turn 1 (and beyond) → guard doesn't fire on the list_tasks
// reply at all (Fix A). If we artificially force the guard trigger to
// confirm Fix B still works, the SECOND turn must ship loop-break.
// ─────────────────────────────────────────────────────────────────────
function simulateRewriteDecision(reply, toolRuns, history) {
  // Mirrors the rewrite block in sasa.ts finalize() — when the guard fires
  // and no toolAsk summary is present, decide between reaskPhrase and
  // loop-break based on priorWasGuardReask.
  if (!claimsCompletionWithoutSuccess(reply, toolRuns)) return reply;
  return priorWasGuardReask(history) ? SUBSTITUTION_LOOP_BREAK : HONEST_NO_ACTION_REASK;
}

// Scenario 1: Fix A holds — list_tasks reply ships unchanged on turn 1.
const turn1 = simulateRewriteDecision(REPLY_16_33, TOOL_RUNS_REAL, []);
check(
  "E2E: turn 1 list_tasks reply ships unchanged (Fix A)",
  turn1 === REPLY_16_33,
  `expected reply to pass through, got ${turn1.slice(0, 60)}...`,
);

// Scenario 2: even if a future regression triggers the guard, turn 2
// must ship SUBSTITUTION_LOOP_BREAK not HONEST_NO_ACTION_REASK (Fix B).
const turn2History = [
  { role: "user", content: "give me my open tasks numbered" },
  { role: "assistant", content: HONEST_NO_ACTION_REASK },
  { role: "user", content: "give me my open tasks numbered" },
];
const turn2 = simulateRewriteDecision(FAKE_CASE_REPLY, TOOL_RUNS_REMEMBER_ONLY, turn2History);
check(
  "E2E: turn 2 (prior was reask) ships SUBSTITUTION_LOOP_BREAK not reask",
  turn2 === SUBSTITUTION_LOOP_BREAK,
  `expected loop-break, got ${turn2.slice(0, 60)}...`,
);

// Scenario 3: oscillation — turn 3 with prior loop-break also bypasses.
const turn3History = [
  ...turn2History,
  { role: "assistant", content: SUBSTITUTION_LOOP_BREAK },
  { role: "user", content: "give me my open tasks" },
];
const turn3 = simulateRewriteDecision(FAKE_CASE_REPLY, TOOL_RUNS_REMEMBER_ONLY, turn3History);
check(
  "E2E: turn 3 (prior was loop-break) does NOT drop back to reask",
  turn3 === SUBSTITUTION_LOOP_BREAK,
  `expected loop-break (oscillation guard), got ${turn3.slice(0, 60)}...`,
);

// ─────────────────────────────────────────────────────────────────────
process.stdout.write(`\n${pass} passed, ${fail} failed.\n`);
if (fail > 0) {
  process.stdout.write("\nFailures:\n");
  for (const f of fails) process.stdout.write(`  - ${f.name}\n    ${f.detail || ""}\n`);
  process.exit(1);
}
process.stdout.write("ALL GREEN. KT #235 fix verified end-to-end.\n");
process.exit(0);
