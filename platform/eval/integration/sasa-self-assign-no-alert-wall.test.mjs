// Self-assignment no-alert wall (2026-06-20, KT #329). The "new task" task_alert
// template ("Heads up, a new task for you...") is for when work lands on SOMEONE
// ELSE. If the creator assigns a task to THEMSELVES ("remind me to ..."), pinging
// them about a task they just typed is wrong (operator call, 2026-06-20: Nur set
// her own Mamoun reminder and got the template).
//
// Fix: in create_task, suppress the urgent pushTaskAlert("new") when the assignee
// resolves to the same person as the creator (senderMember.id === member.id).
// CRITICAL: this must NOT touch the timed-reminder path (/api/cron/timed ->
// pushTaskDigest) — a self-set 9pm reminder must still ping at 9pm. Only the
// redundant new-task alert is suppressed.
//
// Seams:
//   S1  create_task computes a self-assignment check (senderMember vs member.id)
//   S2  the urgent pushTaskAlert("new") is gated on !selfAssigned
//   S3  the timed cron (/api/cron/timed) does NOT suppress on self-assignment
//       (no selfAssigned gate there) -> self-set reminders still fire
//
// Pure local.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const SMART = fs.readFileSync(path.join(ROOT, "lib", "smart-tools.ts"), "utf8");
const TIMED = fs.readFileSync(path.join(ROOT, "app", "api", "cron", "timed", "route.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

// Isolate the create_task urgent/alert region.
const i = SMART.indexOf("URGENT GATE");
const region = i >= 0 ? SMART.slice(i - 400, i + 1600) : "";

// ---- S1 ----
if (!/selfAssigned/.test(region) || !/senderMember/.test(region)) fail("S1 create_task must compute a self-assignment check (senderMember vs member.id)");
else if (!/senderMember\??\.id\s*===\s*member\??\.id|member\??\.id\s*===\s*senderMember\??\.id/.test(region)) fail("S1 selfAssigned must compare senderMember.id to member.id");
else ok("S1 create_task computes selfAssigned (senderMember.id === member.id)");

// ---- S2 ----
if (!/if\s*\(\s*urgent\s*&&\s*!selfAssigned\s*\)\s*await pushTaskAlert/.test(region.replace(/\s+/g, " ")) &&
    !/urgent\s*&&\s*!selfAssigned[\s\S]{0,40}pushTaskAlert/.test(region)) fail("S2 the urgent pushTaskAlert('new') must be gated on !selfAssigned");
else ok("S2 urgent pushTaskAlert gated on !selfAssigned");

// ---- S3: timed reminder path must NOT be suppressed by self-assignment ----
if (/selfAssigned/.test(TIMED)) fail("S3 the timed cron must NOT suppress self-assigned tasks (self reminders must still fire)");
else ok("S3 timed reminder path untouched (self-set reminders still fire)");

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
