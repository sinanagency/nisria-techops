// task access-control wall (2026-06-20). The hard product constraint: CRUD on
// tasks is OWNER-ONLY (Nur, Taona). A team-tier caller may only create/complete/
// reopen/update/delete a task that is THEIR OWN (assignee_id === the caller's
// member id). Before this wall, create_task / complete_task / reopen_task had NO
// ownership gate and update_task / delete_task were only prompt-excluded, so a
// team member could assign work to anyone, mark Nur's task done, reopen, etc.
//
// Fix: ONE centralized helper `assertTaskAccess(ctx, db, { targetMemberId,
// taskAssigneeId })` called at the top of every mutating task tool:
//   - non-team tier (owner/admin/web-console) -> ok:true (owners keep full CRUD)
//   - team tier, unverifiable caller -> ok:false error:"unrecognised_caller"
//   - team CREATE: target must equal me.id, else error:"access_denied"
//   - team COMPLETE/REOPEN/UPDATE/DELETE: existing task.assignee_id must equal
//     me.id, else error:"access_denied"
//
// This wall also pins the four companion fixes that ship in the same change:
//   - complete_task excludes expired tasks from completion candidates
//   - update_task resolves a NAMED new-assignee via findMemberUnion (no silent pick)
//   - delete/update/reopen check the Supabase mutation error before claiming ok
//
// Seams:
//   S1  assertTaskAccess helper is declared
//   S2  non-team tier bypasses (returns ok:true on owner/admin)
//   S3  team tier resolves the caller via findMemberByPhone, refuses unrecognised
//   S4  team CREATE gate: target !== me.id -> access_denied
//   S5  team mutate gate: task.assignee_id !== me.id -> access_denied
//   S6  assertTaskAccess called in create_task
//   S7  assertTaskAccess called in complete_task
//   S8  assertTaskAccess called in reopen_task
//   S9  assertTaskAccess called in update_task
//   S10 assertTaskAccess called in delete_task
//   S11 complete_task excludes expired from completion candidates
//   S12 update_task resolves a NAMED new-assignee via findMemberUnion
//   S13 delete_task checks the .delete() error before ok:true
//   S14 update_task checks the .update() error before ok:true
//   S15 reopen_task checks the .update() error before ok:true
//
// Pure local: read the .ts as a string, no runtime, no DB.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SMART = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "smart-tools.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

// Isolate a region between two markers.
const regionBetween = (startMarker, len) => {
  const i = SMART.indexOf(startMarker);
  return i >= 0 ? SMART.slice(i, i + len) : "";
};
// Isolate a tool's impl block: from `if (name === "<tool>")` to the START of the
// NEXT `if (name === "..."` tool marker, so the whole block is captured no matter
// how long it is (complete_task / update_task run to hundreds of lines).
const toolBlock = (tool) => {
  const startMarker = `if (name === "${tool}")`;
  const i = SMART.indexOf(startMarker);
  if (i < 0) return "";
  // find the next tool marker after this one
  const nextRe = /\n\s*if \(name === "/g;
  nextRe.lastIndex = i + startMarker.length;
  const m = nextRe.exec(SMART);
  const end = m ? m.index : SMART.length;
  return SMART.slice(i, end);
};

// ---- S1: helper declared ----
{
  const declared = /(async\s+function|const)\s+assertTaskAccess\b/.test(SMART);
  if (!declared) fail("S1 assertTaskAccess helper must be declared");
  else ok("S1 assertTaskAccess helper declared");
}

// Isolate the helper body for S2-S5.
const helper = (() => {
  const i = SMART.search(/(async\s+function|const)\s+assertTaskAccess\b/);
  return i >= 0 ? SMART.slice(i, i + 2200) : "";
})();

// ---- S2: non-team tier bypasses (owner full CRUD) ----
if (!helper || !/tier\s*!==\s*"team"/.test(helper) || !/ok:\s*true/.test(helper)) {
  fail("S2 assertTaskAccess must return ok:true when ctx.tier !== 'team' (owners keep full CRUD)");
} else ok("S2 non-team tier bypasses (owners keep full CRUD)");

// ---- S3: team caller resolved via phone, unrecognised refused ----
if (!helper || !/findMemberByPhone\(/.test(helper) || !/unrecognised_caller/.test(helper)) {
  fail("S3 team tier must resolve caller via findMemberByPhone and refuse unrecognised_caller");
} else ok("S3 team caller resolved via phone; unrecognised refused");

// ---- S4 + S5: access_denied on a foreign target/task ----
if (!helper || !/access_denied/.test(helper)) {
  fail("S4/S5 assertTaskAccess must refuse access_denied when target/task is not the caller's own");
} else {
  // targetMemberId (create) and taskAssigneeId (mutate) must both feed the gate.
  if (!/targetMemberId/.test(helper)) fail("S4 create gate must compare targetMemberId to the caller id");
  else ok("S4 team CREATE gate compares targetMemberId to caller (access_denied otherwise)");
  if (!/taskAssigneeId/.test(helper)) fail("S5 mutate gate must compare taskAssigneeId to the caller id");
  else ok("S5 team MUTATE gate compares taskAssigneeId to caller (access_denied otherwise)");
}

// ---- S6-S10: helper called at the top of every mutating task tool ----
const callSites = [
  ["S6", "create_task"],
  ["S7", "complete_task"],
  ["S8", "reopen_task"],
  ["S9", "update_task"],
  ["S10", "delete_task"],
];
for (const [s, tool] of callSites) {
  const block = toolBlock(tool);
  if (!block) { fail(`${s} ${tool} block not found`); continue; }
  if (!/assertTaskAccess\(/.test(block)) fail(`${s} ${tool} must call assertTaskAccess`);
  else ok(`${s} ${tool} calls assertTaskAccess`);
}

// ---- S11: complete_task excludes expired from completion candidates ----
{
  // Strip line-comments so a `.neq(...)` mentioned in a code comment does not
  // trip the "still uses neq" check; we only care about the live query.
  const block = toolBlock("complete_task").split("\n").filter((ln) => !/^\s*\/\//.test(ln)).join("\n");
  // The completion candidate query must NOT use .neq("status","done") (which still
  // matches expired); it must exclude both done AND expired.
  const usesNeqDone = /\.neq\(\s*["']status["']\s*,\s*["']done["']\s*\)/.test(block);
  const excludesExpired = /\.not\(\s*["']status["']\s*,\s*["']in["']\s*,\s*["']\(done,\s*expired\)["']\s*\)/.test(block);
  if (usesNeqDone || !excludesExpired) {
    fail("S11 complete_task must exclude expired via .not('status','in','(done,expired)'), not .neq('status','done')");
  } else ok("S11 complete_task excludes expired from completion candidates");
}

// ---- S12: update_task resolves a NAMED new-assignee via findMemberUnion ----
{
  const block = toolBlock("update_task");
  if (!/findMemberUnion\(/.test(block)) {
    fail("S12 update_task must route a NAMED new-assignee through findMemberUnion (no silent first-pick)");
  } else ok("S12 update_task resolves a named new-assignee via findMemberUnion");
  // and it must surface the ambiguity (ask), mirroring create_task.
  if (!/memberAmbiguityQuestion/.test(block)) {
    fail("S12b update_task must surface memberAmbiguityQuestion on an ambiguous assignee");
  } else ok("S12b update_task asks 'which one?' on an ambiguous assignee");
}

// ---- S13-S15: mutations check the returned error before claiming success ----
{
  // delete_task
  const del = toolBlock("delete_task");
  const delChecks = /const\s*{\s*[^}]*error[^}]*}\s*=\s*await db\.from\("tasks"\)\.delete\(\)/.test(del)
    || /\.delete\(\)[\s\S]{0,120}\.eq\("id"[\s\S]{0,40};\s*[\s\S]{0,200}?if\s*\(\s*\w*[Ee]rr/.test(del)
    || /(delErr|delError|error)[\s\S]{0,40}\.delete\(\)/.test(del);
  if (!delChecks) fail("S13 delete_task must destructure { error } from .delete() and refuse on failure");
  else ok("S13 delete_task checks the delete error");

  // update_task
  const upd = toolBlock("update_task");
  const updChecks = /const\s*{\s*[^}]*error[^}]*}\s*=\s*await db\.from\("tasks"\)\.update\(/.test(upd);
  if (!updChecks) fail("S14 update_task must destructure { error } from .update() and refuse on failure");
  else ok("S14 update_task checks the update error");

  // reopen_task
  const reo = toolBlock("reopen_task");
  const reoChecks = /const\s*{\s*[^}]*error[^}]*}\s*=\s*await db\.from\("tasks"\)\.update\(/.test(reo);
  if (!reoChecks) fail("S15 reopen_task must destructure { error } from .update() and refuse on failure");
  else ok("S15 reopen_task checks the update error");
}

// ===========================================================================
// INTEGRATION SEAMS (2026-06-20 integration-verification pass). The access gate
// returns { ok:false, error:"access_denied"|"unrecognised_caller", summary } for
// a team member touching a task that is not theirs. The MOST IMPORTANT cross-file
// invariant: that refusal must NEVER become a false "I created/completed it" line
// once the tool result reaches the sasa.ts honesty guards. These seams pin the
// three facts that compose to make that true across smart-tools.ts -> sasa.ts.
// ===========================================================================
import { fileURLToPath as _f2 } from "node:url";
const SASA = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "agents", "sasa.ts"), "utf8");

// ---- I1: the gate's refusal is ok:false (not ok:true / not silent). The honesty
//          guards key completion claims on ok===true, so an ok:false refusal can
//          never back a "done/created" claim. ----
{
  // Every assertTaskAccess refusal in the helper carries ok:false.
  const helperBody = helper; // captured above (S2-S5)
  const refusals = (helperBody.match(/return\s*{\s*ok:\s*false/g) || []).length;
  if (refusals < 2) fail("I1 assertTaskAccess refusals must be ok:false (access_denied + unrecognised_caller)");
  else ok("I1 access refusals are ok:false (cannot back a completion claim)");
  // And the call sites relay the gate result as ok:false to the model.
  const createBlock = toolBlock("create_task");
  if (!/if\s*\(\s*!gate\.ok\s*\)\s*return\s*{\s*ok:\s*false/.test(createBlock)) {
    fail("I1b create_task must return ok:false on !gate.ok (refusal must reach the model as a failed tool result)");
  } else ok("I1b create_task relays the gate refusal as ok:false");
}

// ---- I2: sasa.ts honesty guards treat completion as ok===true only. The two
//          backstops that catch a false "done" claim (claimsCompletionWithoutSuccess
//          via the shape guard, and claimsToolResultMismatch) require a
//          COMPLETION_TOOLS run with ok===true. An access_denied (ok:false) is
//          therefore never "a success", so a false success line is substituted. ----
{
  // claimsToolResultMismatch: anyCompleted requires ok === true.
  const ctrm = /function claimsToolResultMismatch[\s\S]{0,400}?COMPLETION_TOOLS\.has\(t\.name\)\s*&&\s*\(t\.result as any\)\?\.ok\s*===\s*true/.test(SASA);
  if (!ctrm) fail("I2 claimsToolResultMismatch must require a COMPLETION_TOOLS run with ok===true (else an ok:false refusal could pass as success)");
  else ok("I2 claimsToolResultMismatch keys success on ok===true (ok:false refusal cannot pass)");
  // create_task/complete_task/etc are in COMPLETION_TOOLS, so the shape guard
  // governs their completion claims.
  const ctSet = /const COMPLETION_TOOLS = new Set\(\[[\s\S]{0,400}?"complete_task"[\s\S]{0,200}?"create_task"/.test(SASA);
  if (!ctSet) fail("I2b COMPLETION_TOOLS must include the task mutation tools (so their false-completion claims are guarded)");
  else ok("I2b task tools are in COMPLETION_TOOLS (false-completion guarded)");
}

// ---- I3: when claimsCompletionWithoutSuccess fires, the access-refusal SUMMARY
//          is the line relayed (toolAsk), so the user hears the honest "that task
//          isn't assigned to you" rather than a generic hedge OR a false success.
//          toolAsk picks the last COMPLETION_TOOLS run with ok===false + a summary. ----
{
  const toolAskPick = /toolAsk\s*=\s*\[\.\.\.toolRuns\]\.reverse\(\)\.find\(\s*\(t\)\s*=>\s*COMPLETION_TOOLS\.has\(t\.name\)\s*&&\s*t\.result\s*&&\s*\(t\.result as any\)\.ok\s*===\s*false\s*&&\s*typeof\s*\(t\.result as any\)\.summary\s*===\s*"string"/.test(SASA);
  if (!toolAskPick) fail("I3 toolAsk must select the ok:false COMPLETION_TOOLS result that carries a summary (so the access refusal reaches the user)");
  else ok("I3 toolAsk surfaces the ok:false refusal summary to the user");
  // And that summary is what gets shipped when the completion guard fires.
  if (!/\(toolAsk\?\.result as any\)\?\.summary\s*\|\|\s*HONEST_NO_ACTION_REASK/.test(SASA)) {
    fail("I3b on a false completion claim the reply must prefer the tool's refusal summary over the generic re-ask");
  } else ok("I3b refusal summary is preferred over the generic hedge");
}

// ---- I4: the access refusal summaries are honest refusals, not success phrasing.
//          A defensive check that the gate text never says "created"/"completed". ----
{
  const accessLines = helper.match(/summary:\s*"[^"]*"/g) || [];
  const leaks = accessLines.filter((s) => /\b(created|completed|done|marked it|logged it)\b/i.test(s));
  if (leaks.length) fail("I4 access refusal summary must not contain success words: " + leaks.join(" | "));
  else ok("I4 access refusal summaries are honest refusals (no success words)");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
