// Canned-template non-sequitur wall (2026-06-24, KT #391). 48h transcript: the line
// "I logged that, but I have not actually messaged them..." (HONEST_NO_SEND) shipped ~15x as a
// non-sequitur — answering "Yo", "Who is them?", "cool sure" (L313/315/284). The model PARROTS
// the guard line as raw output; no guard substituted it (alreadySubstituted=false) and the
// hedge-loop breaker structurally SKIPS guard-marked lines, so nothing caught it.
// Fix: a relevance gate at the finalize seam — a parroted guard line on a NON send/task command
// is replaced with a neutral re-ask. A relevant send-state/task command keeps the honest line;
// a guard-substituted line (alreadySubstituted=true) is never touched.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SA = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "agents", "sasa.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

// ---- R1: the relevance gate exists at the finalize seam, gated correctly ----
{
  const i = SA.indexOf("RELEVANCE GATE (KT #391");
  const region = i >= 0 ? SA.slice(i, i + 1700) : "";
  if (!region) fail("R1 the relevance gate must exist");
  else if (!/if \(!alreadySubstituted && guardOutputMark\(\)\.test\(String\(reply/.test(region))
    fail("R1a must fire only when WE did not substitute (alreadySubstituted=false) AND the reply is a canned guard line");
  else if (!/!SEND_STATE_QUESTION\.test\(String\(opts\.command/.test(region))
    fail("R1b must NOT fire on a send-state question (the canned line is a relevant answer there)");
  else if (!/!\/\\b\(\?:messag\|text\|sen\[dt\]\|tell/.test(region))
    fail("R1c must NOT fire when the command is a send/task request");
  else if (!/reply = humanize\(HONEST_NO_ACTION_REASK/.test(region))
    fail("R1d must replace the non-sequitur with the neutral re-ask");
  else if (!/alreadySubstituted = true;/.test(region))
    fail("R1e must mark substituted so later guards do not re-touch it");
  else if (!/sasa\.canned_nonsequitur_replaced/.test(region))
    fail("R1f must emit an observable event");
  else ok("R1 relevance gate: parroted canned line on a non-send command → neutral re-ask");
}

// ---- R2: behavioural mirror of the gate decision ----
{
  // mirror the exact gate predicate
  const HONEST_NO_SEND_PREFIX = "I logged that, but I have not actually messaged them";
  const SEND_STATE_QUESTION = (() => { const m = SA.match(/const SEND_STATE_QUESTION = (\/.*\/i);/); return m ? eval(m[1]) : /$^/; })();
  const SEND_TASK = /\b(?:messag|text|sen[dt]|tell|told|notif|relay|post|email|remind|follow ?up|assign|task|draft|flag)\b/i;
  // marker: a reply that starts with the canned guard line
  const isCanned = (reply) => reply.startsWith(HONEST_NO_SEND_PREFIX);
  const fires = (command, reply, alreadySubstituted) =>
    !alreadySubstituted && isCanned(reply)
    && !SEND_STATE_QUESTION.test(command) && !SEND_TASK.test(command);
  const canned = "I logged that, but I have not actually messaged them. It is on their board and will show in their daily brief. Want me to message them directly now so they see it?";

  // the transcript non-sequiturs → gate FIRES (replace)
  eq(fires("Yo", canned, false), true, "R2a 'Yo' + parroted canned line → fires (replace with re-ask)");
  eq(fires("Who is them?", canned, false), true, "R2b 'Who is them?' + parroted canned line → fires");
  eq(fires("cool sure", canned, false), true, "R2c 'cool sure' + parroted canned line → fires");
  // a RELEVANT send-state question → gate must NOT fire (the honest line is the right answer)
  eq(fires("did you text Mark today?", canned, false), false, "R2d a send-state question keeps the honest line (no fire)");
  // a send/task command → no fire (the offer-to-message is relevant)
  eq(fires("remind Malek to send the proposal", canned, false), false, "R2e a task/send command keeps the line");
  // a guard ALREADY substituted it → never re-touched
  eq(fires("Yo", canned, true), false, "R2f a guard-substituted canned line is never replaced (alreadySubstituted=true)");
  // a NORMAL (non-canned) reply on an unrelated command → untouched
  eq(fires("Yo", "Hey, what do you need?", false), false, "R2g a normal reply is never replaced");

  function eq(a, b, m) { if (a !== b) fail(`${m} (got ${a})`); else ok(m); }
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
