// Singular-passive-edit verified wall (2026-06-21, KT #342). The live SANARA lie:
// "Done. The SANARA graduation task is now correctly set to July 10. Sorry it
// didn't fully update last time." — a SINGULAR PASSIVE edit claim that escaped
// AGENT_COMPLETION (first-person only), DONE_SIMPLE (done/complete only), and
// PASSIVE_COMPLETION (plural only, KT #274), so a fabricated date change shipped
// with NO update_task / move_event run. The model self-corrected a turn later, but
// the lie went out first. Fix: claimsSingularEditWithoutSuccess substitutes an
// honest reask when the claim is made and no task/event mutation succeeded.
//
// Seams:
//   S1  the detector + its regexes exist in sasa.ts
//   S2  it is wired into the substitution chain (before claimsCompletionWithoutSuccess)
//       and emits sasa.singular_edit_unverified
//   S3  behavioural: the SANARA lie (no tool) is CAUGHT; the SAME claim WITH a
//       successful update_task/move_event PASSES; a status report ("is set for
//       July 3", no change) is NOT caught; an active first-person form is left to
//       the existing guard (not our concern here)
//
// Pure local.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SASA = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "agents", "sasa.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

// ---- S1 ----
if (!/function claimsSingularEditWithoutSuccess\(/.test(SASA) || !/SINGULAR_EDIT_CLAIM\s*=/.test(SASA)) fail("S1 sasa.ts must define claimsSingularEditWithoutSuccess + its regex");
else ok("S1 singular-edit detector present");

// ---- S2 ----
{
  if (!/else if \(claimsSingularEditWithoutSuccess\(reply, toolRuns\)/.test(SASA)) fail("S2 the detector must be wired into the substitution else-if chain");
  else if (!/sasa\.singular_edit_unverified/.test(SASA)) fail("S2 must emit sasa.singular_edit_unverified for observability");
  else {
    // must run BEFORE the generic claimsCompletionWithoutSuccess branch
    const iMine = SASA.indexOf("else if (claimsSingularEditWithoutSuccess");
    const iGen = SASA.indexOf("else if (claimsCompletionWithoutSuccess(reply, toolRuns) && !isCapabilityQuestion");
    if (iMine < 0 || iGen < 0 || iMine > iGen) fail("S2 the singular-edit branch must run before the generic completion guard");
    else ok("S2 wired before the generic guard, with an observability event");
  }
}

// ---- S3: behavioural (mirror the detector exactly) ----
{
  const TASK_TOOLS = new Set(["create_task", "update_task", "complete_task", "reopen_task", "delete_task"]);
  const EVENT_TOOLS = new Set(["create_event", "move_event", "delete_event"]);
  const TASK_OR_EVENT = new Set([...TASK_TOOLS, ...EVENT_TOOLS]);
  const SINGULAR_EDIT_CLAIM = /\b(?:task|reminder|todo|event|meeting|visit|appointment|graduation|deadline|due\s*date|date)\b[\w\s'’,-]{0,40}?\b(?:is|are|has\s+been|have\s+been|'?s)\s+(?:now\s+(?:(?:correctly|already|successfully)\s+)?(?:set|marked|scheduled|moved|changed|updated|rescheduled|pushed|shifted|reset|bumped)|(?:(?:correctly|already|successfully)\s+)?(?:moved|changed|updated|rescheduled|pushed|shifted|reset|bumped))\b[\w\s'’,-]{0,20}?\b(?:to|for|as|on)\b\s*\S/i;
  const caught = (reply, toolRuns) => {
    if (!SINGULAR_EDIT_CLAIM.test(reply)) return false;
    const succeeded = toolRuns.some((t) => TASK_OR_EVENT.has(t.name) && t.result?.ok === true);
    return !succeeded;
  };
  const LIE = "Done. The SANARA graduation task is now correctly set to July 10. Sorry it didn't fully update last time.";
  if (!caught(LIE, [])) fail("S3 the SANARA lie with NO tool run must be caught");
  else if (caught(LIE, [{ name: "update_task", result: { ok: true } }])) fail("S3 the SAME claim WITH a successful update_task must PASS (no substitution)");
  else if (caught("The donor meeting is now moved to Friday.", [{ name: "move_event", result: { ok: true } }])) fail("S3 a real move with a successful move_event must PASS");
  else if (caught("The graduation is set for July 3, as it stands now.", [])) fail("S3 a pure status report (no change verb) must NOT be caught");
  else if (!caught("Done, the Kibera visit has been rescheduled to next Tuesday.", [])) fail("S3 a passive 'rescheduled to' claim with no tool must be caught");
  else if (caught("The meeting is set for 3pm.", [])) fail("S3 a bare status 'is set for 3pm' (no now/change) must NOT be caught");
  else ok("S3 catches the fabricated edit, passes the verified edit and status reports");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
