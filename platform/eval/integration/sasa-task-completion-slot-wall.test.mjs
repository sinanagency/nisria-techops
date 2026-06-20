// task-completion slot wall (2026-06-20, KT #324). Holds the thread across a
// multi-turn team-tier completion so a team member's free-text outcome note flows
// into complete_task as its `reason` instead of being re-parsed cold as a fresh
// command.
//
// THE LIVE BUG: "Done" -> "which task?" -> "Go through STP contract" -> "what was
// the outcome?" -> note "communication must be made before any changes". With no
// pending-state, the note re-parsed cold, hit parseTaskDependency's "X before Y"
// pattern, routed to handleDep, leaked machine-talk ("I could not match both
// tasks... Try again with more of each title"), and the task was NEVER closed.
//
// Reuses the existing pending_actions CONFIRM-BEFORE-WRITE mechanism with a NEW
// kind 'complete_task_awaiting_note' + NEW status 'awaiting_note' so the payment
// confirm block (which selects status='awaiting_confirm') never grabs it.
//
// Seams:
//   S1  complete_task STAGES a slot row { kind:'complete_task_awaiting_note',
//       status:'awaiting_note', payload:{task_id,title} } on team + resolved +
//       no-reason, AFTER the access gate (so the gate still wins), best-effort.
//   S2  worker has an awaiting_note handler placed BEFORE the payment CONFIRM
//       block, with a cancel/negation escape that supersedes + falls through.
//   S3  the handler invokes complete_task via runSmartTool with the message as
//       `reason` (routes through the access gate), NOT a raw gate-bypassing DB write.
//   S4  link_task_dependency / handleDep failure path uses humanize and contains
//       NO "could not match both tasks" / "more of each title" machine-talk.
//   S5  sasa prompt forbids routing a completion note into link_task_dependency
//       or treating it as a brand-new command.
//   S6  migration extends pending_actions kind/status CHECK constraints to include
//       the new values (without it the INSERT 400s and the feature is dead in prod).
//
// Pure local: reads source as strings, no DB, no network.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const SMART = fs.readFileSync(path.join(ROOT, "lib", "smart-tools.ts"), "utf8");
const SASA = fs.readFileSync(path.join(ROOT, "lib", "agents", "sasa.ts"), "utf8");
const WORKER = fs.readFileSync(path.join(ROOT, "app", "api", "whatsapp", "worker", "route.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

// ---- S1: complete_task stages the slot, after the gate, best-effort ----
{
  const i = SMART.indexOf('name === "complete_task"');
  // window to the next tool block (reopen_task) so we only look inside complete_task
  const end = SMART.indexOf('name === "reopen_task"', i);
  const block = i >= 0 ? SMART.slice(i, end > i ? end : i + 8000) : "";
  if (i < 0) { fail("S1 complete_task impl not found"); }
  else {
    const stages = /kind:\s*"complete_task_awaiting_note"/.test(block);
    const awaitingNote = /status:\s*"awaiting_note"/.test(block);
    const payloadHasTask = /payload:\s*\{[^}]*task_id/.test(block) || /task_id:\s*task\.id/.test(block);
    if (!stages) fail("S1 complete_task must INSERT a pending_actions row kind='complete_task_awaiting_note'");
    else ok("S1 complete_task stages kind='complete_task_awaiting_note'");
    if (!awaitingNote) fail("S1 staged row must use NEW status='awaiting_note' (so the payment confirm block never grabs it)");
    else ok("S1 staged row status='awaiting_note'");
    if (!payloadHasTask) fail("S1 staged payload must carry the resolved task_id (slot knows the task)");
    else ok("S1 staged payload carries task_id");
    // the reason-ask + stage must sit AFTER the access gate (assertTaskAccess) so a
    // gate refusal still wins and we never stage an inaccessible task.
    const gateIdx = block.indexOf("assertTaskAccess");
    const stageIdx = block.indexOf('"complete_task_awaiting_note"');
    if (!(gateIdx >= 0 && stageIdx > gateIdx)) fail("S1 the slot stage must come AFTER assertTaskAccess (gate wins over stage)");
    else ok("S1 stage is placed after the access gate");
    // supersede a prior awaiting_note for this contact first (one open slot at a time)
    const supersedesPrior = /awaiting_note[\s\S]{0,400}superseded|superseded[\s\S]{0,400}awaiting_note/.test(block);
    if (!supersedesPrior) fail("S1 must supersede any prior awaiting_note for this contact (one open slot)");
    else ok("S1 supersedes prior awaiting_note slot");
  }
}

// ---- S2: worker awaiting_note handler BEFORE the payment confirm block ----
{
  const handlerIdx = WORKER.indexOf('complete_task_awaiting_note');
  const confirmIdx = WORKER.indexOf('CONFIRM-BEFORE-WRITE');
  if (handlerIdx < 0) fail("S2 worker has NO awaiting_note handler");
  else ok("S2 worker has an awaiting_note handler");
  if (confirmIdx < 0) fail("S2 could not find the CONFIRM-BEFORE-WRITE block to order against");
  else if (!(handlerIdx >= 0 && handlerIdx < confirmIdx)) fail("S2 awaiting_note handler must be placed BEFORE the payment CONFIRM-BEFORE-WRITE block");
  else ok("S2 awaiting_note handler is before the payment confirm block");
  // cancel / negation escape that supersedes + falls through (does NOT force the note)
  const hasCancelRegex = /not done|never ?mind|cancel|actually|hold on|scrap/.test(WORKER);
  if (!hasCancelRegex) fail("S2 handler must have a cancel/negation escape (no|not done|cancel|actually|...)");
  else ok("S2 handler has a cancel/negation escape");
}

// ---- S3: the fill routes through complete_task via runSmartTool (gate runs) ----
{
  // around the awaiting_note handler, the fill must call the complete_task smart-tool
  const i = WORKER.indexOf('complete_task_awaiting_note');
  const window = i >= 0 ? WORKER.slice(i, i + 3500) : "";
  const callsTool = /runSmartTool\(\s*"complete_task"/.test(window);
  const passesReason = /reason:/.test(window);
  // it must NOT be a raw tasks-update that skips the gate
  const rawUpdate = /from\("tasks"\)\s*\.update\(\s*\{\s*status:\s*"done"/.test(window);
  if (!callsTool) fail("S3 fill must invoke runSmartTool('complete_task', ...) so the access gate runs");
  else ok("S3 fill invokes complete_task via runSmartTool");
  if (!passesReason) fail("S3 fill must pass the raw message as the completion reason");
  else ok("S3 fill passes the message as reason");
  if (rawUpdate) fail("S3 fill must NOT do a raw tasks.update(status:done) that bypasses the gate");
  else ok("S3 fill does not bypass the gate with a raw update");
  // import of runSmartTool present
  if (!/runSmartTool/.test(WORKER.slice(0, WORKER.indexOf("async function processJob")))) fail("S3 worker must import runSmartTool");
  else ok("S3 worker imports runSmartTool");
}

// ---- S4: dependency failure path is humanized, no machine-talk leak ----
{
  // The live leak lived in the worker's handleDep (line ~755). It must be gone.
  if (/could not match both tasks/.test(WORKER)) fail("S4 worker handleDep still leaks 'could not match both tasks' machine-talk");
  else ok("S4 worker handleDep: no 'could not match both tasks' leak");
  if (/more of each title/.test(WORKER)) fail("S4 worker handleDep still leaks 'more of each title' machine-talk");
  else ok("S4 worker handleDep: no 'more of each title' leak");
  // the replacement must be a humanized, flag_for_clarity-style ask
  const depIdx = WORKER.indexOf("const handleDep");
  const depBlock = depIdx >= 0 ? WORKER.slice(depIdx, depIdx + 1200) : "";
  if (!/which two tasks|two task names|which blocks which/i.test(depBlock)) fail("S4 handleDep must ask a clean human question naming the two tasks");
  else ok("S4 handleDep asks a clean human question");
}

// ---- S5: sasa prompt forbids routing a completion note into a dependency ----
{
  const rule = /completion (note|outcome)[\s\S]{0,260}(link_task_dependency|dependency|brand-new command|new command)/i.test(SASA)
    || /(link_task_dependency|dependency)[\s\S]{0,260}completion (note|outcome)/i.test(SASA);
  if (!rule) fail("S5 sasa prompt must forbid interpreting a completion note as a dependency or a new command");
  else ok("S5 sasa prompt forbids routing a completion note into link_task_dependency");
}

// ---- S6: migration extends the pending_actions CHECK constraints ----
{
  const migPath = path.join(ROOT, "db", "migrations", "20260620_pending_actions_completion_slot.sql");
  if (!fs.existsSync(migPath)) fail("S6 migration db/migrations/20260620_pending_actions_completion_slot.sql is MISSING (insert 400s in prod)");
  else {
    const mig = fs.readFileSync(migPath, "utf8");
    const kindOk = /pending_actions_kind_check/.test(mig) && /complete_task_awaiting_note/.test(mig);
    const statusOk = /pending_actions_status_check/.test(mig) && /awaiting_note/.test(mig);
    // must keep the existing values too (DROP + re-ADD with full set)
    const keepsKind = /record_payment/.test(mig) && /bank_import/.test(mig) && /case_to_approve/.test(mig) && /task_cleanup/.test(mig);
    const keepsStatus = /awaiting_confirm/.test(mig) && /committed/.test(mig) && /superseded/.test(mig) && /cancelled/.test(mig);
    if (!kindOk) fail("S6 migration must extend pending_actions_kind_check with 'complete_task_awaiting_note'");
    else ok("S6 migration extends kind CHECK with complete_task_awaiting_note");
    if (!statusOk) fail("S6 migration must extend pending_actions_status_check with 'awaiting_note'");
    else ok("S6 migration extends status CHECK with awaiting_note");
    if (!keepsKind) fail("S6 migration must KEEP all existing kind values (DROP + re-ADD full set)");
    else ok("S6 migration keeps the existing kind values");
    if (!keepsStatus) fail("S6 migration must KEEP all existing status values");
    else ok("S6 migration keeps the existing status values");
    // schema.sql / canonical mirror should also carry the new values if it lists them
    const SCHEMA = fs.existsSync(path.join(ROOT, "db", "schema.sql")) ? fs.readFileSync(path.join(ROOT, "db", "schema.sql"), "utf8") : "";
    if (/pending_actions_kind_check/.test(SCHEMA) && !/complete_task_awaiting_note/.test(SCHEMA)) fail("S6 db/schema.sql lists the kind check but is missing the new value");
    else ok("S6 schema.sql mirror consistent");
  }
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
