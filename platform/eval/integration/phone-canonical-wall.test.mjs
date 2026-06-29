// Phone-canonical / Mark-duplicate wall (2026-06-22). Pins the fix for the failure
// where the bot (a) split one person into two contact records because their number
// was stored in different formats, (b) held a genuine resend as a "duplicate", and
// (c) looped the same "which Mark?" question.
//
// Behavioural half imports the EXACT module the app runs (lib/phone.mjs) — zero
// drift (agent-clock pattern). Source-seam half asserts the wiring in smart-tools.ts
// / whatsapp.ts / sasa.ts.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sameNumber, digitsKey, isLocalForm, distinctLines, suffixKey } from "../../lib/phone.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ST = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "smart-tools.ts"), "utf8");
const WA = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "whatsapp.ts"), "utf8");
const SA = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "agents", "sasa.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);
const eq = (a, b, m) => (a === b ? ok(m) : fail(`${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`));

// ---- P1: the operator's exact example — +971 / 00971 / local 0 all one line ----
{
  eq(sameNumber("+971501168462", "00971501168462"), true, "P1a +971 ≡ 00971 (international + vs 00)");
  eq(sameNumber("+971501168462", "0501168462"), true, "P1b +971501168462 ≡ local 0501168462");
  eq(sameNumber("00971501168462", "0501168462"), true, "P1c 00971501168462 ≡ local 0501168462");
  eq(digitsKey("+971501168462"), digitsKey("00971501168462"), "P1d digitsKey collapses + and 00");
}

// ---- P2: Mark Njambi — +254 international ≡ 0703.. local ----
{
  eq(sameNumber("0703119486", "+254703119486"), true, "P2a Mark local 0703.. ≡ +254703119486");
  eq(isLocalForm("0703119486"), true, "P2b 0703119486 is a local form");
  eq(isLocalForm("00254703119486"), false, "P2c 00254.. is NOT local (international 00-prefix)");
}

// ---- P3: NEVER over-merge — different people must stay distinct ----
{
  // same last-4 (8462) but genuinely different numbers/countries → NOT the same line
  eq(sameNumber("+254700008462", "+971500008462"), false, "P3a same last-4 across countries is NOT a match (no false dedup)");
  eq(sameNumber("0703119486", "0703119487"), false, "P3b two different local numbers are not the same");
  // a SHORT tail must not match (national part < 7 digits)
  eq(sameNumber("0123456", "999123456"), false, "P3c short ambiguous tails never match");
  eq(sameNumber("", "+971501168462"), false, "P3d empty never matches");
}

// ---- P3b: known-country-code gating kills cross-country tail collisions (skeptic A) ----
{
  // WITHOUT a cc allowlist, a Kenyan local would match a +1/+11 sharing the tail.
  eq(sameNumber("0703119486", "+11703119486"), true, "P3b-bare ungated: local matches any 1-3 digit cc (back-compat)");
  // WITH the org allowlist (Kenya/UAE only), that cross-country match is REFUSED…
  eq(sameNumber("0703119486", "+11703119486", ["254", "971"]), false, "P3b-gated: +11 collision refused when org CCs are 254/971");
  // …but the REAL Kenyan international form still matches under the same allowlist.
  eq(sameNumber("0703119486", "+254703119486", ["254", "971"]), true, "P3b-gated: the genuine +254 match still holds");
  eq(sameNumber("0501168462", "+971501168462", ["254", "971"]), true, "P3b-gated: the operator's +971 example still holds");
}

// ---- P3c: suffixKey is format-stable (the SQL pre-filter that avoids full scans) ----
{
  eq(suffixKey("+254703119486"), suffixKey("0703119486"), "P3c suffixKey is identical across formats of one line");
  eq(suffixKey("00971501168462"), suffixKey("0501168462"), "P3c suffixKey collapses +971/00971/local");
}

// ---- P4: distinctLines collapses format variants, prefers international ----
{
  const rows = [{ phone: "0703119486", name: "Mark B" }, { phone: "+254703119486", name: "Mark A" }];
  const d = distinctLines(rows);
  eq(d.length, 1, "P4a two format-variants of one line collapse to ONE");
  eq(digitsKey(d[0].phone), "254703119486", "P4b the international form is kept as canonical");
  const two = distinctLines([{ phone: "+254703119486" }, { phone: "+971501168462" }]);
  eq(two.length, 2, "P4c two genuinely different lines stay separate");
}

// ---- P5: send-dedup honours an explicit operator resend ----
{
  if (!/const resend = input\.resend === true/.test(ST)) fail("P5a message_person must read input.resend");
  if (!/if \(!resend\) \{[\s\S]{0,1200}?fuzzyDupe/.test(ST)) fail("P5b the exact+fuzzy dedup must be SKIPPED when resend is set");
  if (!/resend \? `\$\{toHash\}:\$\{textHash\}:\$\{minuteBucket\}:resend:\$\{claimId\}`/.test(ST)) fail("P5c the atomic claim key must be resend-unique so a genuine retry always wins (H2: keyed on the full-number hash)");
  if (!/resend:\s*\{ type: "boolean"/.test(ST)) fail("P5d resend must be in the message_person tool schema");
  // skeptic C: resend must keep a backstop (one retry, then hold identical inside 2m)
  else if (!/if \(resend\) \{[\s\S]{0,700}?alreadyResent[\s\S]{0,600}?resend_capped/.test(ST)) fail("P5e resend must have a backstop (cap an identical resend inside 2 min)");
  else ok("P5 send-dedup: resend bypasses dedup but a 2-min identical-resend backstop remains");
}

// ---- P6: contact resolution + storage use canonical matching ----
{
  if (!ST.includes('import { sameNumber, distinctLines, isLocalForm, suffixKey } from "./phone.mjs";')) fail("P6a smart-tools must import the canonicalizer");
  if (!/const uniq = distinctLines\(matches, orgCCs\(\)\);/.test(ST)) fail("P6b message_person name-resolution must collapse format-variants via distinctLines");
  if (!/A bare LOCAL number[\s\S]{0,1400}?sameNumber\(toRaw/.test(ST)) fail("P6c a bare local number must resolve against the contact base by sameNumber");
  if (!/before creating a new row[\s\S]{0,700}?sameNumber\(phone/i.test(ST)) fail("P6d add_contact must dedup by sameNumber before inserting");
  if (!/sameNumber\(digits, String\(c\.phone[\s\S]{0,40}?ccs\)/.test(WA)) fail("P6e resolveContact must use a knownCC-gated sameNumber scan");
  // skeptic D: every contacts scan must be suffix-PRE-FILTERED, never a full .limit(2000) load
  if (/contacts"\)\.select\([^)]*\)\.not\("phone", "is", null\)\.limit\(2000\)/.test(ST)) fail("P6f no full-table contacts scan may remain (suffix pre-filter required)");
  if (!/ilike\("phone", `%\$\{suffixKey\(/.test(ST)) fail("P6g contacts scans must pre-filter by suffixKey ilike");
  // skeptic G: add_contact must NOT claim an update when nothing was written
  if (!/did not add a duplicate\. Nothing to change/.test(ST)) fail("P6h add_contact must be honest when the dupe needed no change (no false 'updated')");
  else ok("P6 resolution+storage: cc-gated, suffix-prefiltered, honest dedup (no full scans, no false claims)");
}

// ---- P7: merge_contact tool exists and repoints the thread ----
{
  if (!/name: "merge_contact"/.test(ST)) fail("P7a merge_contact tool schema must exist");
  if (!/if \(name === "merge_contact"\)/.test(ST)) fail("P7b merge_contact handler must exist");
  if (!/repoint\("messages", "contact_id"\)/.test(ST)) fail("P7c merge must repoint messages.contact_id");
  // skeptic E: the FK is approvals.related_contact_id, NOT tasks (which has no contact col)
  if (!/repoint\("approvals", "related_contact_id"\)/.test(ST)) fail("P7d merge must repoint approvals.related_contact_id (the REAL table)");
  if (!/repoint\("pending_actions", "contact_id"\)/.test(ST)) fail("P7e2 merge must repoint pending_actions.contact_id (the confirm/payment queue)");
  if (!/repoint\("pending_intents", "requester_contact_id"\)/.test(ST)) fail("P7e merge must repoint pending_intents.requester_contact_id");
  if (!/code === "42P01"\) return null;/.test(ST)) fail("P7e3 a missing deferred table (42P01) must fail-open, not block all merges");
  if (/from\("tasks"\)\.update\(\{ related_contact_id/.test(ST)) fail("P7f merge must NOT touch tasks.related_contact_id (column does not exist)");
  // a hard repoint failure must ABORT the delete (no orphans, no silent swallow)
  if (!/if \(errs\.length\) return \{ ok: false, error: `did not delete/.test(ST)) fail("P7g a failed repoint must abort the delete and report honestly");
  if (!/from\("contacts"\)\.delete\(\)\.eq\("id", dup\.id\)/.test(ST)) fail("P7h merge must remove the duplicate row after repoints succeed");
  else ok("P7 merge_contact: repoints messages+approvals+pending_intents, aborts delete on error, no orphans");
}

// ---- P8: the question-loop breaker (the 'which Mark?' twice loop) ----
{
  if (!/function repeatsLastQuestion\(/.test(SA)) fail("P8a repeatsLastQuestion detector must exist");
  if (!/!alreadySubstituted &&[\s\S]{0,160}?repeatsLastQuestion\(reply, opts\.history\)/.test(SA)) fail("P8b it must be wired into the finalize chain");
  if (!/sasa\.question_loop_break/.test(SA)) fail("P8c it must emit an observable event");
  // skeptic F: must only fire when the operator's last turn did NOT advance the question
  if (!/function _nonSubstantive\(/.test(SA)) fail("P8f a non-substantive gate must exist");
  if (!/const lastUser = \[\.\.\.history\]\.reverse\(\)\.find\(\(m\) => m\.role === "user"\);[\s\S]{0,120}?_nonSubstantive\(lastUser\.content\)/.test(SA)) fail("P8g loop-break must require the last user turn to be non-substantive (no clobbering a real second confirm)");
  // behavioural mirror of the detector's similarity test
  const qtok = (s) => new Set(String(s).toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter((w) => w.length >= 3));
  const jac = (x, y) => { const a = qtok(x), b = qtok(y); if (!a.size || !b.size) return 0; let i = 0; for (const w of a) if (b.has(w)) i++; return i / (a.size + b.size - i); };
  const q1 = "There are two records for Mark Njambi in the system. Can you confirm his number or which Mark this is, so I send to the right one?";
  const q2 = "There are two records for Mark Njambi in the system. Can you confirm his number or tell me which one to send to?";
  if (jac(q1, q2) < 0.6) fail("P8d the two real 'which Mark?' turns must score as a repeat (>=0.6)");
  const distinct = "What is Mark's phone number?";
  if (jac(q1, distinct) >= 0.6) fail("P8e a genuinely different question must NOT trip the loop-break");
  else ok("P8 loop-break: a near-verbatim re-asked question trips; a distinct question does not");
}

// ---- P10: deterministic resend route + send_file migration + loop-break gate (panel 2) ----
{
  // C: resend must also fire from a DETERMINISTIC ctx.forceResend, not only the model flag
  if (!/const resend = input\.resend === true \|\| ctx\.forceResend === true;/.test(ST)) fail("P10a resend must honour a deterministic ctx.forceResend (not model-only)");
  if (!/forceResend\?: boolean/.test(ST)) fail("P10b forceResend must be on the smart-tool ctx type");
  if (!/forceResend: WANTS_RESEND\.test\(String\(opts\.command/.test(SA)) fail("P10c the worker must set forceResend from the operator's words");
  if (!/const WANTS_RESEND = /.test(SA)) fail("P10d the WANTS_RESEND intent regex must exist");
  // behavioural mirror of the resend-intent regex
  const WANTS_RESEND = /\b(?:did(?:n'?t| ?not)|have ?n'?t|have not|has ?n'?t|has not|never)\b[^.?!]{0,24}\b(?:receiv\w*|get|got|gotten|arriv\w*)\b|\b(?:re-?send|resend|send (?:it |that |this )?again|send again)\b/i;
  if (!WANTS_RESEND.test("He didn't receive it")) fail("P10e 'He didn't receive it' must be a resend intent");
  if (!WANTS_RESEND.test("send it again please")) fail("P10f 'send it again' must be a resend intent");
  if (!WANTS_RESEND.test("can you resend that")) fail("P10g 'resend' must be a resend intent");
  if (WANTS_RESEND.test("send the STP report to Mark")) fail("P10h a normal send must NOT be a resend intent (no false bypass)");
  if (!WANTS_RESEND.test("he has not received it yet")) fail("P10i spelled-out 'has not received' must be a resend intent (loop optimisation)");
  // B: send_file_to_person got the same canonical resolution as message_person
  if (!/a bare local number resolves to its canonical/i.test(ST)) fail("P10i send_file_to_person must resolve a bare local number");
  if (!/const uniq = distinctLines\(matches, orgCCs\(\)\);[\s\S]{0,3000}?find the filed document/.test(ST)) fail("P10j send_file_to_person must collapse format-variants via distinctLines");
  // A: the loop-break must NOT fire when a real action landed this turn
  if (!/!deliveredThisTurn\(toolRuns\) && !subscribedThisTurn\(toolRuns\) && repeatsLastQuestion/.test(SA)) fail("P10k loop-break must be exempted when a send/subscription landed this turn");
  else ok("P10 deterministic resend route + send_file migration + delivered-gated loop-break");
}

// ---- P9: hardening — non-ASCII digits + the 9-digit national floor (panel) ----
{
  // Arabic-Indic numerals must NOT erase to empty (they did under bare \d → silent dup).
  eq(digitsKey("+٩٧١٥٠١١٦٨٤٦٢"), "971501168462", "P9a Arabic-Indic digits fold to ASCII (not erased)");
  eq(sameNumber("+٩٧١٥٠١١٦٨٤٦٢", "+971501168462"), true, "P9b an Arabic-numeral number matches its ASCII twin");
  // an extension must not fold into the number
  eq(digitsKey("+971501168462x123"), "971501168462", "P9c an x-extension is stripped, not folded in");
  // floor is 9: an 8-digit national must NOT local↔intl match (kills short-tail collisions)
  eq(sameNumber("012345678", "+25412345678"), false, "P9d an 8-digit national is below the floor (no match)");
  eq(sameNumber("0703119486", "+254703119486"), true, "P9e a real 9-digit national still matches");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
