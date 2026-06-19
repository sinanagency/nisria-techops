// Unverified-send-state wall (2026-06-20, KT #313). Pins the fix for #8: Sasa
// asserting what it did/didn't send to a person WITHOUT calling a verified
// lookup, producing a confident fabrication.
//
// Live repro (2026-06-19, 23:53 Dubai, owner DM):
//   YOU:  "what did u send to nur?"
//   SASA: "Nothing went out to Nur in the last 24 hours. I haven't sent her anything."
//   ...but it HAD sent "Sasa is back online!" to Nur, who replied "Welcome back!".
//   The model called NO tool that turn; it answered from its per-contact window
//   (the owner's thread), which never saw the message sent in Nur's thread.
//
// Root cause: the model asserted a send-state with no verifying tool run this
// turn. The verified lookups ALREADY EXIST (read_contact_thread reads a named
// person's thread incl. outbound; show_outbound_audit is the ground-truth send
// receipt). The fix is enforcement, not a new tool: a guard that blocks a
// send-state claim with no verify-lookup this turn, plus a prompt rule.
//
// Seams pinned here:
//   S1  VERIFY_TOOLS set in sasa.ts naming the real lookups (read_contact_thread,
//       show_outbound_audit, search_history).
//   S2  Guard checks toolRuns against VERIFY_TOOLS.
//   S3  SEND_STATE_CLAIM regex exists in sasa.ts.
//   S4  Guard claimsUnverifiedSendState exists.
//   S5  Wired into finalize() AFTER claimsSendWithoutSend (positives handled
//       there; this catches the negative-fabrication residue).
//   S6  Emits sasa.unverified_send_state event.
//   S7  Prompt carries a look-it-up-first qualifier (call read_contact_thread /
//       show_outbound_audit before claiming what was sent).
//
// Behavioral repros (run the extracted regex against real strings):
//   B1  "Nothing went out to Nur in the last 24 hours." -> SEND_STATE_CLAIM hits
//   B2  "I haven't sent her anything."                   -> hits
//   B3  "I sent the report to Mark."                      -> hits
//   B4  "What would you like me to tell Nur?"             -> does NOT hit
//
// Pure local. No DB, no network, no Anthropic.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const SASA = fs.readFileSync(path.join(ROOT, "lib", "agents", "sasa.ts"), "utf8");

const fail = (msg) => { console.error("FAIL:", msg); process.exitCode = 1; };
const ok = (msg) => console.log("PASS:", msg);

// ---- S1: VERIFY_TOOLS set naming the real lookups ----
{
  const m = SASA.match(/const\s+VERIFY_TOOLS\s*=\s*new\s+Set\(\[([\s\S]*?)\]\)/);
  if (!m) fail("S1 VERIFY_TOOLS set declared");
  else {
    const body = m[1];
    const need = ["read_contact_thread", "show_outbound_audit", "search_history"];
    const missing = need.filter((t) => !body.includes(t));
    if (missing.length) fail(`S1 VERIFY_TOOLS missing: ${missing.join(",")}`);
    else ok("S1 VERIFY_TOOLS names read_contact_thread, show_outbound_audit, search_history");
  }
}

// ---- S2: guard checks toolRuns against VERIFY_TOOLS ----
if (!/VERIFY_TOOLS\.has\(/.test(SASA)) fail("S2 guard checks VERIFY_TOOLS.has(...)");
else ok("S2 guard consults VERIFY_TOOLS");

// ---- S3: SEND_STATE_CLAIM regex ----
const reMatch = SASA.match(/const\s+SEND_STATE_CLAIM\s*=\s*(\/[^\n]+?\/[gimsuyx]*)/);
if (!reMatch) fail("S3 SEND_STATE_CLAIM regex declared at module scope");
else ok("S3 SEND_STATE_CLAIM declared");

// ---- S4: guard function ----
if (!/function\s+claimsUnverifiedSendState\s*\(/.test(SASA)) fail("S4 claimsUnverifiedSendState function exists");
else ok("S4 claimsUnverifiedSendState declared");

// ---- S5: wired AFTER claimsSendWithoutSend in source order ----
{
  const sendIdx = SASA.indexOf("claimsSendWithoutSend(reply, toolRuns)");
  const callIdx = SASA.search(/claimsUnverifiedSendState\(reply,\s*toolRuns/);
  if (callIdx < 0) fail("S5 claimsUnverifiedSendState wired into the chain (called)");
  else if (sendIdx < 0) fail("S5 claimsSendWithoutSend still in chain");
  else if (!(sendIdx < callIdx)) fail("S5 claimsUnverifiedSendState must come AFTER claimsSendWithoutSend");
  else ok("S5 claimsUnverifiedSendState fires after claimsSendWithoutSend");
}

// ---- S6: event emitted ----
if (!/sasa\.unverified_send_state/.test(SASA)) fail("S6 emits sasa.unverified_send_state event");
else ok("S6 emits sasa.unverified_send_state event");

// ---- S7: prompt carries a look-it-up-first qualifier ----
if (!/read_contact_thread|show_outbound_audit/.test(SASA)) fail("S7 prompt must point to read_contact_thread / show_outbound_audit before claiming a send");
else ok("S7 prompt references the verified send-lookup tools");

// ---- Behavioral repros ----
if (reMatch) {
  // eslint-disable-next-line no-eval
  const SEND_STATE_CLAIM = eval(reMatch[1]);
  const hit = (s) => SEND_STATE_CLAIM.test(s);
  if (!hit("Nothing went out to Nur in the last 24 hours.")) fail("B1 'Nothing went out to Nur...' must match");
  else ok("B1 negative send-state claim matched");
  if (!hit("I haven't sent her anything.")) fail("B2 'I haven't sent her anything' must match");
  else ok("B2 negative send-state claim matched");
  if (!hit("I sent the report to Mark.")) fail("B3 'I sent the report to Mark' must match");
  else ok("B3 positive send-state claim matched");
  if (hit("What would you like me to tell Nur?")) fail("B4 a question must NOT match");
  else ok("B4 question correctly not matched");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
