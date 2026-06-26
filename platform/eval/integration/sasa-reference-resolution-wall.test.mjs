#!/usr/bin/env node
// Sasa REFERENCE-RESOLUTION WALL — spec 006, 2026-06-26.
//
// Resolves a typed pronoun follow-up ("move it", "delete it", "actually 3pm")
// to the LAST single record this DM thread acted on, reusing the existing
// swipeAnchor hard-wall path as an INFERRED anchor. Three seams plus the
// behavioural mirror of the follow-up detector and the capture/ambiguity rule.
//
//  1. CAPTURE (lib/agents/sasa.ts finalize): when EXACTLY ONE distinct task/
//     event record was acted on (ok=true) this turn, emit sasa.referent_set
//     keyed by contact (subject_id = contactId). Zero or 2+ distinct records
//     capture nothing (no safe single referent).
//  2. RESOLVE (app/api/whatsapp/worker/route.ts): when there is NO swipeAnchor
//     and the inbound is a short pronoun/correction follow-up, load the freshest
//     sasa.referent_set for this contact within 30 min and set it as an
//     INFERRED swipeAnchor.
//  3. WALL WORDING (lib/agents/sasa.ts): an inferred anchor produces a SOFTER
//     block (act-or-ask via flag_for_clarity), never the swipe hard wall.
//
// Pure local. No DB hit, no Anthropic spend, no network. Mirror of the source
// so a future edit that loosens any of the three seams fails here.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLATFORM = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => readFileSync(resolve(PLATFORM, rel), "utf8");

const tests = [];
function check(name, fn) { tests.push({ name, fn }); }

// ─── Seam 1: capture in sasa.ts finalize ────────────────────────────────────

check("seam: sasa.ts emits sasa.referent_set on a single-record turn", () => {
  const src = read("lib/agents/sasa.ts");
  if (!/sasa\.referent_set/.test(src)) return "sasa.referent_set event not emitted";
  if (!/REFERENT_TASK_TOOLS/.test(src) || !/REFERENT_EVENT_TOOLS/.test(src)) return "referent tool sets missing";
  return null;
});

check("seam: capture is contact-scoped and DM-only", () => {
  const src = read("lib/agents/sasa.ts");
  const i = src.indexOf("REFERENCE-RESOLUTION CAPTURE");
  if (i < 0) return "capture block not found";
  const block = src.slice(i, i + 2600);
  if (!/opts\.contactId/.test(block)) return "capture not keyed on contactId";
  if (!/!inGroup/.test(block)) return "capture not gated to DM (must skip group surface)";
  if (!/subject_id:\s*opts\.contactId/.test(block)) return "referent event not keyed by contact (subject_id)";
  return null;
});

check("seam: capture only fires when EXACTLY ONE distinct record was touched", () => {
  const src = read("lib/agents/sasa.ts");
  const i = src.indexOf("REFERENCE-RESOLUTION CAPTURE");
  const block = src.slice(i, i + 2600);
  if (!/distinct\.length === 1/.test(block)) return "missing the single-referent guard (distinct.length === 1)";
  // de-dup by type:id so two ok=true calls on the SAME record still count as one
  if (!/new Map\(/.test(block)) return "distinct records not de-duped by type:id";
  return null;
});

check("seam: capture reads ok=true only (a failed tool sets no referent)", () => {
  const src = read("lib/agents/sasa.ts");
  const i = src.indexOf("REFERENCE-RESOLUTION CAPTURE");
  const block = src.slice(i, i + 2600);
  if (!/\.ok === true/.test(block)) return "capture does not filter to ok=true tool runs";
  return null;
});

// ─── Seam 2: resolve in the whatsapp worker ─────────────────────────────────

check("seam: worker loads freshest sasa.referent_set for the contact", () => {
  const src = read("app/api/whatsapp/worker/route.ts");
  const i = src.indexOf("REFERENCE-RESOLUTION RESOLVE");
  if (i < 0) return "resolve block not found in worker";
  const block = src.slice(i, i + 1800);
  if (!/sasa\.referent_set/.test(block)) return "resolve does not query sasa.referent_set";
  if (!/\.eq\("subject_id", contactId\)/.test(block)) return "resolve not scoped to the contact";
  if (!/order\("created_at", \{ ascending: false \}\)/.test(block)) return "resolve does not take the freshest referent";
  return null;
});

check("seam: resolve only runs when there is NO swipe anchor", () => {
  const src = read("app/api/whatsapp/worker/route.ts");
  const i = src.indexOf("REFERENCE-RESOLUTION RESOLVE");
  const block = src.slice(i, i + 1800);
  if (!/if \(!swipeAnchorSubject && contactId\)/.test(block)) return "resolve must defer to an explicit swipe anchor";
  return null;
});

check("seam: resolve enforces a 30-minute staleness gate", () => {
  const src = read("app/api/whatsapp/worker/route.ts");
  const i = src.indexOf("REFERENCE-RESOLUTION RESOLVE");
  const block = src.slice(i, i + 1800);
  if (!/30 \* 60 \* 1000/.test(block)) return "missing 30-min freshness window";
  if (!/\.gte\("created_at", fresh\)/.test(block)) return "freshness window not applied to the query";
  return null;
});

check("seam: resolve marks the anchor inferred and passes it through swipeAnchorOpt", () => {
  const src = read("app/api/whatsapp/worker/route.ts");
  if (!/swipeAnchorInferred = true/.test(src)) return "inferred flag never set";
  if (!/inferred:\s*swipeAnchorInferred/.test(src)) return "inferred flag not threaded into swipeAnchorOpt";
  return null;
});

// ─── Seam 3: inferred anchor uses softer wording ────────────────────────────

check("seam: sasa.ts anchor type carries the inferred flag", () => {
  const src = read("lib/agents/sasa.ts");
  if (!/swipeAnchor\?:\s*\{[^}]*inferred\?: boolean/.test(src)) return "swipeAnchor type missing inferred?: boolean";
  return null;
});

check("seam: inferred anchor is a softer wall (act-or-ask), swipe stays the hard wall", () => {
  const src = read("lib/agents/sasa.ts");
  if (!/if \(a\.inferred\)/.test(src)) return "anchor block does not branch on a.inferred";
  const i = src.indexOf("if (a.inferred)");
  const block = src.slice(i, i + 1200);
  if (!/LIKELY REFERENT/.test(block)) return "inferred wording marker missing";
  if (!/flag_for_clarity/.test(block)) return "inferred block must route ambiguity to flag_for_clarity";
  // the hard-wall swipe wording must remain for the non-inferred branch
  if (!/SWIPE-REPLY ANCHOR \(HARD WALL\)/.test(src)) return "swipe hard-wall wording lost";
  return null;
});

// ─── Behavioural mirror: the follow-up detector (worker regex) ──────────────
// Mirror of the source predicate so a future loosening fails here.

const PRONOUN = /\b(it|that|this|those|these|them)\b/i;
const MUTATE_VERB = /\b(move|moved|chang\w*|updat\w*|reschedul\w*|push\w*|postpon\w*|delet\w*|remov\w*|cancel\w*|renam\w*|reopen\w*|complet\w*|finish\w*|mark|set|edit\w*|fix\w*|bump\w*|shift\w*|done)\b/i;
const CORRECTION = /^(actually|no,|nope|wait,|sorry,|oops|scratch that)\b/i;
const isFollowUp = (t) => {
  t = String(t).trim();
  return t.length > 0 && t.length <= 160 && ((PRONOUN.test(t) && MUTATE_VERB.test(t)) || CORRECTION.test(t));
};

check("detector: fires on 'move it to Friday'", () => isFollowUp("move it to Friday") ? null : "did not fire");
check("detector: fires on 'delete it'", () => isFollowUp("delete it") ? null : "did not fire");
check("detector: fires on 'actually 3pm not 2pm'", () => isFollowUp("actually 3pm not 2pm") ? null : "did not fire");
check("detector: fires on 'change that to Monday'", () => isFollowUp("change that to Monday") ? null : "did not fire");
check("detector: fires on 'complete it'", () => isFollowUp("complete it") ? null : "did not fire");

check("detector: does NOT fire on 'thanks!'", () => isFollowUp("thanks!") ? "false-positive" : null);
check("detector: does NOT fire on a plain question 'what is on this week?'", () => {
  // "this" + no mutate verb -> not a change/delete follow-up
  return isFollowUp("what is on this week?") ? "false-positive" : null;
});
check("detector: does NOT fire on a fresh named request 'remind me to call the auditor Friday'", () =>
  isFollowUp("remind me to call the auditor Friday") ? "false-positive" : null);
check("detector: does NOT fire on a long paragraph (>160 chars)", () => {
  const long = "move it to friday " + "x".repeat(200);
  return isFollowUp(long) ? "false-positive on long message" : null;
});

// ─── runner ────────────────────────────────────────────────────────────────

let pass = 0, fail = 0;
for (const { name, fn } of tests) {
  let reason = null;
  try { reason = fn(); } catch (e) { reason = `threw: ${e?.message || e}`; }
  if (!reason) { pass += 1; console.log(`  ok  ${name}`); }
  else { fail += 1; console.log(`  FAIL ${name} -- ${reason}`); }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
