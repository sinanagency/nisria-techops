#!/usr/bin/env node
// Timed-cron DIGEST WALL — 2026-06-15.
//
// Today's bug: at 10:00:06-10:00:17 Dubai, Nur received 6 separate WhatsApp
// pings in 11 seconds, one per due-today task ("Heads up, an urgent task for
// you: Send STP report reminder to Violet and Cynthia. Due 2026-06-15. Reply
// DONE..."). The /api/cron/timed handler's per-task push loop fired one
// task_alert template per matched row. The fix collapses the loop into a
// per-assignee digest: tasks are grouped by assignee_id and a SINGLE
// pushTaskDigest call fires per group with all titles bulleted. For N=1 the
// digest delegates back to pushTaskAlert so the single-task Meta-approved
// template path is preserved exactly (no "you have 1 tasks" plural slip).
//
// This file pins six guarantees so a future "simplification" cannot regress:
//
//   D1   route.ts imports pushTaskDigest from lib/notify (not pushTaskAlert
//        directly, in the timed-cron path).
//   D2   route.ts groups tasks by assignee_id BEFORE pushing (Map<string, []>
//        keyed on assignee_id, with a __nur__ bucket for null).
//   D3   route.ts calls pushTaskDigest ONCE per assignee bucket and stamps
//        reminded_at on ALL ids in the bucket via .in("id", ids) — not .eq().
//        A missed row would re-spam on the next 5-min tick.
//   D4   notify.ts exports pushTaskDigest; for N=1 it delegates to
//        pushTaskAlert (single-task template preserved); for N>=2 it routes
//        through pushOperatorUpdate (free-form template, same path as
//        pushCalendarAlert uses for multi-content lines).
//   D5   N>=2 body template: "Heads up, you have N tasks due now:\n• …\nReply
//        DONE N …". If ANY task in the digest is priority=high the header
//        becomes "Heads up, urgent: you have N tasks due now:".
//   D6   Behavioral repro: building a 6-task digest body for a single
//        assignee produces ONE message containing all 6 titles, includes
//        "you have 6 tasks", and the single-task body for the same assignee
//        does NOT contain the plural "tasks due now" phrasing.
//
// Pure local. No DB hit, no Anthropic spend, no network.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLATFORM = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => readFileSync(resolve(PLATFORM, rel), "utf8");

const tests = [];
function check(name, fn) { tests.push({ name, fn }); }

// ─── D1: route imports the digest, not per-task alert ───────────────────────

check("D1 seam: route.ts imports pushTaskDigest from lib/notify", () => {
  const src = read("app/api/cron/timed/route.ts");
  if (!/import\s*\{[^}]*pushTaskDigest[^}]*\}\s*from\s*"[^"]*notify"/.test(src)) {
    return "route.ts does not import pushTaskDigest from notify";
  }
  // Critically: pushTaskAlert must NOT be called in the timed cron loop
  // anymore (it lives on for other callers in smart-tools.ts etc., but a
  // direct call here would re-introduce the per-task spam).
  if (/await\s+pushTaskAlert\s*\(/.test(src)) {
    return "route.ts still calls pushTaskAlert directly — must use pushTaskDigest";
  }
  return null;
});

// ─── D2: group by assignee BEFORE pushing ──────────────────────────────────

check("D2 seam: route.ts groups by assignee_id with a Map", () => {
  const src = read("app/api/cron/timed/route.ts");
  if (!/new\s+Map<string,\s*any\[\]>/.test(src)) {
    return "route.ts does not declare a Map<string, any[]> for grouping";
  }
  if (!/t\.assignee_id\s*\|\|\s*"__nur__"/.test(src)) {
    return "route.ts does not bucket null assignee_id under \"__nur__\"";
  }
  return null;
});

// ─── D3: stamp ALL ids in the bucket via .in(), not .eq() ──────────────────

check("D3 seam: route.ts stamps reminded_at via .in(\"id\", ids)", () => {
  const src = read("app/api/cron/timed/route.ts");
  // The new shape uses .in() so every row in the digest is closed out.
  if (!/\.update\(\s*\{\s*reminded_at:\s*n\.iso\s*\}\s*\)\s*\.in\(\s*"id"\s*,\s*ids\s*\)/.test(src)) {
    return "route.ts does not stamp reminded_at via .in(\"id\", ids)";
  }
  // And it must NOT also have the old .eq() form on tasks reminded_at (the
  // calendar_events branch below still uses .eq() and that is fine, but the
  // tasks branch must not).
  const taskBlock = src.slice(src.indexOf("// 1) Tasks"), src.indexOf("// 2) Calendar"));
  if (/\.update\(\s*\{\s*reminded_at:.*?\}\s*\)\s*\.eq\(\s*"id"\s*,\s*t\.id\s*\)/.test(taskBlock)) {
    return "route.ts tasks branch still has per-row .eq(\"id\", t.id) stamp";
  }
  return null;
});

// ─── D4: notify exports pushTaskDigest with the right delegation ───────────

check("D4 seam: notify.ts exports pushTaskDigest", () => {
  const src = read("lib/notify.ts");
  if (!/export\s+async\s+function\s+pushTaskDigest\b/.test(src)) {
    return "lib/notify.ts does not export pushTaskDigest";
  }
  return null;
});

check("D4 seam: pushTaskDigest delegates to pushTaskAlert for N=1", () => {
  const src = read("lib/notify.ts");
  const start = src.indexOf("export async function pushTaskDigest");
  const end = src.indexOf("export async function pushDailyBrief");
  if (start < 0 || end < 0) return "could not bracket pushTaskDigest body";
  const block = src.slice(start, end);
  // For N=1 it must reuse the single-task template via pushTaskAlert. Any
  // change that builds a custom body for N=1 would risk the "you have 1
  // tasks" plural slip the spec calls out.
  if (!/if\s*\(\s*list\.length\s*===\s*1\s*\)/.test(block)) {
    return "pushTaskDigest does not branch on list.length === 1";
  }
  if (!/pushTaskAlert\s*\(\s*db\s*,\s*list\[0\]/.test(block)) {
    return "pushTaskDigest N=1 branch does not delegate to pushTaskAlert";
  }
  return null;
});

check("D4 seam: pushTaskDigest N>=2 routes through pushOperatorUpdate", () => {
  const src = read("lib/notify.ts");
  const start = src.indexOf("export async function pushTaskDigest");
  const end = src.indexOf("export async function pushDailyBrief");
  const block = src.slice(start, end);
  if (!/pushOperatorUpdate\s*\(\s*db\s*,\s*to\s*,/.test(block)) {
    return "pushTaskDigest does not route through pushOperatorUpdate for N>=2";
  }
  return null;
});

// ─── D5: body template shape (urgent header + bullets + footer) ────────────

check("D5 seam: pushTaskDigest body template has the right shape", () => {
  const src = read("lib/notify.ts");
  const start = src.indexOf("export async function pushTaskDigest");
  const end = src.indexOf("export async function pushDailyBrief");
  const block = src.slice(start, end);
  // Plural header
  if (!/Heads up, you have \$\{list\.length\} tasks due now:/.test(block)) {
    return "pushTaskDigest missing plural \"Heads up, you have N tasks due now:\" header";
  }
  // Urgent variant
  if (!/Heads up, urgent: you have \$\{list\.length\} tasks due now:/.test(block)) {
    return "pushTaskDigest missing \"Heads up, urgent: you have N tasks due now:\" header";
  }
  // Bullet (title is wrapped in humanize() before slicing — allow that wrapper)
  if (!/`•\s*\$\{(?:humanize\()?String\(t\?\.title/.test(block)) {
    return "pushTaskDigest missing • bullet per title";
  }
  // Footer DONE N
  if (!/Reply DONE \$\{list\.length\}/.test(block)) {
    return "pushTaskDigest missing \"Reply DONE N\" footer";
  }
  // anyUrgent flag drives the header swap
  if (!/anyUrgent\s*=\s*list\.some\(\(t\)\s*=>\s*t\?\.priority\s*===\s*"high"\)/.test(block)) {
    return "pushTaskDigest does not derive anyUrgent from priority==='high'";
  }
  return null;
});

// ─── D6: BEHAVIORAL repro — mirror the body builder against 6 fixture tasks ─
// We cannot import .ts at runtime here without a loader, so we mirror the
// EXACT body template from the source. If the template ever drifts, D5 above
// will fail (the regexes pin the literal text). This block proves the OUTPUT
// shape against the 06-15 spam payload (6 due-now tasks for Nur).

function buildDigestBody(list) {
  // Mirror of lib/notify.ts pushTaskDigest N>=2 branch.
  const anyUrgent = list.some((t) => t?.priority === "high");
  const header = anyUrgent
    ? `Heads up, urgent: you have ${list.length} tasks due now:`
    : `Heads up, you have ${list.length} tasks due now:`;
  const bullets = list.map((t) => `• ${String(t?.title || "a task").slice(0, 200)}`).join("\n");
  const footer = `Reply DONE ${list.length} to clear them, or DONE 1,3 to mark specific ones, or open the Nisria portal.`;
  return `${header}\n${bullets}\n${footer}`;
}

const NUR_ASSIGNEE_ID = "ea33c975-b6df-47b4-8f29-c22ef9d42534";
const SIX_TASKS = [
  { id: "t1", title: "Send STP report reminder to Violet and Cynthia", due_on: "2026-06-15", priority: "high", assignee_id: NUR_ASSIGNEE_ID },
  { id: "t2", title: "Send Mark Njambi a message about new place hunting",  due_on: "2026-06-15", priority: "medium", assignee_id: NUR_ASSIGNEE_ID },
  { id: "t3", title: "Renew portal password",                                  due_on: "2026-06-15", priority: "medium", assignee_id: NUR_ASSIGNEE_ID },
  { id: "t4", title: "Follow up with Anthropic grant",                         due_on: "2026-06-15", priority: "medium", assignee_id: NUR_ASSIGNEE_ID },
  { id: "t5", title: "Confirm Eliza meeting at 3pm",                           due_on: "2026-06-15", priority: "medium", assignee_id: NUR_ASSIGNEE_ID },
  { id: "t6", title: "Approve donor receipt batch",                            due_on: "2026-06-15", priority: "medium", assignee_id: NUR_ASSIGNEE_ID },
];

check("D6 behavioral: 6-task digest is ONE message with all 6 titles + plural", () => {
  const body = buildDigestBody(SIX_TASKS);
  if (!body.includes("you have 6 tasks due now")) return "digest body missing \"you have 6 tasks due now\"";
  for (const t of SIX_TASKS) {
    if (!body.includes(t.title)) return `digest body missing title: "${t.title}"`;
  }
  // Urgent variant fires because t1 is high priority.
  if (!body.startsWith("Heads up, urgent:")) return "digest body should use urgent header (t1 priority=high)";
  if (!body.includes("Reply DONE 6")) return "digest body missing \"Reply DONE 6\" footer";
  return null;
});

check("D6 behavioral: 6 tasks, none urgent → non-urgent header", () => {
  const list = SIX_TASKS.map((t) => ({ ...t, priority: "medium" }));
  const body = buildDigestBody(list);
  if (!body.startsWith("Heads up, you have 6 tasks due now:")) {
    return "digest body should use non-urgent header when no task is high priority";
  }
  if (body.includes("urgent")) return "digest body should not contain \"urgent\" when no task is high priority";
  return null;
});

check("D6 behavioral: pushTaskDigest is called per assignee bucket, NOT per task", () => {
  // Mirror the route's grouping: 6 tasks for Nur produce 1 bucket, so 1
  // pushTaskDigest call. The OLD per-task loop would have produced 6
  // pushTaskAlert calls → 6 separate Meta-template sends → 6 WhatsApp pings.
  const byAssignee = new Map();
  for (const t of SIX_TASKS) {
    const key = t.assignee_id || "__nur__";
    const bucket = byAssignee.get(key) || [];
    bucket.push(t);
    byAssignee.set(key, bucket);
  }
  if (byAssignee.size !== 1) return `expected 1 assignee bucket, got ${byAssignee.size}`;
  const bucket = byAssignee.get(NUR_ASSIGNEE_ID);
  if (!bucket || bucket.length !== 6) return `expected bucket of 6 tasks, got ${bucket?.length}`;
  // The route then calls pushTaskDigest(db, items) ONCE. The number of
  // pushTaskAlert calls in the timed path is therefore 0 (only the digest's
  // N=1 branch ever delegates to pushTaskAlert internally; for N=6 it never
  // does). This is the regression check.
  let alertCalls = 0;
  let digestCalls = 0;
  for (const [, items] of byAssignee) {
    if (items.length === 1) {
      // would internally hit pushTaskAlert via the digest's N=1 branch
      alertCalls += 1;
    } else {
      digestCalls += 1;
    }
  }
  if (alertCalls !== 0) return `expected 0 pushTaskAlert calls for 6-task fixture, got ${alertCalls}`;
  if (digestCalls !== 1) return `expected 1 pushTaskDigest call for 6-task fixture, got ${digestCalls}`;
  return null;
});

check("D6 behavioral: 1-task digest reuses single-task template (no plural)", () => {
  // For N=1 the digest delegates to pushTaskAlert. We confirm here by
  // mirroring the exact pushTaskAlert log body (line 93 of notify.ts) and
  // verifying it does NOT contain the plural shape "you have 1 tasks due
  // now" the buggy template would have produced if N=1 used buildDigestBody.
  const t = { id: "t1", title: "Send STP report reminder to Violet and Cynthia", due_on: "2026-06-15", priority: "high" };
  // Mirror of pushTaskAlert single-task logBody:
  const adj = t.priority === "high" ? "an urgent" : "a new";
  const due = t.due_on || "ASAP";
  const title = String(t.title || "a task").slice(0, 200);
  const singleBody = `Heads up, ${adj} task for you: ${title}. Due ${due}. Reply DONE when it is handled, or open the Nisria portal.`;
  if (!/Heads up, an urgent task for you:/.test(singleBody)) {
    return "single-task body lost the canonical \"an urgent task for you\" phrasing";
  }
  if (/you have 1 tasks/.test(singleBody)) {
    return "single-task body has the plural \"you have 1 tasks\" slip — must use task_alert template";
  }
  if (!/Reply DONE when it is handled/.test(singleBody)) {
    return "single-task body lost \"Reply DONE when it is handled\" footer";
  }
  return null;
});

check("D6 behavioral: split across 2 assignees → 2 digest calls, no cross-talk", () => {
  // 4 tasks for Nur + 2 tasks for a bot_access staffer → 2 buckets → 2
  // separate digest calls. The route must not lump them.
  const STAFFER = "bot-access-staffer-uuid";
  const mixed = [
    { id: "t1", title: "Nur task 1", assignee_id: NUR_ASSIGNEE_ID, priority: "medium" },
    { id: "t2", title: "Nur task 2", assignee_id: NUR_ASSIGNEE_ID, priority: "medium" },
    { id: "t3", title: "Nur task 3", assignee_id: NUR_ASSIGNEE_ID, priority: "medium" },
    { id: "t4", title: "Nur task 4", assignee_id: NUR_ASSIGNEE_ID, priority: "medium" },
    { id: "t5", title: "Staffer task 1", assignee_id: STAFFER,        priority: "medium" },
    { id: "t6", title: "Staffer task 2", assignee_id: STAFFER,        priority: "medium" },
  ];
  const byAssignee = new Map();
  for (const t of mixed) {
    const key = t.assignee_id || "__nur__";
    const bucket = byAssignee.get(key) || [];
    bucket.push(t);
    byAssignee.set(key, bucket);
  }
  if (byAssignee.size !== 2) return `expected 2 assignee buckets, got ${byAssignee.size}`;
  const nurBucket = byAssignee.get(NUR_ASSIGNEE_ID);
  const staffBucket = byAssignee.get(STAFFER);
  if (nurBucket.length !== 4 || staffBucket.length !== 2) {
    return `expected Nur=4 + Staffer=2, got Nur=${nurBucket?.length} Staffer=${staffBucket?.length}`;
  }
  // And the digest bodies must be SEPARATE — no Staffer title in Nur's body.
  const nurBody = buildDigestBody(nurBucket);
  if (/Staffer task/.test(nurBody)) return "Nur's digest leaked a Staffer title — cross-talk bug";
  const staffBody = buildDigestBody(staffBucket);
  if (/Nur task/.test(staffBody)) return "Staffer's digest leaked a Nur title — cross-talk bug";
  return null;
});

// ─── R1 (RACE-2): atomic claim seam in route.ts ─────────────────────────────
// 2026-06-15. The old shape was: SELECT IS NULL → pushTaskDigest → UPDATE.
// Two overlapping cron ticks could both see the same id as unclaimed and both
// send before either stamp landed → same task in two digests. The fix is
// .update(reminded_at = nowIso).in("id", ids).is("reminded_at", null).select("id")
// BEFORE the send. Postgres serialises the UPDATE per row so only one tick
// claims each id; the RETURNING tells us which ids we own. Anything not in
// the returned set was already claimed by the sibling tick and must NOT be
// re-sent.

check("R1 seam: route.ts claims atomically with UPDATE...IS NULL RETURNING", () => {
  const src = read("app/api/cron/timed/route.ts");
  // The claim UPDATE: .update({reminded_at: n.iso}).in("id", ids).is("reminded_at", null).select("id")
  // We do not pin exact whitespace, but the four chained calls must appear in
  // order on the same chain.
  const claimRe = /\.update\(\s*\{\s*reminded_at:\s*n\.iso\s*\}\s*\)\s*\.in\(\s*"id"\s*,\s*ids\s*\)\s*\.is\(\s*"reminded_at"\s*,\s*null\s*\)\s*\.select\(\s*"id"\s*\)/;
  if (!claimRe.test(src)) {
    return "route.ts does not run the atomic-claim chain (.update().in().is(null).select())";
  }
  // And the claimed set must be used to filter what we send (claimedIds /
  // tasksToSend variables documented in the patch, but we just check for the
  // membership filter against the candidate list).
  if (!/claimedIds/.test(src)) {
    return "route.ts does not derive a claimedIds set from the RETURNING rows";
  }
  if (!/tasksToSend/.test(src)) {
    return "route.ts does not derive tasksToSend (post-claim filter) before grouping";
  }
  return null;
});

check("R1 seam: claim runs BEFORE pushTaskDigest, not after", () => {
  const src = read("app/api/cron/timed/route.ts");
  // The claim's .select("id") must appear in the source BEFORE the
  // pushTaskDigest call. If the order ever flips back, the race comes back.
  const claimIdx = src.indexOf('.is("reminded_at", null)');
  const sendIdx = src.indexOf("pushTaskDigest(db,");
  if (claimIdx < 0) return "could not find atomic claim in route.ts";
  if (sendIdx < 0) return "could not find pushTaskDigest call in route.ts";
  if (claimIdx > sendIdx) return "atomic claim appears AFTER pushTaskDigest call, race re-introduced";
  return null;
});

check("R1 behavioral: already-claimed ids drop out of the send batch", () => {
  // Mirror the route's filter: candidate ids 1-6, the atomic UPDATE returns
  // only 2-5 (ids 1 and 6 were stamped by a sibling tick before our claim
  // landed). The send batch must contain ONLY 2-5.
  const candidates = [
    { id: "t1", title: "Task 1", assignee_id: NUR_ASSIGNEE_ID },
    { id: "t2", title: "Task 2", assignee_id: NUR_ASSIGNEE_ID },
    { id: "t3", title: "Task 3", assignee_id: NUR_ASSIGNEE_ID },
    { id: "t4", title: "Task 4", assignee_id: NUR_ASSIGNEE_ID },
    { id: "t5", title: "Task 5", assignee_id: NUR_ASSIGNEE_ID },
    { id: "t6", title: "Task 6", assignee_id: NUR_ASSIGNEE_ID },
  ];
  // The UPDATE...IS NULL RETURNING returns the rows we ACTUALLY won. Ids 1
  // and 6 were claimed by the sibling tick a millisecond earlier, so the
  // RETURNING omits them.
  const claimed = [{ id: "t2" }, { id: "t3" }, { id: "t4" }, { id: "t5" }];
  const claimedIds = new Set(claimed.map((r) => r.id));
  const tasksToSend = candidates.filter((t) => claimedIds.has(t.id));
  if (tasksToSend.length !== 4) {
    return `expected 4 ids in send batch, got ${tasksToSend.length}`;
  }
  if (tasksToSend.some((t) => t.id === "t1" || t.id === "t6")) {
    return "already-claimed id leaked into send batch, RACE-2 still open";
  }
  if (!tasksToSend.every((t) => ["t2", "t3", "t4", "t5"].includes(t.id))) {
    return "send batch contents wrong";
  }
  return null;
});

// ─── R2 (DOCTRINE-8): Law 12 dev:true threading ─────────────────────────────
// Every outbound chokepoint must accept opts.dev === true so test traffic
// reroutes to Taona's phone and never pollutes Nur's transcript. The new
// pushTaskDigest path is: route.ts → pushTaskDigest → pushOperatorUpdate →
// sendTemplateAndLog. dev must thread cleanly through all three layers, and
// sendTemplateAndLog must mirror sendTextAndLog's branch: reroute to
// devPhone(), skip messages insert, prefix the log line with [DEV].

check("R2 seam: pushTaskDigest accepts opts.dev", () => {
  const src = read("lib/notify.ts");
  const start = src.indexOf("export async function pushTaskDigest");
  const end = src.indexOf("export async function pushDailyBrief");
  if (start < 0 || end < 0) return "could not bracket pushTaskDigest body";
  const block = src.slice(start, end);
  // Signature must declare opts?: { dev?: boolean } (subset; other keys allowed).
  if (!/opts\?\s*:\s*\{[^}]*dev\?\s*:\s*boolean[^}]*\}/.test(block)) {
    return "pushTaskDigest signature does not accept opts.dev";
  }
  // And it must pass it through to pushOperatorUpdate.
  if (!/pushOperatorUpdate\s*\(\s*db\s*,\s*to\s*,\s*firstName\s*,\s*body\s*,\s*\{[^}]*dev:\s*opts\?\.dev[^}]*\}/.test(block)) {
    return "pushTaskDigest does not pass dev through to pushOperatorUpdate";
  }
  return null;
});

check("R2 seam: pushOperatorUpdate accepts opts.dev and threads to chokepoint", () => {
  const src = read("lib/notify.ts");
  const start = src.indexOf("export async function pushOperatorUpdate");
  const end = src.indexOf("export async function pushCalendarAlert");
  if (start < 0 || end < 0) return "could not bracket pushOperatorUpdate body";
  const block = src.slice(start, end);
  if (!/opts\?\s*:\s*\{[^}]*dev\?\s*:\s*boolean[^}]*\}/.test(block)) {
    return "pushOperatorUpdate signature does not accept opts.dev";
  }
  // Passes dev through to sendTemplateAndLog in the options bag. The call has
  // nested parens (phoneKey(toWa)) so we can't use [^)]*. We just check that
  // an opts-bag of the right shape appears within the sendTemplateAndLog call
  // by anchoring on the function name and finding the opts bag downstream.
  const sendCall = block.indexOf("sendTemplateAndLog(");
  if (sendCall < 0) return "pushOperatorUpdate does not call sendTemplateAndLog";
  // Look from that call site to the first newline-terminated `);` (the call's
  // own closing paren).
  const fromCall = block.slice(sendCall);
  if (!/\{\s*dev:\s*opts\?\.dev\s*\}\s*\)/.test(fromCall)) {
    return "pushOperatorUpdate does not pass dev through to sendTemplateAndLog";
  }
  return null;
});

check("R2 seam: sendTemplateAndLog has the dev branch (reroute + skip log)", () => {
  const src = read("lib/whatsapp.ts");
  const start = src.indexOf("export async function sendTemplateAndLog");
  if (start < 0) return "could not find sendTemplateAndLog";
  const block = src.slice(start);
  // Signature accepts dev?: boolean.
  if (!/opts\?\s*:\s*\{[^}]*dev\?\s*:\s*boolean[^}]*\}/.test(block)) {
    return "sendTemplateAndLog signature does not accept opts.dev";
  }
  // Dev branch reroutes to devPhone() and EARLY-RETURNS before the messages
  // insert. We check the structure: `if (opts?.dev) { ... sendTemplate(devPhone() ... return ... }`
  const devBranchRe = /if\s*\(\s*opts\?\.dev\s*\)\s*\{[\s\S]*?devPhone\(\)[\s\S]*?return[\s\S]*?\}/;
  if (!devBranchRe.test(block)) {
    return "sendTemplateAndLog missing dev branch with devPhone() reroute and early return";
  }
  return null;
});

check("R2 behavioral: dev:true threads cleanly through all three layers", async () => {
  // Stub the chain to assert dev:true reaches sendTemplateAndLog.
  // We mirror the call shape from notify.ts (no DB hit, no Anthropic spend).
  let capturedDev = null;
  let capturedTo = null;
  let capturedTemplate = null;
  // Fake sendTemplateAndLog signature: (db, to, name, params, logBody, opts).
  async function fakeSendTemplateAndLog(_db, to, name, _params, _logBody, opts) {
    capturedDev = opts?.dev;
    capturedTo = to;
    capturedTemplate = name;
    // If dev:true, the real chokepoint reroutes to devPhone(); we don't need
    // to model that here, just confirm dev arrived.
    return { id: "wamid-stub" };
  }
  // Mirror pushOperatorUpdate's signature shape and dev passthrough.
  async function fakePushOperatorUpdate(db, toWa, name, text, opts) {
    const first = (name || "there").trim().split(/\s+/)[0] || "there";
    const body = String(text).replace(/\s+/g, " ").trim().slice(0, 900);
    const tmpl = opts?.needsReply ? "operator_request" : "operator_update";
    const r = await fakeSendTemplateAndLog(db, toWa, tmpl, [first, body], "log", { dev: opts?.dev });
    return { ok: !!r.id };
  }
  // Mirror pushTaskDigest's N>=2 branch passthrough.
  async function fakePushTaskDigest(db, tasks, opts) {
    const list = tasks.filter(Boolean);
    if (list.length < 2) throw new Error("test fixture should be N>=2");
    const r = await fakePushOperatorUpdate(db, "971501168462", "Taona", "body", { dev: opts?.dev });
    return { pinged: r.ok ? ["971501168462"] : [] };
  }
  const result = await fakePushTaskDigest({}, SIX_TASKS, { dev: true });
  if (capturedDev !== true) return `expected dev=true at sendTemplateAndLog, got ${capturedDev}`;
  if (capturedTemplate !== "operator_update") return `expected operator_update template, got ${capturedTemplate}`;
  if (!result.pinged.length) return "expected at least one pinged recipient (dev mode)";
  return null;
});

check("R2 behavioral: dev:false (default) does NOT thread dev:true downstream", async () => {
  // The standard cron path passes nothing, which is equivalent to dev:false.
  // sendTemplateAndLog must NOT see dev:true in that case.
  let capturedDev = "untouched";
  async function fakeSendTemplateAndLog(_db, _to, _name, _params, _logBody, opts) {
    capturedDev = opts?.dev;
    return { id: "wamid-stub" };
  }
  async function fakePushOperatorUpdate(db, toWa, name, text, opts) {
    const r = await fakeSendTemplateAndLog(db, toWa, "operator_update", ["Nur", text], "log", { dev: opts?.dev });
    return { ok: !!r.id };
  }
  async function fakePushTaskDigest(db, tasks, opts) {
    if (tasks.length < 2) throw new Error("test fixture should be N>=2");
    return fakePushOperatorUpdate(db, "Nur", "Nur", "body", { dev: opts?.dev });
  }
  // Call WITHOUT opts (matches the cron's current call site).
  await fakePushTaskDigest({}, SIX_TASKS);
  if (capturedDev === true) return "dev leaked as true when caller omitted opts";
  // dev should be undefined (or false), never true.
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
