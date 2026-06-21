// Bare-praise acknowledgement no-op wall (2026-06-21, KT #349). Live incident: Nur
// said "Great!" right after the bot queued an email to Needs You. "Great!" fell
// through the confirm gate (nothing was staged in pending_actions), reached the
// brain, which RE-RAN draft_email -> a DUPLICATE approval card, and narrated "Done…
// in Needs You" with only search_history run -> the honesty guard replaced it with
// the canned reask. Root: a bare acknowledgement was treated as a fresh request.
// Fix: a bare-praise/ack token (with nothing staged) is a no-op warm reply that
// never wakes the brain. It sits AFTER the confirm gate (so staged confirmations
// still commit) and BEFORE historyFor (so the brain is skipped), and never touches
// the yes-regex (so "Great, do it" / "Perfect, send it" still confirm).
//
// Seams:
//   S1  the ACK_ONLY no-op exists in the worker: emits sasa.ack_noop + markJobDone + return
//   S2  it runs AFTER the confirm gate and BEFORE historyFor (skips the brain)
//   S3  the yes-regex was NOT stripped of great/perfect (staged confirmations survive)
//   S4  behavioural: bare praise/ack is caught; praise+verb, real yes, and requests are NOT
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
if (!/ACK_ONLY\s*=/.test(W)) fail("S1 worker must define an ACK_ONLY bare-praise matcher");
else if (!/ACK_ONLY\.test\(String\(text \|\| ""\)\)/.test(W)) fail("S1 the no-op must test the inbound text against ACK_ONLY");
else if (!/sasa\.ack_noop/.test(W)) fail("S1 must emit sasa.ack_noop for observability");
else ok("S1 ACK_ONLY no-op present + observable");

// ---- S2: placement (after confirm gate, before historyFor) ----
{
  const iAck = W.indexOf("ACK_ONLY =");
  const iHist = W.indexOf("const history = await historyFor");
  const iGate = W.indexOf("neither yes nor no: leave recent stages pending");
  if (iAck < 0 || iHist < 0 || iGate < 0) fail("S2 could not locate gate/ack/history anchors");
  else if (!(iGate < iAck && iAck < iHist)) fail("S2 the ACK no-op must sit AFTER the confirm gate and BEFORE historyFor (skip the brain)");
  else {
    // the no-op block must return before the brain
    const region = W.slice(iAck, iHist);
    if (!/markJobDone\(job\.id\);\s*return;/.test(region)) fail("S2 the no-op must markJobDone + return (never reach the brain)");
    else ok("S2 no-op runs after the gate, before the brain, and returns");
  }
}

// ---- S3: the yes-regex still contains great/perfect (NOT stripped) ----
{
  // the deterministic confirm gate's affirmation regex must still admit praise so a
  // genuinely STAGED action confirmed with "Great, do it" / "Perfect" still commits.
  const yesLine = W.split("\n").find((l) => /const yes\s*=\s*\//.test(l)) || "";
  if (!/\bgreat\b/.test(yesLine) || !/\bperfect\b/.test(yesLine)) fail("S3 the staged-confirm yes-regex must STILL contain great|perfect (do not strip them — would break 'Great, do it')");
  else ok("S3 yes-regex untouched: staged confirmations incl. 'Great, do it' still commit");
}

// ---- S4: behavioural (mirror ACK_ONLY exactly) ----
{
  const ACK_ONLY = /^\s*(?:great|perfect|awesome|amazing|wonderful|excellent|brilliant|lovely|nice|cool|fab|fabulous|love\s*it|thank\s*you|thanks|thanx|thx|ty)[\s!.,]*$|^[\s👍✅💯🙏🙌🎉❤️🔥👏]+$/i;
  const caught = (t) => ACK_ONLY.test(t);
  // bare praise / ack -> no-op
  for (const t of ["Great!", "Perfect", "perfect.", "Thanks!", "thank you", "awesome", "Love it", "ty", "Nice", "👍", "🙏🙌", "❤️🔥"]) {
    if (!caught(t)) { fail(`S4 bare ack '${t}' must be caught (no-op)`); }
  }
  // praise + a real confirm verb -> must NOT be caught (so it still confirms/acts)
  for (const t of ["Perfect, send it", "Great, do it", "Awesome, log it", "great, also save this link", "Perfect send the email", "Great work, now draft the report"]) {
    if (caught(t)) { fail(`S4 praise+verb '${t}' must NOT be caught (must still act)`); }
  }
  // real confirmations / requests -> must NOT be caught
  for (const t of ["yes", "send it", "go ahead", "can you send emails?", "draft an email to x@y.com", "log it"]) {
    if (caught(t)) { fail(`S4 '${t}' must NOT be caught`); }
  }
  if (!process.exitCode) ok("S4 bare ack caught; praise+verb, real yes, and requests all pass through");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
