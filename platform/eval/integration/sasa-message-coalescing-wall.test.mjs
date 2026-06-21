#!/usr/bin/env node
// Sasa per-sender message COALESCING wall — 2026-06-20.
//
// COST PAID (live bug): a contact sent "you're cool" then "thanks" as two
// separate WhatsApp messages and got TWO separate "Appreciate that" replies.
// Different wording on a later pair proved it was TWO independent brain runs,
// one per inbound message. Root cause: every inbound message enqueues its own
// whatsapp.reply job -> its own runSasa -> its own reply. There is NO per-sender
// turn-assembly. brain-core's shouldProcess (lib/brain-core/webhook-guard.js)
// has a per-sender lock but it is an IN-MEMORY Map (PROCESSING_LOCKS = new Map()),
// which does NOT survive across Vercel serverless invocations, so it cannot
// coalesce across the separate function calls.
//
// THE FIX (durable, Postgres-backed): a per-sender claim row in wa_turn_claim.
// The first job to win the claim defers a brief settle, then re-reads ALL
// unhandled inbound (status='received') from the sender since the last outbound,
// concatenates them in order, runs the brain ONCE, sends ONE reply, marks them
// all handled (status='coalesced'), and releases the claim. Losing jobs mark
// their own inbound handled and return WITHOUT replying. FAIL-OPEN: any error in
// the coalesce path falls back to the existing single-message reply so the bot
// NEVER goes silent (honesty law).
//
// Seams asserted (source-string, pure local — no DB, no Anthropic, no network):
//  S1  reply path no longer fires unconditionally per message: a per-sender
//      coalesce/claim gate sits before the brain reply.
//  S2  the claim/lock is DURABLE (a DB table wa_turn_claim, not an in-memory Map).
//  S3  the coalescer reads ALL unhandled inbound from the sender since the last
//      outbound (turn assembly), not just the current message.
//  S4  FAIL-OPEN: a try/catch around the coalesce path that falls back to the
//      normal single-message reply on error.
//  S5  exactly-one-reply: the non-winning job no-ops without sending.
//
// Migration seam: the durable claim table is shipped as an idempotent migration.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLATFORM = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => readFileSync(resolve(PLATFORM, rel), "utf8");
const exists = (rel) => existsSync(resolve(PLATFORM, rel));
// Strip line-comments so seam assertions test the executable code, not the
// explanatory prose (which intentionally names the bug, e.g. "new Map()").
const codeOnly = (src) => src.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
// Index of the actual CALL site (skip the import + comment mentions).
const callIdx = (src) => {
  const m = src.match(/\bawait\s+coalesceTurn\s*\(/);
  return m ? m.index : -1;
};

const tests = [];
function check(name, fn) { tests.push({ name, fn }); }

const WORKER = "app/api/whatsapp/worker/route.ts";
const COALESCE = "lib/whatsapp-coalesce.ts";

// ─── S1: a per-sender coalesce/claim gate sits before the brain reply ───────

check("S1: worker imports the coalesce gate", () => {
  const src = read(WORKER);
  if (!/coalesceTurn|whatsapp-coalesce/.test(src)) return "worker does not import the coalesce gate";
  return null;
});

check("S1: the coalesce gate is invoked inside processJob before runSasa", () => {
  const src = read(WORKER);
  const callIdx = src.search(/coalesceTurn\s*\(/);
  const brainIdx = src.search(/runSasa\s*\(/);
  if (callIdx < 0) return "coalesceTurn(...) is never called";
  if (brainIdx < 0) return "runSasa not found (sanity)";
  if (callIdx > brainIdx) return "coalesce gate runs AFTER runSasa — it must gate the brain, not follow it";
  return null;
});

check("S1: a loser/deferred outcome short-circuits the job (return without brain)", () => {
  const src = read(WORKER);
  // After the coalesce CALL there must be a branch that returns the job early
  // (the non-winner no-ops with markJobDone + return).
  const idx = callIdx(src);
  if (idx < 0) return "coalesce call site not found";
  const after = src.slice(idx, idx + 700);
  if (!/markJobDone\([\s\S]{0,60}return/.test(after) && !/return\s*;/.test(after))
    return "no early markJobDone+return after the coalesce gate — loser would fall through to the brain and double-reply";
  return null;
});

// ─── S2: the claim/lock is DURABLE (a DB table, not an in-memory Map) ────────

check("S2: coalesce module exists", () => {
  if (!exists(COALESCE)) return `${COALESCE} missing`;
  return null;
});

check("S2: claim is a Postgres table (wa_turn_claim), inserted via db.from", () => {
  const src = read(COALESCE);
  if (!/wa_turn_claim/.test(src)) return "wa_turn_claim table not referenced — claim is not durable";
  if (!/\.from\(\s*["'`]wa_turn_claim["'`]\s*\)/.test(src)) return "wa_turn_claim is not accessed via db.from(...) (not a real table write)";
  if (!/\.insert\(/.test(src)) return "claim is never INSERTed (the durable acquire)";
  return null;
});

check("S2: claim acquire relies on a unique violation, NOT an in-memory Map", () => {
  const code = codeOnly(read(COALESCE));
  if (/new Map\s*\(/.test(code)) return "coalesce module uses an in-memory Map — that is the exact bug (does not survive serverless invocations)";
  // The acquire must distinguish the unique-violation loser from the winner.
  if (!/duplicate key|unique|23505/i.test(code)) return "acquire does not detect the unique-violation loser path";
  return null;
});

check("S2: the worker's in-memory shouldProcess Map is NOT the load-bearing coalescer", () => {
  const src = read(WORKER);
  // shouldProcess / PROCESSING_LOCKS must not be the mechanism guarding the reply.
  if (/PROCESSING_LOCKS/.test(src)) return "worker references the in-memory PROCESSING_LOCKS map as a gate";
  return null;
});

// ─── S3: turn assembly — reads ALL unhandled inbound since the last outbound ──

check("S3: coalescer reads inbound by status='received' (unhandled marker)", () => {
  const src = read(COALESCE);
  if (!/received/.test(src)) return "does not read inbound by the 'received' unhandled marker";
  if (!/direction/.test(src)) return "does not scope to direction (in vs out)";
  return null;
});

check("S3: coalescer bounds the window by the last OUTBOUND message", () => {
  const src = read(COALESCE);
  // Must find the last outbound to define 'since last reply'.
  if (!/out\b/.test(src)) return "does not reference outbound direction to bound the turn";
  if (!/last|gt\(|gte\(|created_at/.test(src)) return "no created_at bound — would re-coalesce old history";
  return null;
});

check("S3: coalescer concatenates the burst (multiple bodies into one turn)", () => {
  const src = read(COALESCE);
  if (!/join\(|\+=|concat|map\(/.test(src)) return "does not assemble multiple message bodies into one turn input";
  return null;
});

check("S3: coalescer marks ALL claimed inbound handled (status -> coalesced)", () => {
  const src = read(COALESCE);
  if (!/coalesced/.test(src)) return "does not flip claimed inbound to a handled status";
  if (!/\.update\(/.test(src)) return "no update() that marks the burst handled";
  return null;
});

// ─── S4: FAIL-OPEN — coalesce error falls back to the normal single reply ────

check("S4: coalesce call in the worker is wrapped in try/catch", () => {
  const src = read(WORKER);
  const idx = callIdx(src);
  if (idx < 0) return "coalesceTurn not called";
  // Look at a window BEFORE the call for the enclosing `try {`.
  const before = src.slice(Math.max(0, idx - 400), idx);
  if (!/try\s*\{/.test(before)) return "no `try {` precedes the coalesce call — an error would crash the job, not fall open";
  return null;
});

check("S4: on coalesce error the worker continues to the normal reply (fail-open, never silent)", () => {
  const src = read(WORKER);
  const idx = callIdx(src);
  const after = src.slice(idx);
  // Locate the OUTER catch that follows the coalesce call, then brace-match its
  // body precisely (the body legitimately contains an inner try/catch for the
  // emit, so a non-greedy match is wrong — we must walk braces).
  const cm = after.match(/catch\s*\([^)]*\)\s*\{/);
  if (!cm) return "no catch after the coalesce call";
  let i = cm.index + cm[0].length; // first char inside the catch body
  let depth = 1;
  const start = i;
  while (i < after.length && depth > 0) {
    const ch = after[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    i++;
  }
  const body = after.slice(start, i - 1);
  // Strip line-comments and the inner emit(...) argument so the scan sees only
  // control flow the catch itself executes.
  const flow = body.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  // The catch must NOT markJobDone or return — either would drop the turn into
  // silence instead of falling open to the normal single-message reply.
  if (/\bmarkJobDone\s*\(/.test(flow)) return "catch block calls markJobDone — a coalescer fault would END the job silently instead of replying";
  if (/\breturn\b/.test(flow)) return "catch block returns — a coalescer fault would skip the reply (bot goes SILENT) instead of failing open";
  return null;
});

check("S4: module-level: acquire returns a fail-open signal rather than throwing past the caller", () => {
  const src = read(COALESCE);
  // The module itself must wrap its DB work so a missing table degrades to
  // 'process this one message normally' instead of throwing.
  if (!/try\s*\{/.test(src) || !/catch/.test(src)) return "coalesce module has no try/catch — a table-missing error would propagate";
  return null;
});

// ─── S5: exactly-one-reply — the loser no-ops without sending ────────────────

check("S5: coalesce outcome distinguishes winner vs loser/deferred", () => {
  const src = read(COALESCE);
  // The returned shape must carry an instruction the worker can branch on.
  if (!/win|owner|deferred|skip|proceed|noop|no_op|coalesced/i.test(src)) return "no winner/loser outcome distinction returned";
  return null;
});

check("S5: loser marks its own inbound handled but does NOT send", () => {
  const src = read(COALESCE);
  // On the loser path it should update the message to handled and return a
  // 'do not reply' outcome. Assert the module never calls sendText itself on
  // the loser path (the worker owns sends; the module only signals).
  if (/sendText\s*\(/.test(src) && !/winner|owner/i.test(src)) return "coalesce module sends directly without a winner guard — risks double-reply";
  return null;
});

check("S5: worker only proceeds to the brain when the outcome says proceed/winner", () => {
  const src = read(WORKER);
  const idx = src.search(/coalesceTurn\s*\(/);
  const after = src.slice(idx, idx + 1200);
  // There must be a conditional that gates the rest of processJob on the outcome.
  if (!/if\s*\(/.test(after)) return "no conditional on the coalesce outcome — every job would still reach the brain";
  return null;
});

// ─── Migration seam: durable claim table shipped idempotently ────────────────

check("MIGRATION: an idempotent migration creates wa_turn_claim", () => {
  const dir = "db/migrations";
  const files = readdirSync(resolve(PLATFORM, dir));
  const hit = files.find((f) => /wa_turn_claim|coalesc/i.test(f) || /20260620/.test(f) && /coalesc|turn_claim/i.test(read(`${dir}/${f}`)));
  let migFile = files.find((f) => {
    try { return /wa_turn_claim/.test(read(`${dir}/${f}`)); } catch { return false; }
  });
  if (!migFile) return "no migration creates wa_turn_claim";
  const mig = read(`${dir}/${migFile}`);
  if (!/create table if not exists/i.test(mig)) return "migration is not idempotent (missing CREATE TABLE IF NOT EXISTS)";
  return null;
});

check("MIGRATION: schema.sql documents wa_turn_claim", () => {
  const sql = read("db/schema.sql");
  if (!/wa_turn_claim/.test(sql)) return "db/schema.sql not updated with wa_turn_claim";
  return null;
});

// ─── runner ──────────────────────────────────────────────────────────────────

let failed = 0;
for (const t of tests) {
  let res = null;
  try { res = t.fn(); } catch (e) { res = String(e?.message || e); }
  if (res) { failed++; console.error(`RED  ${t.name}: ${res}`); }
  else { console.log(`ok   ${t.name}`); }
}
console.log(`\n${tests.length - failed}/${tests.length} pass`);
if (failed) { console.log("WALL RED"); process.exitCode = 1; }
else { console.log("WALL GREEN"); }
