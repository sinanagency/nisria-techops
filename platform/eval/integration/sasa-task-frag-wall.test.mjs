#!/usr/bin/env node
// Sasa task-fragment WALL-AT-PRIMITIVE — 2026-06-15 (KT #274).
//
// Same-class-of-bug doctrine port. KT #261 fixed complete_task's wrong-target
// close via TASK_FRAG_STOPLIST. The 06-14 audit found three sibling write-
// primitives (reopen_task / update_task / delete_task) shared the same
// substring matcher with no stop-list guard, plus the deterministic
// parseTasks pre-parser dropped "for me" because Pattern A's regex required
// "to". Plus the 17:04-17:05 "Both are done" ghost-match where complete_task
// silently re-targeted an already-closed row and the model narrated plural
// success.
//
// This test pins five guarantees so a future "simplification" cannot regress:
//   F1  TASK_FRAG_STOPLIST + isAllStopwords are module-level and called in
//       complete_task / reopen_task / update_task / delete_task.
//   F2  parseTasks isSelfTarget covers "for me" / "to me" / "on me" / "for
//       myself" / "to myself"; Pattern A regex accepts to|for|on.
//   F3  complete_task returns ok:false + already_done:true with a task_id on
//       its already-done branch (NOT generic not-found).
//   F4  sasa.ts defines PASSIVE_COMPLETION + claimsPluralCompletionMismatch
//       and wires the branch BEFORE the generic claimsCompletionWithoutSuccess.
//   B   Behavioral repro: parseTasks({"Assign this tasks for me:\n- A\n- B"})
//       returns count=2.
//
// Pure local. No DB hit, no Anthropic spend, no network. Mirror of the source
// regex so a future loosening of the guard fails here.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLATFORM = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => readFileSync(resolve(PLATFORM, rel), "utf8");

const tests = [];
function check(name, fn) { tests.push({ name, fn }); }

// ─── F1: stop-list hoisted + called in 4 primitives ────────────────────────

check("F1 seam: smart-tools.ts hoists TASK_FRAG_STOPLIST + isAllStopwords", () => {
  const src = read("lib/smart-tools.ts");
  // Must be at module level (not inside a function body).
  const lstop = src.indexOf("const TASK_FRAG_STOPLIST");
  if (lstop < 0) return "TASK_FRAG_STOPLIST not declared";
  const lhelper = src.indexOf("function isAllStopwords");
  if (lhelper < 0) return "isAllStopwords helper not declared";
  // First declaration must be BEFORE any tool-handler body for sharing.
  const firstHandler = src.indexOf('if (name === "complete_task")');
  if (firstHandler < 0) return "complete_task handler not found";
  if (lstop > firstHandler) return "TASK_FRAG_STOPLIST declared inside a handler instead of module-level";
  // KT #261 incident words must still be in the stop-list.
  const stoplistBlock = src.slice(lstop, lstop + 600);
  for (const w of ["meeting", "meet", "task", "today", "tomorrow"]) {
    if (!new RegExp(`"${w}"`).test(stoplistBlock)) return `stop-list missing required word "${w}"`;
  }
  return null;
});

check("F1: complete_task uses isAllStopwords (not duplicate inline)", () => {
  const src = read("lib/smart-tools.ts");
  const start = src.indexOf('if (name === "complete_task")');
  const end = src.indexOf('// ---- SAFE: reopen_task', start);
  if (start < 0 || end < 0) return "could not bracket complete_task handler";
  const block = src.slice(start, end);
  if (!/isAllStopwords\(frag\)/.test(block)) return "complete_task does not call isAllStopwords(frag)";
  if (/const\s+TASK_FRAG_STOPLIST/.test(block)) return "complete_task still has an INLINE TASK_FRAG_STOPLIST — must use module-level constant";
  return null;
});

check("F1: reopen_task calls isAllStopwords on its frag", () => {
  const src = read("lib/smart-tools.ts");
  const start = src.indexOf('if (name === "reopen_task")');
  const end = src.indexOf('// ---- ', start + 20);
  if (start < 0 || end < 0) return "could not bracket reopen_task handler";
  const block = src.slice(start, end);
  if (!/isAllStopwords\(frag\)/.test(block)) return "reopen_task does not call isAllStopwords(frag)";
  return null;
});

check("F1: update_task calls isAllStopwords on its frag", () => {
  const src = read("lib/smart-tools.ts");
  const start = src.indexOf('if (name === "update_task")');
  if (start < 0) return "update_task handler not found";
  // Look in the first ~3000 chars of the handler (more than enough)
  const block = src.slice(start, start + 3000);
  if (!/isAllStopwords\(frag\)/.test(block)) return "update_task does not call isAllStopwords(frag)";
  return null;
});

check("F1: delete_task calls isAllStopwords on its frag", () => {
  const src = read("lib/smart-tools.ts");
  const start = src.indexOf('if (name === "delete_task")');
  if (start < 0) return "delete_task handler not found";
  const block = src.slice(start, start + 2000);
  if (!/isAllStopwords\(frag\)/.test(block)) return "delete_task does not call isAllStopwords(frag)";
  return null;
});

// ─── F2: parseTasks self-target + Pattern A connector ──────────────────────

check("F2 seam: parseTasks isSelfTarget covers for/to/on me + myself variants", () => {
  const src = read("app/api/whatsapp/worker/parseTasks.mjs");
  const start = src.indexOf("function isSelfTarget(");
  if (start < 0) return "isSelfTarget not defined";
  const block = src.slice(start, start + 800);
  for (const w of ["for me", "to me", "on me", "for myself"]) {
    if (!new RegExp(`"${w}"`).test(block)) return `isSelfTarget missing self-target string "${w}"`;
  }
  return null;
});

check("F2 seam: Pattern A regex accepts to|for|on as connector", () => {
  const src = read("app/api/whatsapp/worker/parseTasks.mjs");
  // Two regexes (re and reLoose) both need the disjunction.
  const re = src.match(/const\s+re\s*=\s*\/[^\n]+/);
  const reLoose = src.match(/const\s+reLoose\s*=\s*\/[^\n]+/);
  if (!re) return "Pattern A `re` regex not found";
  if (!reLoose) return "Pattern A `reLoose` regex not found";
  if (!/\(\?:to\|for\|on\)/.test(re[0])) return "Pattern A `re` regex does not accept to|for|on connector";
  if (!/\(\?:to\|for\|on\)/.test(reLoose[0])) return "Pattern A `reLoose` regex does not accept to|for|on connector";
  return null;
});

// ─── F3: complete_task already_done branch ─────────────────────────────────

check("F3 seam: complete_task returns already_done:true with task_id detail", () => {
  const src = read("lib/smart-tools.ts");
  const start = src.indexOf('if (name === "complete_task")');
  const end = src.indexOf('// ---- SAFE: reopen_task', start);
  const block = src.slice(start, end);
  if (!/already_done:\s*true/.test(block)) return "no already_done:true return in complete_task";
  if (!/\.eq\("status",\s*"done"\)/.test(block)) return "complete_task does not query the DONE column";
  if (!/task_id:\s*t\.id/.test(block)) return "already_done return missing task_id detail";
  return null;
});

check("F3 seam: ToolResult type declares already_done?: boolean", () => {
  const src = read("lib/smart-tools.ts");
  if (!/already_done\?\s*:\s*boolean/.test(src)) return "ToolResult.already_done?: boolean not declared";
  return null;
});

// ─── F4: PASSIVE_COMPLETION + plural-mismatch guard ────────────────────────

check("F4 seam: sasa.ts defines PASSIVE_COMPLETION regex", () => {
  const src = read("lib/agents/sasa.ts");
  if (!/const\s+PASSIVE_COMPLETION\s*=\s*\//.test(src)) return "PASSIVE_COMPLETION regex not declared";
  return null;
});

check("F4 seam: sasa.ts defines claimsPluralCompletionMismatch", () => {
  const src = read("lib/agents/sasa.ts");
  if (!/function\s+claimsPluralCompletionMismatch\b/.test(src)) return "claimsPluralCompletionMismatch not declared";
  return null;
});

check("F4 seam: dedupe by task_id (collision detection)", () => {
  const src = read("lib/agents/sasa.ts");
  const start = src.indexOf("function claimsPluralCompletionMismatch");
  const end = src.indexOf("// SEND/NOTIFY HONESTY", start);
  if (start < 0 || end < 0) return "could not bracket claimsPluralCompletionMismatch";
  const block = src.slice(start, end);
  if (!/touched\.add/.test(block)) return "mismatch detector does not dedupe by task_id (no touched Set)";
  if (!/detail\?\.task_id/.test(block)) return "mismatch detector does not read detail.task_id";
  return null;
});

check("F4: plural-mismatch branch fires BEFORE claimsCompletionWithoutSuccess", () => {
  const src = read("lib/agents/sasa.ts");
  const mismatchBranch = src.indexOf("claimsPluralCompletionMismatch(reply, toolRuns)");
  const completionBranch = src.indexOf("claimsCompletionWithoutSuccess(reply, toolRuns) && !isCapabilityQuestion(opts.command");
  if (mismatchBranch < 0) return "plural-mismatch branch not wired in finalize()";
  if (completionBranch < 0) return "completion-without-success branch not found";
  if (mismatchBranch >= completionBranch) return "plural-mismatch branch must fire BEFORE generic completion guard";
  return null;
});

// ─── B: behavioral repro of 2026-06-14 17:07 incident ──────────────────────

check("B: parseTasks parses 'Assign this tasks for me:' (06-14 17:07 verbatim)", async () => {
  const { parseTasks } = await import("../../app/api/whatsapp/worker/parseTasks.mjs");
  const roster = [{ id: "nur-1", name: "Nur", phone: "00971501622716", status: "active", role: "admin" }];
  const r = parseTasks({
    body: "Assign this tasks for me:\n- Brainstorming with Ashraf\n- Film with Ashraf",
    roster,
    senderPhone: "00971501622716",
    today: "2026-06-15",
  });
  if (r.tasks.length !== 2) return `expected 2 tasks, got ${r.tasks.length}`;
  if (r.tasks[0]?.assignee_name !== "me" && r.tasks[0]?.assignee_name !== "Nur") {
    return `expected assignee 'me' or resolved to Nur, got '${r.tasks[0]?.assignee_name}'`;
  }
  return null;
});

check("B: parseTasks STILL parses 'Assign these tasks to me:' (control)", async () => {
  const { parseTasks } = await import("../../app/api/whatsapp/worker/parseTasks.mjs");
  const roster = [{ id: "nur-1", name: "Nur", phone: "00971501622716", status: "active", role: "admin" }];
  const r = parseTasks({
    body: "Assign these tasks to me:\n- Task A\n- Task B",
    roster,
    senderPhone: "00971501622716",
    today: "2026-06-15",
  });
  if (r.tasks.length !== 2) return `expected 2 tasks, got ${r.tasks.length}`;
  return null;
});

check("B: parseTasks parses 'on me' connector too", async () => {
  const { parseTasks } = await import("../../app/api/whatsapp/worker/parseTasks.mjs");
  const roster = [{ id: "nur-1", name: "Nur", phone: "00971501622716", status: "active", role: "admin" }];
  const r = parseTasks({
    body: "Assign these tasks on me:\n- Task A\n- Task B",
    roster,
    senderPhone: "00971501622716",
    today: "2026-06-15",
  });
  if (r.tasks.length !== 2) return `expected 2 tasks, got ${r.tasks.length}`;
  return null;
});

// ─── runner ────────────────────────────────────────────────────────────────

(async () => {
  let pass = 0;
  let fail = 0;
  for (const t of tests) {
    let err = null;
    try {
      err = await t.fn();
    } catch (e) {
      err = e?.message || String(e);
    }
    if (err) {
      console.error(`FAIL: ${t.name}`);
      console.error(`      ${err}`);
      fail += 1;
    } else {
      console.log(`PASS: ${t.name}`);
      pass += 1;
    }
  }
  console.log(`\n${pass} pass, ${fail} fail, ${tests.length} total`);
  process.exit(fail === 0 ? 0 : 1);
})();
