// Assignment-notify wall (2026-06-30, Taona: "she'll mostly send tasks to team members,
// use a template to message her"). Before: create_task only template-pinged the assignee
// when the task was URGENT (urgent && !selfAssigned), so a normal "Grace, do X by Friday"
// created the task but never messaged Grace until the morning brief. After: ANY assignment
// to someone other than the creator fires the new-task template (member?.id && !selfAssigned).
// The routing in notify.ts keeps it safe: only a bot_access member gets a direct template,
// a self-assignment is skipped, and Nur is NOT double-pinged for tasks she delegates. This
// wall asserts the create_task gate widened and the notify safety invariants still hold.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

const st = readFileSync(resolve(HERE, "../../lib/smart-tools.ts"), "utf8");
const nt = readFileSync(resolve(HERE, "../../lib/notify.ts"), "utf8");

// ---- W1: create_task pings on ANY teammate assignment, not just urgent ----
{
  if (!st.includes('if (member?.id && !selfAssigned) await pushTaskAlert(db, { id: task.id, title, due_on, priority, assignee_id: member?.id || null }, "new")'))
    fail("W1 assignment ping must fire on (member?.id && !selfAssigned), via pushTaskAlert(...,'new')");
  if (/if \(urgent && !selfAssigned\) await pushTaskAlert/.test(st))
    fail("W1 the old urgent-only gate must be gone (it suppressed normal assignments)");
  ok("W1 a task assigned to a teammate now always templates them (urgent-only gate removed)");
}

// ---- W2: self-assignment is still skipped (no ping for 'remind me to ...') ----
{
  if (!/const selfAssigned = !!\(senderMember\?\.id && member\?\.id && senderMember\.id === member\.id\)/.test(st))
    fail("W2 selfAssigned guard must remain (do not ping the creator for their own task)");
  ok("W2 self-assignment guard intact (creator is not pinged about their own task)");
}

// ---- W3: notify routes a team-member task to the ASSIGNEE only (no Nur double-ping) ----
{
  if (!/teamMemberTask\s*=\s*!!assignee && assigneeHasBot && !assigneeIsOperator/.test(nt))
    fail("W3 teamMemberTask routing missing (must not double-ping Nur on every delegation)");
  if (!/teamMemberTask[\s\S]{0,80}\[assigneeWa\]\.filter\(Boolean\)/.test(nt))
    fail("W3 a team-member task must send to the assignee only");
  ok("W3 notify sends a delegated task to the teammate only, not back to Nur");
}

// ---- W4: the assignee message is a Meta template (out-of-window safe) + dedup + quiet hours ----
{
  if (!/sendTemplateAndLog\(db, to, "task_alert"/.test(nt)) fail("W4 must send via the task_alert template");
  if (!/withinQuietHours\(\)/.test(nt)) fail("W4 quiet-hours gate must remain");
  if (!/pushedRecently\(db, "task\.alert_sent"/.test(nt)) fail("W4 dedup guard must remain");
  ok("W4 assignee is templated (task_alert), quiet-hours + dedup respected");
}

// ---- W5: a non-bot-access staffer gets NO direct DM (reaches them via the group bot) ----
{
  if (!/if \(assignee && !assigneeIsOperator && !assigneeHasBot\) return \{ pinged: \[\] \}/.test(nt))
    fail("W5 a staffer with no 727 line must not get a direct DM (access model preserved)");
  ok("W5 access model preserved: only bot_access members get a direct template");
}

if (process.exitCode) console.error("\nsasa-assignment-notify-wall: FAIL");
else console.log("\nsasa-assignment-notify-wall: ALL GREEN");
