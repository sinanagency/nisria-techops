// Reminder-wording wall (2026-06-20, KT #331). A TIMED reminder fired for Nur's
// 9pm Mamoun task, but it went out worded as a NEW TASK: "Heads up, a new task
// for you: ... Reply DONE when it is handled." Because the timed cron's N=1 path
// delegated to pushTaskAlert(task, "new"), which sends the task_alert template
// with new-task wording. A reminder is not a new task.
//
// Fix: a "reminder" AlertKind, worded as a reminder ("Reminder: <title> at <time>
// today..."), sent FREE-FORM first (correct wording, works in the 24h window a
// same-day timed reminder usually hits) with the task_alert template as the
// out-of-window fallback only. The timed cron's N=1 path now uses "reminder".
//
// Seams:
//   S1  AlertKind includes "reminder"
//   S2  pushTaskAlert has a reminder branch worded "Reminder:" (not "a new task")
//   S3  the reminder branch sends FREE-FORM (sendTextAndLog) before the template
//   S4  pushTaskDigest N=1 delegates with "reminder", not "new"
//   S5  the timed cron threads due_time into the digest items (so the reminder
//       can name the time)
//
// Pure local.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const NOTIFY = fs.readFileSync(path.join(ROOT, "lib", "notify.ts"), "utf8");
const TIMED = fs.readFileSync(path.join(ROOT, "app", "api", "cron", "timed", "route.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

// ---- S1 ----
if (!/type AlertKind\s*=\s*[^;]*"reminder"/.test(NOTIFY)) fail("S1 AlertKind must include \"reminder\"");
else ok("S1 AlertKind includes \"reminder\"");

// ---- S2: reminder branch worded as a reminder ----
const ri = NOTIFY.indexOf('if (kind === "reminder")');
const rblock = ri >= 0 ? NOTIFY.slice(ri, ri + 900) : "";
if (ri < 0) fail("S2 no reminder branch in pushTaskAlert");
else if (!/Reminder:/.test(rblock)) fail("S2 reminder branch must be worded 'Reminder:' (not 'a new task for you')");
else ok("S2 reminder branch worded as a reminder");

// ---- S3: free-form first, template fallback ----
if (!/sendTextAndLog/.test(rblock)) fail("S3 reminder must try free-form sendTextAndLog first");
else if (!/sendTemplateAndLog/.test(rblock)) fail("S3 reminder must keep the template as out-of-window fallback");
else ok("S3 reminder sends free-form first, template fallback");

// ---- S4: digest N=1 uses "reminder" ----
{
  const di = NOTIFY.indexOf("list.length === 1");
  const dblock = di >= 0 ? NOTIFY.slice(di, di + 250) : "";
  if (!/pushTaskAlert\(db,\s*list\[0\],\s*"reminder"\)/.test(dblock)) fail("S4 pushTaskDigest N=1 must delegate with \"reminder\", not \"new\"");
  else ok("S4 pushTaskDigest N=1 delegates as a reminder");
}

// ---- S5: timed cron threads due_time ----
if (!/due_time:\s*t\.due_time/.test(TIMED)) fail("S5 timed cron must pass due_time into the digest items");
else ok("S5 timed cron threads due_time for the reminder");

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
