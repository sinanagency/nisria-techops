// Creator-default-assignee wall (2026-06-20, KT #333). "Remind me to X" was
// landing as a task with assignee_id = NULL (unassigned), not assigned to the
// speaker (Nur). That single upstream bug caused three downstream symptoms:
//   1. the self-assign alert guard (KT #329) could not fire — with no assignee
//      there is no "self" to compare, so the "new task" ping went out anyway;
//   2. the timed reminder had no clear owner;
//   3. the recurring "unassigned duplicate" tasks (Mamoun x2 tonight).
//
// Fix: in create_task, you OWN WHAT YOU CREATE — if no assignee resolved and the
// speaker is a known member, default the assignee to the speaker, for ALL tiers
// (the team-tier block already did this; extend it to owners like Nur). Must sit
// BEFORE assertTaskAccess so the gate sees the resolved self-assignment.
//
// Seams (checked in the create_task assignee region):
//   S1  a creator-default resolves the speaker (findMemberByPhone) when !member
//   S2  it is NOT gated behind `ctx.tier === "team"` (owners get it too)
//   S3  it runs BEFORE assertTaskAccess (the gate sees member set)
//   S4  the insert writes assignee_id from member, so a self-reminder is not null
//
// Pure local.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SMART = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "smart-tools.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

// Region: from the assignee resolution to the task insert.
const start = SMART.indexOf("ACCESS CONTROL (P0)");
// back-window widened 900 -> 2200 (KT #378): the open-dup guard now sits between the
// creator-default block and ACCESS CONTROL, pushing the block further back.
const region = start >= 0 ? SMART.slice(start - 2200, start + 900) : "";

// ---- S1: creator-default exists ----
if (!/CREATOR-DEFAULT|you own what you create|owns? what (you|they) create/i.test(region)) fail("S1 create_task must have a creator-default (assign self when no assignee)");
else ok("S1 creator-default present");

// ---- S2: not gated behind team-tier (the default must be BEFORE/outside the tier block) ----
{
  // the creator-default's findMemberByPhone must appear BEFORE the `ctx.tier === "team"` block
  const defIdx = region.search(/!member\s*&&\s*ctx\.senderPhone|if\s*\(\s*!member[\s\S]{0,80}findMemberByPhone/);
  const teamIdx = region.indexOf('ctx.tier === "team"');
  if (defIdx < 0) fail("S2 creator-default (!member && senderPhone -> findMemberByPhone) not found");
  else if (teamIdx >= 0 && defIdx > teamIdx) fail("S2 creator-default must run for ALL tiers (before the team-tier block), not only team");
  else ok("S2 creator-default applies to all tiers (owners included)");
}

// ---- S3: runs before assertTaskAccess ----
{
  const defIdx = region.search(/!member\s*&&\s*ctx\.senderPhone/);
  // match the CALL (await assertTaskAccess(...)), not the word in a comment.
  const gateIdx = region.search(/await assertTaskAccess\(/);
  if (defIdx >= 0 && gateIdx >= 0 && defIdx < gateIdx) ok("S3 creator-default runs before the assertTaskAccess call");
  else fail("S3 creator-default must run before assertTaskAccess so the gate sees the self-assignment");
}

// ---- S4: insert uses member's id for assignee_id ----
if (!/assignee_id:\s*member\?\.id/.test(SMART)) fail("S4 insert must write assignee_id from member");
else ok("S4 insert writes assignee_id from the resolved member");

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
