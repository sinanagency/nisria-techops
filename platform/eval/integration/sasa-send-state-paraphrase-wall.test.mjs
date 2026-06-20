// Send-state paraphrase wall (2026-06-20). Hardens the #8 unverified-send-state
// guard (claimsUnverifiedSendState) against THREE confirmed bypasses found in a
// skeptic audit of sasa.ts. The guard's job is to catch the bot confidently
// lying about whether a message was sent without a verify-lookup this turn. The
// original regexes only caught a narrow set of phrasings; natural paraphrases
// walked right through.
//
// BUG 1 (P0 — paraphrase bypass): SEND_STATE_QUESTION / SEND_STATE_CLAIM missed
//   whole families: "Has Nur gotten the message?", "Did the message get to
//   Wahome?", "Did you send to the team?", "No messages were sent to her.",
//   "I see no record of sending that.", "She did not receive anything from me.",
//   "I reached out to Nur." (affirmative reach-out).
//
// BUG 2 (P0 — wrong-person accept): person-specific path only checked that SOME
//   read_contact_thread ran, not that it ran for the CLAIMED person. A same-turn
//   read of Mark's thread satisfied a claim about Nur. Fix: match the read's
//   input.name (read_contact_thread's input shape, see smart-tools.ts line 370)
//   against the claimed person, case-insensitive substring. Fail closed.
//
// BUG 3 (P1 — guard clobbering): claimsToolResultMismatch was a BARE if running
//   after the chain, testing rawText (the ORIGINAL model text) and overwriting a
//   more specific honest line an earlier guard already produced. Fix: gate on
//   !alreadySubstituted so it only runs when no earlier guard substituted.
//
// Pure local. No DB, no network, no Anthropic. Source-seam + behavioral.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const SASA = fs.readFileSync(path.join(ROOT, "lib", "agents", "sasa.ts"), "utf8");

const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

const extractRe = (name) => {
  const m = SASA.match(new RegExp("const\\s+" + name + "\\s*=\\s*(/[^\\n]+?/[gimsuyx]*)"));
  // eslint-disable-next-line no-eval
  return m ? eval(m[1]) : null;
};

const SEND_STATE_QUESTION = extractRe("SEND_STATE_QUESTION");
const SEND_STATE_CLAIM = extractRe("SEND_STATE_CLAIM");
const SEND_STATE_PERSON = extractRe("SEND_STATE_PERSON");

// ================= BUG 1: SEND_STATE_QUESTION paraphrases =================
{
  if (!SEND_STATE_QUESTION) fail("BUG1 SEND_STATE_QUESTION must stay one-line + extractable");
  else {
    const q = (s) => SEND_STATE_QUESTION.test(s);
    // New question paraphrases that MUST now trigger the verification requirement.
    const mustHit = [
      "Has Nur gotten the message?",
      "Did the message get to Wahome?",
      "Was anything sent to Cynthia today?",
      "Did you send to the team?",
      "Did Violet receive anything from you?",
    ];
    for (const s of mustHit) {
      if (!q(s)) fail(`BUG1.Q '${s}' must match SEND_STATE_QUESTION`);
      else ok(`BUG1.Q matched: ${s}`);
    }
    // Original true-positives MUST stay caught (no weakening).
    const stillHit = [
      "what did u send to nur?",
      "did you send the report to Mark",
      "did Nur get the message",
    ];
    for (const s of stillHit) {
      if (!q(s)) fail(`BUG1.Q regression, original now missed: '${s}'`);
      else ok(`BUG1.Q still caught: ${s}`);
    }
    // Must NOT over-fire on unrelated text.
    const mustMiss = [
      "Can you draft a newsletter for the donors?",
      "What is the balance in the AHADI account?",
      "Did you finish the report?",
    ];
    for (const s of mustMiss) {
      if (q(s)) fail(`BUG1.Q false-positive on unrelated: '${s}'`);
      else ok(`BUG1.Q correctly ignored: ${s}`);
    }
  }
}

// ================= BUG 1: SEND_STATE_CLAIM paraphrases =================
{
  if (!SEND_STATE_CLAIM) fail("BUG1 SEND_STATE_CLAIM must stay one-line + extractable");
  else {
    const c = (s) => SEND_STATE_CLAIM.test(s);
    const mustHit = [
      "No messages were sent to her.",
      "I see no record of sending that.",
      "There was no outbound to Nur.",
      "She did not receive anything from me.",
      "I reached out to Nur.",
      "She received the message from me.",
      "They got it from me.",
    ];
    for (const s of mustHit) {
      if (!c(s)) fail(`BUG1.C '${s}' must match SEND_STATE_CLAIM`);
      else ok(`BUG1.C matched: ${s}`);
    }
    // Original true-positives MUST stay caught.
    const stillHit = [
      "Nothing went out to Nur in the last 24 hours.",
      "I haven't sent her anything.",
      "I sent the report to Mark.",
    ];
    for (const s of stillHit) {
      if (!c(s)) fail(`BUG1.C regression, original now missed: '${s}'`);
      else ok(`BUG1.C still caught: ${s}`);
    }
    // Must NOT over-fire. Includes the reversed-subject over-widening traps the
    // first cut of the regex tripped on (unrelated "got"/"received" usages).
    const mustMiss = [
      "What would you like me to tell Nur?",
      "I will send the report shortly.",
      "The balance is 12,000 KES.",
      "She got back to me about the venue.",
      "They got the wrong total.",
      "He received an award last year.",
    ];
    for (const s of mustMiss) {
      if (c(s)) fail(`BUG1.C false-positive: '${s}'`);
      else ok(`BUG1.C correctly ignored: ${s}`);
    }
  }
}

// ================= BUG 1: SEND_VERB / affirmative reach-out =================
// "I reached out to Nur." is an affirmative send-state claim and must trigger the
// verification requirement (it asserts an outbound happened).
{
  if (SEND_STATE_CLAIM && !SEND_STATE_CLAIM.test("I reached out to Nur.")) {
    fail("BUG1.V affirmative 'reached out to' must trigger verification requirement");
  } else if (SEND_STATE_CLAIM) {
    ok("BUG1.V 'reached out to' triggers the verification requirement");
  }
}

// ================= BUG 2: person-specific read must match the RIGHT person ====
// Source-seam: the person-specific branch must inspect the read_contact_thread
// input (input.name) and match it against the claimed person, not merely check
// that SOME read_contact_thread ran.
{
  // The naive bypassable form is `toolRuns.some((t) => t.name === "read_contact_thread")`
  // with NOTHING reading the input. After the fix, the person branch must reference
  // a read's input (block.input/t.input/.name) and compare to the claimed person.
  const callIdx = SASA.search(/personSpecific/);
  const tail = callIdx >= 0 ? SASA.slice(callIdx, callIdx + 900) : "";
  if (callIdx < 0) fail("BUG2 personSpecific path not found");
  else {
    // Must reference the tool input (so it can match the person), not just t.name.
    if (!/\.input\b|input\?\./.test(tail) && !/readMatchesPerson|readForPerson|matchedRead/.test(SASA)) {
      fail("BUG2 person-specific path must inspect read_contact_thread input to match the person");
    } else ok("BUG2 person-specific path inspects the read's input to match the claimed person");
    // Must still require read_contact_thread (not accept show_outbound_audit for a person).
    if (!/read_contact_thread/.test(tail) && !/readMatchesPerson|readForPerson|matchedRead/.test(SASA)) {
      fail("BUG2 person-specific path must still require read_contact_thread");
    } else ok("BUG2 person-specific path still requires read_contact_thread");
  }
}

// ---- BUG 2 behavioral: run the ACTUAL shipped readMatchesPerson on real inputs ----
// Extract the function body from the source and evaluate it (TS strips cleanly to JS
// here: only a type annotation on the param, which we drop). Proves the right-person
// match accepts the correct read and rejects a same-turn read of the wrong person.
{
  const fnMatch = SASA.match(/function\s+readMatchesPerson\s*\(([^)]*)\)\s*:\s*boolean\s*\{([\s\S]*?)\n}/);
  if (!fnMatch) fail("BUG2.B readMatchesPerson not extractable for behavioral test");
  else {
    const body = fnMatch[2]
      .replace(/\(t\.input\s+as\s+any\)/g, "t.input"); // strip the lone TS cast
    // eslint-disable-next-line no-new-func
    const readMatchesPerson = new Function("toolRuns", "person", body + "\n");
    const nurRead = [{ name: "read_contact_thread", input: { name: "Nur Mnasria" }, result: {} }];
    const markRead = [{ name: "read_contact_thread", input: { name: "Mark" }, result: {} }];
    const auditOnly = [{ name: "show_outbound_audit", input: {}, result: {} }];

    if (!readMatchesPerson(nurRead, "nur")) fail("BUG2.B right-person read for Nur must match");
    else ok("BUG2.B read of Nur's thread matches a claim about Nur");

    if (readMatchesPerson(markRead, "nur")) fail("BUG2.B a read of Mark's thread must NOT satisfy a claim about Nur (the original bug)");
    else ok("BUG2.B read of Mark's thread does NOT satisfy a claim about Nur");

    if (readMatchesPerson(auditOnly, "nur")) fail("BUG2.B show_outbound_audit must NOT count as a person-matched read");
    else ok("BUG2.B show_outbound_audit does not count for the person case");

    if (!readMatchesPerson(nurRead, "Nur")) fail("BUG2.B match must be case-insensitive");
    else ok("BUG2.B match is case-insensitive");
  }
}

// ================= BUG 3: claimsToolResultMismatch gated, no clobber ==========
{
  // alreadySubstituted boolean must exist and gate the claimsToolResultMismatch block.
  if (!/alreadySubstituted/.test(SASA)) fail("BUG3 alreadySubstituted gate must exist");
  else ok("BUG3 alreadySubstituted gate declared");

  const idx = SASA.indexOf("claimsToolResultMismatch(rawText, toolRuns)");
  if (idx < 0) fail("BUG3 claimsToolResultMismatch call not found");
  else {
    // The guard condition that runs the mismatch block must be gated on the boolean.
    const head = SASA.slice(Math.max(0, idx - 80), idx + 80);
    if (!/!alreadySubstituted/.test(head)) {
      fail("BUG3 claimsToolResultMismatch must be gated on !alreadySubstituted (no clobber)");
    } else ok("BUG3 claimsToolResultMismatch gated on !alreadySubstituted");
  }
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
