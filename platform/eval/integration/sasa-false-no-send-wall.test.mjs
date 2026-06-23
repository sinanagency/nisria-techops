// False-no-send wall (Nur 2026-06-22, KT #206547 follow-up). Pins the fix for the bug
// where Sasa SENT to Mark+Cynthia and then told Nur "I have not actually messaged
// them" (a false DENIAL the false-CLAIM guard can't see), whose trailing offer staged
// a send that "yes" double-fired.
//
// Source-seam asserts the wiring in lib/agents/sasa.ts; behavioural half mirrors the
// DENIES_SEND regex + sentRecipientNames + the offer-stage gate.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SA = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "agents", "sasa.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);
const eq = (a, b, m) => (a === b ? ok(m) : fail(`${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`));

// ---- F1: the false-denial guard exists and is wired BEFORE claimsSendWithoutSend ----
{
  if (!/function deniesSendThatHappened\(/.test(SA)) fail("F1a deniesSendThatHappened detector must exist");
  if (!/function sentRecipientNames\(/.test(SA)) fail("F1b sentRecipientNames helper must exist");
  const di = SA.indexOf("} else if (deniesSendThatHappened(reply, toolRuns)) {");
  const ci = SA.indexOf("} else if (claimsSendWithoutSend(reply, toolRuns)) {");
  if (di < 0) fail("F1c deniesSendThatHappened must be wired into the finalize chain");
  else if (ci < 0 || di > ci) fail("F1d the false-denial branch must come BEFORE the false-claim branch");
  else ok("F1 false-denial guard exists and is wired ahead of the false-claim guard");
  if (!/reply = humanize\(`Sent to \$\{joinNames\(sent\)\}\.\$\{kept\.length/.test(SA)) fail("F1e it must rewrite to the truthful 'Sent to <names>.' surgically (keeping honest clauses)");
  if (!/sasa\.false_no_send_corrected/.test(SA)) fail("F1f it must emit an observable event");
}

// ---- F2: only ACTUALLY-delivered sends count (never claim 'Sent' for a held one) ----
{
  if (!/\(t\?\.result as any\)\?\.detail\?\.delivered !== true\) continue;/.test(SA)) fail("F2a sentRecipientNames must require detail.delivered===true");
  else ok("F2 sentRecipientNames counts only delivered sends (a held/queued send is not a delivery)");
}

// ---- F3: the offer-stager must NOT stage a re-send when one already landed this turn ----
{
  if (!/&& !deliveredThisTurn\(toolRuns\)\s*\/\/ never stage a re-send/.test(SA)) fail("F3 the honest-offer stager must be gated on !deliveredThisTurn (stops the 11:09 double-send)");
  else ok("F3 offer-stager refuses to stage a re-send after a send already delivered this turn");
}

// ---- F4: behavioural mirror — DENIES_SEND + deniesSendThatHappened + joinNames ----
{
  const DENIES_SEND = /\b(?:have\s*n['’]?t|has\s*n['’]?t|have\s+not|has\s+not|not\s+yet|did\s*n['’]?t|did\s+not)\s+(?:actually\s+|yet\s+|really\s+|ever\s+)?(?:messaged?|sent|told|texted|notified|reached\s+out|pinged)\s+(?:them|him|her|it|that|anyone|anybody)\b/i;
  const SEND_TOOLS = new Set(["message_person", "post_to_group", "send_file_to_person", "transfer_drive_file"]);
  const sentRecipientNames = (runs) => {
    const out = [];
    for (const t of runs || []) {
      if (!SEND_TOOLS.has(t.name)) continue;
      if (t?.result?.ok !== true) continue;
      if (t?.result?.detail?.delivered !== true) continue;
      const to = t?.result?.detail?.to;
      if (to && !out.includes(String(to))) out.push(String(to));
    }
    return out;
  };
  const SEND_CLAIM = /\b(?:sent\s+(?:it|them|the\s+(?:task|message|reminder|note))?\s*(?:to|him|her|them)|i'?ve\s+sent|i\s+have\s+sent|message\s+sent|messaged|texted|pinged|notified|told\s+(?:him|her|them|\w+)|let\s+(?:him|her|them|\w+)\s+know|reached\s+out\s+to|posted\s+(?:it\s+)?(?:to|in)\b)/i;
  const SEND_HAS = /\b(?:he|she|they)\s+(?:now\s+)?(?:has|have)\s+(?:it|them)\b|\b\w+\s+(?:has|have|received|got)\s+(?:the\s+(?:task|message|reminder|note)|it now)\b/i;
  const SEND_NEG = /\b(?:have\s*n['’]?t|has\s*n['’]?t|have\s+not|has\s+not|not\s+yet|did\s*n['’]?t|did\s+not|won['’]?t|will\s+not|not)\b/i;
  const deniesSendThatHappened = (reply, runs) => {
    const r = String(reply || "");
    if (!DENIES_SEND.test(r)) return false;
    if (sentRecipientNames(runs).length === 0) return false;
    const clauses = r.split(/(?<=[.!?;:])\s+|,\s+|\s+\b(?:but|and|however|though)\b\s+/i);
    const hasAffirmative = clauses.some((s) => (SEND_CLAIM.test(s) || SEND_HAS.test(s)) && !DENIES_SEND.test(s) && !SEND_NEG.test(s));
    return !hasAffirmative;
  };
  const joinNames = (n) => n.length <= 1 ? (n[0] || "them") : n.length === 2 ? `${n[0]} and ${n[1]}` : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;

  // the EXACT screenshot line, with two real delivered sends → corrected
  const runs = [
    { name: "message_person", result: { ok: true, detail: { delivered: true, to: "Mark" } } },
    { name: "message_person", result: { ok: true, detail: { delivered: true, to: "Cynthia" } } },
  ];
  eq(DENIES_SEND.test("I logged that, but I have not actually messaged them. It is on their board."), true, "F4a the literal false-denial line is detected");
  eq(deniesSendThatHappened("I have not actually messaged them. Want me to message them now?", runs), true, "F4b denial + two delivered sends → fires");
  eq(joinNames(sentRecipientNames(runs)), "Mark and Cynthia", "F4c rewrites to 'Mark and Cynthia'");
  // honest denial when NOTHING was sent → must NOT fire (don't fabricate a send)
  eq(deniesSendThatHappened("I have not messaged them yet, it's only on their board.", []), false, "F4d denial with no send is honest → not corrected");
  // a HELD send (delivered:false) is not a delivery → denial stays honest
  eq(deniesSendThatHappened("I have not messaged them.", [{ name: "message_person", result: { ok: true, detail: { delivered: false, queued: true, to: "Mark" } } }]), false, "F4e a held/queued send is not a delivery");
  // a genuine future offer is not a denial → not fired (no clobber of normal flow)
  eq(DENIES_SEND.test("Want me to message them now?"), false, "F4f a plain offer is not a denial");
  eq(DENIES_SEND.test("I'll message them after lunch."), false, "F4g a future-tense plan is not a denial");
  // skeptic must-fix: a MIXED reply that affirmatively acknowledges a send must NOT fire
  eq(deniesSendThatHappened("I messaged Mark, but haven't messaged her about the budget yet.", runs), false, "F4h a mixed reply (affirmative + denial) is left untouched (no clobber)");
  eq(deniesSendThatHappened("I notified Mark; not yet messaged her.", runs), false, "F4i a SEMICOLON-joined mixed reply is left untouched (no clobber)");

  // ---- F5: surgical rewrite keeps honest clauses, drops only denial + offer ----
  const surgical = (reply, sent) => {
    const SEND_OFFER = /\b(?:want me to|shall i|should i|do you want me to|would you like me to|want me to go ahead and|i can|let me)\b[^.?!]{0,45}?\b(?:message|text|tell|notify|remind|ping|let\s+(?:him|her|them|\w+)\s+know|reach\s+out\s+to|drop\s+(?:him|her|them)\s+a|send\s+(?:it|them|him|her|a\s+(?:message|text|note|reminder|heads.?up))\s+to)\b/i;
    const kept = String(reply || "").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s && !DENIES_SEND.test(s) && !SEND_OFFER.test(s));
    return `Sent to ${joinNames(sent)}.${kept.length ? " " + kept.join(" ") : ""}`;
  };
  eq(surgical("I logged that, but I have not actually messaged them. It is on their board and will show in their daily brief. Want me to message them directly now so they see it?", ["Mark", "Cynthia"]),
     "Sent to Mark and Cynthia. It is on their board and will show in their daily brief.",
     "F5 surgical: drops the false denial + the offer, keeps the true 'on their board' clause, prepends the truth");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
