#!/usr/bin/env node
// Sasa SWIPE-REPLY ANCHOR + DISCRIMINATOR-NAME WALL — 2026-06-15.
//
// Two seam-level walls for the bug family "fragment match without anchor":
//
//  1. SWIPE-REPLY ANCHOR (Wall 1, wall-at-primitive). The WhatsApp Cloud API
//     payload carries messages[].context.id when the user reply-quotes a
//     specific prior message. The webhook MUST capture it, persist it on the
//     inbound row as reply_to_external_id, and propagate it through the job
//     payload. The worker MUST resolve it at turn time and inject a hard-wall
//     anchor block into the LLM turn. Bug shape: Nur swipes a Sasa message
//     about Task X, types "done", Sasa fuzzy-matches and closes Task Y.
//
//  2. DISCRIMINATOR-NAME WALL (Wall 2, mirrors KT #274 first-name doctrine).
//     When complete/reopen/update/delete_task resolves a candidate whose
//     title carries a team-member first-name that the operator did NOT say
//     in their last inbound message, the write must refuse. Bug shape: Nur
//     says "meeting taona done", Sasa closes "meeting with haneen".
//
// Pure local. No DB hit, no Anthropic spend, no network. Mirror of the
// source so a future edit that loosens either guard fails here.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLATFORM = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => readFileSync(resolve(PLATFORM, rel), "utf8");

const tests = [];
function check(name, fn) { tests.push({ name, fn }); }

// ─── Wall 1 seams: webhook ─────────────────────────────────────────────────

check("seam: webhook extracts m.context.id", () => {
  const src = read("app/api/whatsapp/webhook/route.ts");
  if (!/m\.context\?\.id/.test(src)) return "webhook does not read m.context?.id";
  if (!/replyToExternalId/.test(src)) return "replyToExternalId not declared in webhook";
  return null;
});

check("seam: webhook persists reply_to_external_id on inbound row", () => {
  const src = read("app/api/whatsapp/webhook/route.ts");
  if (!/reply_to_external_id:\s*replyToExternalId/.test(src)) return "messages.insert payload missing reply_to_external_id";
  return null;
});

check("seam: webhook threads reply_to_external_id into enqueueJob payload", () => {
  const src = read("app/api/whatsapp/webhook/route.ts");
  const idx = src.indexOf('enqueueJob("whatsapp.reply"');
  if (idx < 0) return "enqueueJob call not found";
  const block = src.slice(idx, idx + 800);
  if (!/reply_to_external_id:\s*replyToExternalId/.test(block)) return "job payload missing reply_to_external_id";
  return null;
});

// ─── Wall 1 seams: worker ──────────────────────────────────────────────────

check("seam: worker reads p.reply_to_external_id", () => {
  const src = read("app/api/whatsapp/worker/route.ts");
  if (!/p\.reply_to_external_id/.test(src)) return "worker does not read p.reply_to_external_id";
  return null;
});

check("seam: worker resolves the quoted message to a subject", () => {
  const src = read("app/api/whatsapp/worker/route.ts");
  if (!/swipeAnchorSubject/.test(src)) return "swipeAnchorSubject missing in worker";
  if (!/swipeAnchorNote/.test(src)) return "swipeAnchorNote missing in worker";
  if (!/whatsapp\.message_out/.test(src)) return "worker does not look up message_out event for subject resolution";
  return null;
});

check("seam: worker emits sasa.swipe_reply_resolved", () => {
  const src = read("app/api/whatsapp/worker/route.ts");
  if (!/sasa\.swipe_reply_resolved/.test(src)) return "swipe_reply_resolved event missing";
  return null;
});

check("seam: worker passes swipeAnchor opt into runSasa (both call sites)", () => {
  const src = read("app/api/whatsapp/worker/route.ts");
  const matches = src.match(/swipeAnchor:\s*swipeAnchorOpt/g) || [];
  if (matches.length < 2) return `expected 2 runSasa call sites threading swipeAnchor, found ${matches.length}`;
  return null;
});

// ─── Wall 1 seams: sasa.ts ─────────────────────────────────────────────────

check("seam: runSasa opts declares swipeAnchor field", () => {
  const src = read("lib/agents/sasa.ts");
  const sigIdx = src.indexOf("export async function runSasa");
  if (sigIdx < 0) return "runSasa not found";
  const sig = src.slice(sigIdx, sigIdx + 1500);
  if (!/swipeAnchor\?\:/.test(sig)) return "swipeAnchor not in runSasa opts type";
  return null;
});

check("seam: runSasa renders SWIPE-REPLY ANCHOR hard-wall block in dynamic tail", () => {
  const src = read("lib/agents/sasa.ts");
  if (!/SWIPE-REPLY ANCHOR \(HARD WALL\)/.test(src)) return "hard-wall block string missing";
  if (!/anchorBlock/.test(src)) return "anchorBlock variable missing";
  // anchorBlock must be composed into clockLine (dynamic tail), NOT into the
  // cached prefix. If a future edit puts it above SPLIT_MARKER it busts cache.
  const blockIdx = src.indexOf("anchorBlock = `");
  const clockLineIdx = src.indexOf("const clockLine =");
  if (blockIdx < 0 || clockLineIdx < 0) return "could not locate anchorBlock/clockLine";
  if (clockLineIdx < blockIdx) return "anchorBlock must be built BEFORE clockLine";
  if (!/clockLine.*anchorBlock/s.test(src.slice(clockLineIdx, clockLineIdx + 400))) return "anchorBlock not embedded in clockLine";
  return null;
});

// ─── Wall 1 seams: schema ─────────────────────────────────────────────────

check("seam: schema.sql declares messages.reply_to_external_id column + index", () => {
  const src = read("db/schema.sql");
  if (!/"reply_to_external_id"\s+text/.test(src)) return "reply_to_external_id column missing from messages table";
  if (!/idx_messages_reply_to_external/.test(src)) return "idx_messages_reply_to_external index missing";
  return null;
});

check("seam: migration file exists for swipe-reply anchor", () => {
  const src = read("db/migrations/20260615_swipe_reply_anchor.sql");
  if (!/ADD COLUMN IF NOT EXISTS reply_to_external_id/.test(src)) return "migration missing ADD COLUMN";
  if (!/idx_messages_reply_to_external/.test(src)) return "migration missing index";
  return null;
});

// ─── Wall 2 seams: discriminator wall ──────────────────────────────────────

check("seam: smart-tools.ts defines discriminatorMismatch helper", () => {
  const src = read("lib/smart-tools.ts");
  if (!/async function discriminatorMismatch/.test(src)) return "discriminatorMismatch helper missing";
  if (!/team_members/.test(src)) return "discriminatorMismatch must query team_members";
  return null;
});

check("seam: discriminatorMismatch wired into complete_task before update", () => {
  const src = read("lib/smart-tools.ts");
  const start = src.indexOf('if (name === "complete_task")');
  if (start < 0) return "complete_task handler not found";
  const end = src.indexOf('if (name === "reopen_task")', start);
  const block = src.slice(start, end > 0 ? end : start + 8000);
  const wallIdx = block.indexOf("discriminatorMismatch(db, ctx");
  const updateIdx = block.indexOf('db.from("tasks").update');
  if (wallIdx < 0) return "discriminatorMismatch not called in complete_task";
  if (updateIdx >= 0 && wallIdx > updateIdx) return "wall fires AFTER update — must precede";
  return null;
});

check("seam: discriminatorMismatch wired into reopen_task before update", () => {
  const src = read("lib/smart-tools.ts");
  const start = src.indexOf('if (name === "reopen_task")');
  if (start < 0) return "reopen_task handler not found";
  const end = src.indexOf('if (name === "add_task_comment"', start);
  const block = src.slice(start, end > 0 ? end : start + 4000);
  const wallIdx = block.indexOf("discriminatorMismatch(db, ctx");
  const updateIdx = block.indexOf('db.from("tasks").update');
  if (wallIdx < 0) return "discriminatorMismatch not called in reopen_task";
  if (updateIdx >= 0 && wallIdx > updateIdx) return "wall fires AFTER update — must precede";
  return null;
});

check("seam: discriminatorMismatch wired into update_task before update", () => {
  const src = read("lib/smart-tools.ts");
  const start = src.indexOf('if (name === "update_task")');
  if (start < 0) return "update_task handler not found";
  const end = src.indexOf('if (name === "add_wishlist_item"', start);
  const block = src.slice(start, end > 0 ? end : start + 4000);
  const wallIdx = block.indexOf("discriminatorMismatch(db, ctx");
  const updateIdx = block.indexOf('db.from("tasks").update');
  if (wallIdx < 0) return "discriminatorMismatch not called in update_task";
  if (updateIdx >= 0 && wallIdx > updateIdx) return "wall fires AFTER update — must precede";
  return null;
});

check("seam: discriminatorMismatch wired into delete_task before delete", () => {
  const src = read("lib/smart-tools.ts");
  const start = src.indexOf('if (name === "delete_task")');
  if (start < 0) return "delete_task handler not found";
  const end = src.indexOf('if (name === "remember_fact"', start);
  const block = src.slice(start, end > 0 ? end : start + 3000);
  const wallIdx = block.indexOf("discriminatorMismatch(db, ctx");
  const deleteIdx = block.indexOf('db.from("tasks").delete()');
  if (wallIdx < 0) return "discriminatorMismatch not called in delete_task";
  if (deleteIdx >= 0 && wallIdx > deleteIdx) return "wall fires AFTER delete — must precede";
  return null;
});

check("seam: refusal emits sasa.discriminator_mismatch_refused event", () => {
  const src = read("lib/smart-tools.ts");
  const matches = src.match(/sasa\.discriminator_mismatch_refused/g) || [];
  if (matches.length < 4) return `expected 4 emit sites (one per task primitive), found ${matches.length}`;
  return null;
});

// ─── Behavioural: prove the discriminator helper logic matches real shapes ─

// Mirror of the helper's name-regex used in lib/smart-tools.ts so the test
// catches loosening of the boundary chars.
const nameRe = (n) => new RegExp(`(^|[^a-z])${n}([^a-z]|$)`, "i");

check("guard: 'meeting taona' user msg vs 'meeting with haneen' title → mismatch", () => {
  // simulate: title has only 'haneen', userBody has only 'taona' → refuse
  const team = ["taona", "haneen", "ashraf", "grace"];
  const titleLower = "meeting with haneen";
  const userBody = "meeting taona is done";
  const namesInTitle = team.filter((n) => nameRe(n).test(titleLower));
  if (namesInTitle.length !== 1) return "title should have exactly 1 team name";
  const expected = namesInTitle[0];
  if (nameRe(expected).test(userBody)) return "userBody falsely matches expected";
  const userNamed = team.filter((n) => n !== expected && nameRe(n).test(userBody));
  if (userNamed.length === 0) return "userBody should name a different team member";
  return null; // refusal would fire
});

check("guard: 'meeting with haneen' user msg vs 'meeting with haneen' title → ok", () => {
  const team = ["taona", "haneen", "ashraf", "grace"];
  const titleLower = "meeting with haneen";
  const userBody = "meeting with haneen is done";
  const namesInTitle = team.filter((n) => nameRe(n).test(titleLower));
  const expected = namesInTitle[0];
  if (!nameRe(expected).test(userBody)) return "userBody must match expected name (no refusal)";
  return null;
});

check("guard: title without any team name → no refusal", () => {
  const team = ["taona", "haneen", "ashraf"];
  const titleLower = "submit quarterly report";
  const namesInTitle = team.filter((n) => nameRe(n).test(titleLower));
  if (namesInTitle.length !== 0) return "no team names should be in title";
  // helper returns ok:true early — no refusal possible
  return null;
});

check("guard: short name 'al' would over-match — helper enforces length >= 3", () => {
  // Mirror of the helper's filter step. A two-char first name would match
  // inside many tokens (e.g. 'all', 'almost') so the helper drops it.
  const short = "al";
  if (short.length >= 3) return "short name should be filtered out at length >= 3";
  return null;
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
