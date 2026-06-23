// WhatsApp transport wall (2026-06-20). Three confirmed transport bugs in
// lib/whatsapp.ts that all share one failure family: an outbound that LIES
// about delivery. Mirror fires on a send that never landed; a proactive push
// outside the 24h window vanishes with no event; a leading-zero local number
// normalizes to a malformed "+0..." E.164 that defeats phoneKey dedup.
//
// Seams:
//   A1  send() primitive: owner-mirror is dispatched AFTER the fetch resolves
//       with a real message id, NOT fire-and-forget before the fetch.
//   A2  send() owner_mirror event records primary_ok (so a failed primary is
//       observable, never recorded as a clean mirror).
//   A3  sendTemplateAndLog: template owner-mirror gated on res.id (only mirror
//       a template that actually got a message id back).
//   B1  send() (or sendText path) emits sasa.send_dropped_outside_window when a
//       free-form send fails the re-engagement / out-of-window error class.
//   B2  out-of-window handling keys off the Meta error class (131026 / 470 /
//       re-engagement / outside the 24), and consults WHATSAPP_REENGAGE_TEMPLATE.
//   C1  toE164 rejects a leading-zero digit string (no "+0..." E.164).
//
// Pure local — reads the .ts source as a string and asserts on seams.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const WA = fs.readFileSync(path.join(ROOT, "lib", "whatsapp.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

// Isolate the send() primitive body for ordering checks.
const sendStart = WA.indexOf("async function send(");
const sendEnd = WA.indexOf("export async function sendText(");
const SEND = sendStart >= 0 && sendEnd > sendStart ? WA.slice(sendStart, sendEnd) : "";

// ---- A1: mirror dispatched AFTER the fetch resolves with a real id ----
// The bug: the mirror's `send({ to: _own ... })` call sat BEFORE the
// `await fetch(...)` line. We require the fetch (and a resolved id) to come
// before the mirror dispatch in source order.
{
  if (!SEND) fail("A1 could not isolate send() primitive");
  else {
    const fetchIdx = SEND.indexOf("await fetch(");
    // The mirror's recursive send to the owner — uniquely identified by the
    // "[Sasa → " label it builds.
    const mirrorIdx = SEND.indexOf("[Sasa → ");
    if (fetchIdx < 0) fail("A1 no fetch in send()");
    else if (mirrorIdx < 0) fail("A1 owner-mirror dispatch not found in send()");
    else if (mirrorIdx < fetchIdx) fail("A1 owner-mirror dispatched BEFORE the fetch (fires on unsent message)");
    else ok("A1 owner-mirror dispatched after the fetch resolves");
  }
}

// ---- A2: owner_mirror event records primary_ok ----
{
  if (!/sasa\.owner_mirror/.test(SEND)) fail("A2 owner_mirror event missing from send()");
  else if (!/primary_ok/.test(SEND)) fail("A2 owner_mirror event must record primary_ok (whether the primary send landed)");
  else ok("A2 owner_mirror event records primary_ok");
}

// ---- A3: template owner-mirror gated on res.id ----
// Scope to the mirror's own `if` condition, not the `status` line below it.
// The mirror fires only when the template returned a real message id, so the
// gate condition must mention res.id alongside the recipient check.
{
  const i = WA.indexOf("Mirror template outbound to the owner");
  const block = i >= 0 ? WA.slice(i, i + 700) : "";
  if (i < 0) fail("A3 template owner-mirror block not found");
  else {
    // Find the `if (...) {` that wraps the mirror sendText("[Sasa template ...").
    const labelIdx = block.indexOf("[Sasa template");
    const guardWindow = labelIdx >= 0 ? block.slice(0, labelIdx) : block;
    // The nearest enclosing if-condition (everything up to the mirror call)
    // must reference res.id.
    if (!/res\.id/.test(guardWindow)) fail("A3 template owner-mirror must be gated on res.id (only mirror a sent template)");
    else ok("A3 template owner-mirror gated on res.id");
  }
}

// ---- B1: out-of-window free-form failure emits an observable event ----
{
  if (!/sasa\.send_dropped_outside_window/.test(WA)) fail("B1 out-of-window send must emit sasa.send_dropped_outside_window (not vanish)");
  else ok("B1 out-of-window send emits sasa.send_dropped_outside_window");
}

// ---- B2: keys off the Meta re-engagement error class + reengage template ----
// Scope to the send() primitive so we don't match the doc comments at the top
// of the file ("outside the 24h window"). The detector must live in code.
{
  const hasErrClass = /131026|re-?engagement|\b470\b/.test(SEND);
  if (!hasErrClass) fail("B2 out-of-window detection must key off the Meta error class (131026 / 470 / re-engagement)");
  else ok("B2 out-of-window detection keys off the Meta error class");
  if (!/WHATSAPP_REENGAGE_TEMPLATE/.test(WA)) fail("B2 must consult process.env.WHATSAPP_REENGAGE_TEMPLATE for the fallback");
  else ok("B2 consults WHATSAPP_REENGAGE_TEMPLATE");
}

// ---- C1: toE164 rejects a leading-zero digit string ----
{
  const i = WA.indexOf("export function toE164(");
  const block = i >= 0 ? WA.slice(i, i + 800) : "";
  if (i < 0) fail("C1 toE164 not found");
  // The old body was a single ternary on /^\d{10,13}$/ with no leading-zero
  // guard. Require an explicit rejection of a leading 0 before the "+" prepend.
  // The validating regex must demand a non-zero first digit, e.g. /^[1-9]\d{9,12}$/,
  // OR there must be an explicit startsWith("0") / d[0]==="0" rejection.
  // (Must NOT be satisfied by the unrelated .replace(/^00/, "") strip.)
  else if (!/\[1-9\]\\d|\.startsWith\(["']0["']\)|d\[0\]\s*===\s*["']0["']/.test(block)) {
    fail("C1 toE164 must reject a leading-zero digit string (no +0... E.164)");
  } else ok("C1 toE164 rejects leading-zero numbers");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
