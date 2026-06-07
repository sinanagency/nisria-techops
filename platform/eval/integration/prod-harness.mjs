// PROD HARNESS — fires the 9 prompts against live production via synthetic
// Meta-signed webhooks, captures state, asserts per-test, and CLEANS UP every
// row it created. Idempotent by run_id prefix. No noise on Taona or Nur.
//
//   node platform/eval/integration/prod-harness.mjs            # full run + cleanup
//   node platform/eval/integration/prod-harness.mjs --keep     # skip cleanup (for diagnosis)
//   node platform/eval/integration/prod-harness.mjs --skip 3,8 # comma list of test ids to skip
//
// Architecture:
//   1. spawn synthetic contact + team_member (fake phone +971500000099)
//   2. for each of the 9 tests, POST a HMAC-signed webhook to /api/whatsapp/webhook
//   3. between sends, sleep enough for the worker to process
//   4. after all sends, query state by source_id and assert
//   5. cleanup: delete tasks (cascades comments + deps), synthetic team_member, synthetic contact
//
// Test 3 (@Nur) was previously SKIPPED to avoid pinging Nur. With the
// MAINTENANCE_MODE outbound gate (lib/whatsapp.ts send() drops any non-allowlist
// target), the assignment heads-up is now suppressed — the task is still created
// and assigned correctly, just not delivered to Nur. So test 3 runs by default.
//
// Costs ~$0.50 of Anthropic per full run.

import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

// ───────────────────────────────────────────────────────────────────────────
// Env load
// ───────────────────────────────────────────────────────────────────────────
const envSrc = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
for (const line of envSrc.split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!process.env[m[1]]) process.env[m[1]] = v;
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const WHATSAPP_APP_SECRET = process.env.WHATSAPP_APP_SECRET || "";
const WEBHOOK_URL = process.env.WEBHOOK_URL || "https://command.nisria.co/api/whatsapp/webhook";

if (!SUPABASE_URL || !SUPABASE_KEY) { console.error("missing supabase env"); process.exit(2); }
if (!WHATSAPP_APP_SECRET) { console.error("missing WHATSAPP_APP_SECRET"); process.exit(2); }

const args = process.argv.slice(2);
const KEEP = args.includes("--keep");
const SKIP = new Set(((args.find((a) => a.startsWith("--skip="))?.split("=")[1]) || "").split(",").filter(Boolean));

// ───────────────────────────────────────────────────────────────────────────
// Run identifiers
// ───────────────────────────────────────────────────────────────────────────
const RUN_ID = "v12harness_" + randomBytes(4).toString("hex");
// Use TAONA's real contact + team_member id because the worker gates on
// WHATSAPP_OPERATORS env (synthetic phones are silently dropped). Cleanup
// deletes tasks created in this run by source_id, never touches him.
const TEST_PHONE_DIGITS = "971501168462"; // Taona's WA
const TEST_PHONE = "+" + TEST_PHONE_DIGITS;
const TEST_NAME = `Taona`;
const TAONA_CONTACT_ID = "c16ff282-10ae-437a-a741-1e4ae8ec0e02";
const TAONA_TM_ID = "09943585-0ad9-4e07-a6cf-32f49ecfaa8c";
const NOW_ISO = "2026-06-07";

let HARNESS_CONTACT_ID = TAONA_CONTACT_ID;
let HARNESS_TM_ID = TAONA_TM_ID;
const RUN_STARTED_AT = new Date().toISOString();

// ───────────────────────────────────────────────────────────────────────────
// Supabase REST helpers
// ───────────────────────────────────────────────────────────────────────────
const SH = { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY };

async function sbGet(path) {
  const r = await fetch(SUPABASE_URL + "/rest/v1/" + path, { headers: SH });
  return [r.status, await r.json().catch(() => null)];
}
async function sbInsert(path, body) {
  const r = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    method: "POST",
    headers: { ...SH, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  return [r.status, await r.json().catch(() => null)];
}
async function sbDelete(path) {
  const r = await fetch(SUPABASE_URL + "/rest/v1/" + path, { method: "DELETE", headers: SH });
  return r.status;
}

// ───────────────────────────────────────────────────────────────────────────
// Meta webhook signing
// ───────────────────────────────────────────────────────────────────────────
function sign(body) {
  return "sha256=" + createHmac("sha256", WHATSAPP_APP_SECRET).update(body).digest("hex");
}

function wamid(label) {
  return "wamid.HARNESS_" + RUN_ID + "_" + label + "_" + randomBytes(3).toString("hex");
}

function buildTextPayload({ text, msgId }) {
  return {
    entry: [{ changes: [{ value: {
      contacts: [{ wa_id: TEST_PHONE_DIGITS, profile: { name: TEST_NAME } }],
      messages: [{ from: TEST_PHONE_DIGITS, id: msgId, type: "text", text: { body: text } }],
    }}]}],
  };
}

function buildReactionPayload({ targetWamid, emoji, msgId }) {
  return {
    entry: [{ changes: [{ value: {
      contacts: [{ wa_id: TEST_PHONE_DIGITS, profile: { name: TEST_NAME } }],
      messages: [{ from: TEST_PHONE_DIGITS, id: msgId, type: "reaction", reaction: { message_id: targetWamid, emoji } }],
    }}]}],
  };
}

async function postWebhook(payload) {
  const raw = JSON.stringify(payload);
  const signature = sign(raw);
  const r = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-hub-signature-256": signature },
    body: raw,
  });
  const text = await r.text().catch(() => "");
  if (process.env.HARNESS_DEBUG) {
    console.log(`        POST -> ${r.status} ${text.slice(0, 100)} | sig=${signature.slice(0, 20)}... | secretHead=${(WHATSAPP_APP_SECRET || "").slice(0, 8)} | bodyBytes=${raw.length}`);
  }
  return r.status;
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// ───────────────────────────────────────────────────────────────────────────
// Setup & teardown
// ───────────────────────────────────────────────────────────────────────────
async function setup() {
  // Using Taona's real contact + team_member; no insert needed.
  console.log(`setup: using real Taona contact=${HARNESS_CONTACT_ID} team_member=${HARNESS_TM_ID}`);
}

async function cleanup() {
  if (KEEP) { console.log("[--keep] skipping cleanup"); return; }
  const wamidPattern = `wamid.HARNESS_${RUN_ID}_%`;
  // Resolve our inbound messages' internal UUIDs (parseTasks tasks store
  // source_id as the internal UUID, not the external wamid).
  const [, inbound] = await sbGet(`messages?external_id=like.${encodeURIComponent(wamidPattern)}&select=id`);
  const internalIds = (Array.isArray(inbound) ? inbound : []).map((m) => m.id).filter(Boolean);
  if (internalIds.length) {
    await sbDelete(`tasks?source_id=in.(${internalIds.join(",")})`);
  }
  // Also delete tasks created in our run window whose source_id is NULL
  // (these are model-created via create_task that escaped the strip; we still
  // want them gone for cleanup). Bound by run window to be safe.
  await sbDelete(`tasks?source_id=is.null&created_at=gte.${RUN_STARTED_AT}&assignee_id=eq.${TAONA_TM_ID}`);
  // v1.3.8: also drop any harness-created beneficiaries from tests 13a/13b.
  await sbDelete(`beneficiaries?full_name=ilike.${encodeURIComponent("%Harness Test Person%")}&created_at=gte.${RUN_STARTED_AT}`);
  // delete the inbound messages we synthesized
  await sbDelete(`messages?external_id=like.${encodeURIComponent(wamidPattern)}`);
  console.log(`cleanup: ${internalIds.length} inbound msgs, deleted matching tasks + null-source tasks + Harness beneficiaries in window`);
}

// ───────────────────────────────────────────────────────────────────────────
// Test cases
// ───────────────────────────────────────────────────────────────────────────
const TESTS = [
  { id: "1", kind: "text",
    body: "Remind me to send the Anthropic grant follow-up at 2pm tomorrow",
    expect: { taskCount: 1, assigneeName: TEST_NAME, sourceKind: "parsed_task" } },
  { id: "2", kind: "text",
    body: "Today's punch list:\n- Pay Mark Njambi 30k KES for the food packages\n- Draft the Java proposal\n- Send Eunice the venue brief by Friday",
    expect: { taskCount: 3, assigneeName: TEST_NAME, sourceKind: "parsed_task" } },
  { id: "3", kind: "text",
    body: "@Nur can you confirm the Mina Zayed Maan Event by EOD",
    expect: { taskCount: 1, assigneeName: "Nur M'nasria", sourceKind: "parsed_task" } },
  { id: "4", kind: "text",
    body: "Remind me every weekday at 9am to check the soak watchdog",
    expect: { taskCount: 1, assigneeName: TEST_NAME, sourceKind: "parsed_task", recurrence: "weekdays" } },
  { id: "5", kind: "reaction_on_test_1",
    expect: { reactionFired: true, targetTaskStatus: "done", noAnthropicCall: true } },
  { id: "6", kind: "text",
    body: "Add a comment on the Java proposal task: client wants the Vertex case study attached",
    expect: { commentCount: 1 } },
  { id: "7a", kind: "text",
    body: "The Java proposal blocks the Maan Event follow-up",
    expect: { depCount: 1 } },
  { id: "7b", kind: "text",
    body: "And the Maan Event follow-up blocks the Java proposal",
    expect: { depCount: 1, cycleRefused: true } },
  { id: "8", kind: "text",
    body: "hey what's the soak status looking like",
    expect: { taskCount: 0 } },
  { id: "9a", kind: "text",
    body: "Mark the Anthropic grant task as in review",
    expect: { statusTransition: "in_review", targetTitleHas: "anthropic grant" } },
  { id: "9b", kind: "text",
    body: "Abandon the Mark Njambi reimbursement, he refused it",
    expect: { statusTransition: "abandoned", targetTitleHas: "mark njambi" } },
  // v1.3.6: priority shift via parseTaskPriority (deterministic, no model call)
  { id: "10", kind: "text",
    body: "Make the Java proposal high priority",
    expect: { priorityChange: "high", targetTitleHas: "java proposal" } },
  // v1.3.6: batch ops via parseTaskOpsBatch (two ops separated by "and")
  { id: "11", kind: "text",
    body: "Mark Send Eunice the venue brief as done and the Anthropic grant task as blocked",
    expect: { batchStatuses: { "send eunice": "done", "anthropic grant": "blocked" } } },
  // v1.3.8: number-fabrication guard. Asking Sasa to "figure out" amounts
  // without any number cue must NOT result in invented KES figures in the
  // reply. Either the reply is HONEST_NO_FIGURE, OR it asks for the number,
  // OR it contains zero specific amounts. NEVER inventing "KES 7,500" etc.
  { id: "12", kind: "text",
    body: "Help me figure out what we still owe Mark from the food packages this week",
    expect: { noFabricatedAmount: true } },
  // v1.3.8: add_beneficiary 60s idempotency. Two identical adds in quick
  // succession must produce 1 row, not 2.
  { id: "13a", kind: "text",
    body: "Add a new beneficiary named Harness Test Person to the nutrition program",
    expect: { beneficiaryCreated: "Harness Test Person" } },
  { id: "13b", kind: "text",
    body: "Add a new beneficiary named Harness Test Person to the nutrition program",
    expect: { beneficiaryDedup: "Harness Test Person", expectExactlyOne: true } },
];

// ───────────────────────────────────────────────────────────────────────────
// Run
// ───────────────────────────────────────────────────────────────────────────
const results = [];
const sentInbound = new Map(); // test id → wamid

async function runOne(test) {
  if (SKIP.has(test.id)) {
    results.push({ id: test.id, status: "SKIPPED", reason: "--skip list" });
    console.log(`[SKIP] test ${test.id}`);
    return;
  }
  console.log(`[FIRE] test ${test.id} (${test.kind})`);

  if (test.kind === "text") {
    const msgId = wamid(test.id);
    sentInbound.set(test.id, msgId);
    const payload = buildTextPayload({ text: test.body, msgId });
    const status = await postWebhook(payload);
    if (status !== 200) {
      results.push({ id: test.id, status: "FAIL", error: `webhook http=${status}` });
      console.log(`        webhook http=${status} (expected 200)`);
      return;
    }
    await sleep(25000);
    await assertText(test, msgId);
  } else if (test.kind === "reaction_on_test_1") {
    // find sasa's outbound that announced test 1's task, take its external_id
    const inbound1 = sentInbound.get("1");
    if (!inbound1) { results.push({ id: test.id, status: "FAIL", error: "test 1 didn't fire, can't react" }); return; }
    // Sasa's outbound replies after test 1 land within the previous sleep window.
    // Sasa sometimes rephrases away the task title ("that task is already on
    // your list" instead of "logged: Anthropic grant follow-up"), so a strict
    // title-substring regex can miss. Pick the FIRST in-window outbound that
    // (a) has a real Meta-assigned external_id (something Sasa actually shipped),
    // and (b) looks like a task confirmation by shape (logged | got it | done |
    // heads up | already | added | linked | marked | reminded). The reaction
    // handler in route.ts then extracts whatever title it can from that body.
    const [, outbound] = await sbGet(`messages?direction=eq.out&contact_id=eq.${HARNESS_CONTACT_ID}&created_at=gte.${RUN_STARTED_AT}&status=eq.sent&select=id,body,external_id,created_at&order=created_at.asc`);
    const target = (outbound || []).find((m) =>
      m.external_id && /\b(logged|got it|done|heads up|already|added|linked|marked|reminded|i'll remind)\b/i.test(m.body || "")
    );
    if (!target?.external_id) {
      results.push({ id: test.id, status: "FAIL", error: "no outbound external_id to react to (outbound rows=" + (outbound || []).length + ")" });
      return;
    }
    const msgId = wamid(test.id);
    const payload = buildReactionPayload({ targetWamid: target.external_id, emoji: "✅", msgId });
    const status = await postWebhook(payload);
    await sleep(15000);
    await assertReaction(test, target);
  }
}

// Resolve ALL harness inbound messages to their internal UUIDs once per run.
// tasks/comments/deps from THIS harness run are bound to one of these UUIDs
// (parseTasks tasks: source_id = internal UUID; parseTaskOps acts on tasks that
// were just created in this run; reactions act on the outbound that pointed at
// those tasks). Using the internal-UUID set is the only honest scope.
async function ourInternalIds() {
  const wamidPrefix = `wamid.HARNESS_${RUN_ID}_`;
  const [, rows] = await sbGet(`messages?external_id=like.${encodeURIComponent(wamidPrefix + "%")}&select=id`);
  return (Array.isArray(rows) ? rows : []).map((r) => r.id).filter(Boolean);
}

async function ourTaskIds() {
  const ids = await ourInternalIds();
  if (!ids.length) return [];
  const [, rows] = await sbGet(`tasks?source_id=in.(${ids.join(",")})&select=id`);
  return (Array.isArray(rows) ? rows : []).map((r) => r.id);
}

async function assertText(test, sourceMsgWamid) {
  // Resolve external wamid -> internal message UUID, then query tasks by that.
  // (parseTasks stores tasks.source_id as the INTERNAL UUID, not the external wamid.)
  const [, inboundRow] = await sbGet(`messages?external_id=eq.${sourceMsgWamid}&select=id&limit=1`);
  const internalId = Array.isArray(inboundRow) && inboundRow[0]?.id;
  if (!internalId) {
    results.push({ id: test.id, status: "FAIL", error: `no inbound row found for wamid ${sourceMsgWamid}` });
    console.log(`        FAIL: no inbound row for ${sourceMsgWamid}`);
    return;
  }
  const [, tasksRaw] = await sbGet(`tasks?source_id=eq.${internalId}&select=id,title,status,assignee_id,source_kind,recurrence`);
  const [, commentsRaw] = await sbGet(`task_comments?created_at=gte.${RUN_STARTED_AT}&select=id,task_id,body&order=created_at.desc&limit=20`);
  const [, depsRaw] = await sbGet(`task_dependencies?created_at=gte.${RUN_STARTED_AT}&select=*&order=created_at.desc&limit=20`);
  const tasks = (Array.isArray(tasksRaw) ? tasksRaw : []).filter((t) => t.source_kind === "parsed_task");
  const comments = Array.isArray(commentsRaw) ? commentsRaw : [];
  const deps = Array.isArray(depsRaw) ? depsRaw : [];
  const checks = [];

  if (test.expect.taskCount !== undefined) {
    checks.push({ label: `task_count == ${test.expect.taskCount}`, pass: (tasks || []).length === test.expect.taskCount, got: (tasks || []).length });
  }
  if (test.expect.assigneeName && (tasks || []).length > 0) {
    const ids = [...new Set((tasks || []).map((t) => t.assignee_id).filter(Boolean))];
    let names = [];
    for (const id of ids) {
      const [, tm] = await sbGet(`team_members?id=eq.${id}&select=name`);
      if (tm?.[0]?.name) names.push(tm[0].name);
    }
    const allMatch = names.every((n) => n === test.expect.assigneeName) && names.length > 0;
    checks.push({ label: `assignee_name == ${test.expect.assigneeName} (all tasks)`, pass: allMatch, got: names });
  }
  if (test.expect.sourceKind && (tasks || []).length > 0) {
    const allMatch = (tasks || []).every((t) => t.source_kind === test.expect.sourceKind);
    checks.push({ label: `source_kind == ${test.expect.sourceKind} (all tasks)`, pass: allMatch, got: (tasks || []).map((t) => t.source_kind) });
  }
  if (test.expect.recurrence && (tasks || []).length > 0) {
    checks.push({ label: `recurrence == ${test.expect.recurrence}`, pass: tasks[0].recurrence === test.expect.recurrence, got: tasks[0].recurrence });
  }
  if (test.expect.commentCount !== undefined) {
    const ourIds = await ourTaskIds();
    const ourComments = (comments || []).filter((c) => ourIds.includes(c.task_id));
    checks.push({ label: `comment_count >= ${test.expect.commentCount}`, pass: ourComments.length >= test.expect.commentCount, got: ourComments.length });
  }
  if (test.expect.depCount !== undefined) {
    const ourIds = await ourTaskIds();
    const ourDeps = (deps || []).filter((d) => ourIds.includes(d.task_id));
    checks.push({ label: `dependency_count == ${test.expect.depCount}`, pass: ourDeps.length === test.expect.depCount, got: ourDeps.length });
  }
  if (test.expect.cycleRefused) {
    // 7b doesn't add a dep (cycle), so check the OUTBOUND refusal narration
    // instead of a delta. Worker line at route.ts:577.
    const [, recentOut] = await sbGet(`messages?direction=eq.out&contact_id=eq.${HARNESS_CONTACT_ID}&created_at=gte.${RUN_STARTED_AT}&body=ilike.${encodeURIComponent("%create a cycle%")}&select=id&limit=1`);
    const refused = Array.isArray(recentOut) && recentOut.length > 0;
    checks.push({ label: `cycle refusal narrated to user`, pass: refused, got: refused });
  }
  if (test.expect.statusTransition) {
    const ourIds = await ourTaskIds();
    if (!ourIds.length) {
      checks.push({ label: `transitioned task to ${test.expect.statusTransition}`, pass: false, got: { matched: 0, candidates: [], note: "no harness-owned tasks yet" } });
    } else {
      const [, ourTasksTx] = await sbGet(`tasks?id=in.(${ourIds.join(",")})&status=eq.${test.expect.statusTransition}&select=id,title,status,updated_at`);
      const hits = (ourTasksTx || []).filter((t) => !test.expect.targetTitleHas || (t.title || "").toLowerCase().includes(test.expect.targetTitleHas));
      checks.push({ label: `transitioned task to ${test.expect.statusTransition}`, pass: hits.length >= 1, got: { matched: hits.length, candidates: (ourTasksTx || []).map((t) => t.title) } });
    }
  }
  if (test.expect.priorityChange) {
    const ourIds = await ourTaskIds();
    const [, rows] = await sbGet(`tasks?id=in.(${ourIds.join(",")})&priority=eq.${test.expect.priorityChange}&select=id,title,priority`);
    const hits = (rows || []).filter((t) => !test.expect.targetTitleHas || (t.title || "").toLowerCase().includes(test.expect.targetTitleHas));
    checks.push({ label: `priority set to ${test.expect.priorityChange}`, pass: hits.length >= 1, got: { matched: hits.length, candidates: (rows || []).map((t) => `${t.title}(${t.priority})`) } });
  }
  if (test.expect.batchStatuses) {
    const ourIds = await ourTaskIds();
    const [, allOurs] = await sbGet(`tasks?id=in.(${ourIds.join(",")})&select=id,title,status`);
    const expected = test.expect.batchStatuses;
    const matches = Object.entries(expected).map(([titleFrag, targetStatus]) => {
      const t = (allOurs || []).find((r) => (r.title || "").toLowerCase().includes(titleFrag));
      return { titleFrag, targetStatus, actual: t?.status || null, ok: t?.status === targetStatus };
    });
    const ok = matches.every((m) => m.ok);
    checks.push({ label: `batch: every op landed`, pass: ok, got: matches });
  }
  if (test.expect.noFabricatedAmount) {
    // Read Sasa's outbound reply to test 12's inbound and assert no KES/Ksh/USD/$ amount.
    const [, replies] = await sbGet(`messages?direction=eq.out&contact_id=eq.${HARNESS_CONTACT_ID}&created_at=gte.${RUN_STARTED_AT}&select=body,created_at&order=created_at.asc`);
    const after = (replies || []).filter((r) => new Date(r.created_at) > new Date(sentInbound.get(test.id + "_t") || RUN_STARTED_AT));
    // Pick the most recent outbound that looks like a real reply
    const last = (replies || [])[replies.length - 1];
    const body = last?.body || "";
    const re = /(?:KES|Ksh|USD|\$)\s*\d{2,}|\d{3,}\s*(?:KES|Ksh|USD|shillings)/i;
    const hasFigure = re.test(body);
    const honest = /(?:should not have put numbers|tell me the exact figure|what amount|how much)/i.test(body);
    checks.push({ label: `no fabricated KES/USD figure in reply (or honest ask)`, pass: !hasFigure || honest, got: { body: body.slice(0, 160), hasFigure, honest } });
  }
  if (test.expect.beneficiaryCreated) {
    const name = test.expect.beneficiaryCreated;
    const [, rows] = await sbGet(`beneficiaries?full_name=ilike.${encodeURIComponent("%" + name + "%")}&created_at=gte.${RUN_STARTED_AT}&select=id,full_name,ref_code`);
    checks.push({ label: `beneficiary created: ${name}`, pass: (rows || []).length >= 1, got: (rows || []).map((r) => r.full_name) });
  }
  if (test.expect.beneficiaryDedup) {
    const name = test.expect.beneficiaryDedup;
    const [, rows] = await sbGet(`beneficiaries?full_name=ilike.${encodeURIComponent("%" + name + "%")}&created_at=gte.${RUN_STARTED_AT}&select=id,full_name,ref_code,created_at`);
    const count = (rows || []).length;
    const expected = test.expect.expectExactlyOne ? 1 : count;
    checks.push({ label: `beneficiary dedup: exactly 1 row for ${name}`, pass: count === expected, got: { count, names: (rows || []).map((r) => r.full_name) } });
  }

  const pass = checks.length > 0 && checks.every((ch) => ch.pass);
  results.push({ id: test.id, status: pass ? "PASS" : "FAIL", checks });
  console.log(`        ${pass ? "PASS" : "FAIL"}`);
  for (const ch of checks) console.log(`        ${ch.pass ? "+" : "-"} ${ch.label} (got: ${JSON.stringify(ch.got)})`);
}

async function assertReaction(test, target) {
  // find OUR harness-owned tasks (those whose source_id resolves to one of our
  // synthesized inbound internal UUIDs), check if any moved to done
  const ourIds = await ourTaskIds();
  const checks = [];
  if (!ourIds.length) {
    checks.push({ label: `at least 1 of OUR tasks moved to done`, pass: false, got: { done: 0, all: [], note: "no harness-owned tasks resolved" } });
  } else {
    const [, ourTasks] = await sbGet(`tasks?id=in.(${ourIds.join(",")})&select=id,title,status,updated_at`);
    const doneTasks = (ourTasks || []).filter((t) => t.status === "done");
    checks.push({ label: `at least 1 of OUR tasks moved to done`, pass: doneTasks.length >= 1, got: { done: doneTasks.length, all: (ourTasks || []).map((t) => ({ title: t.title, status: t.status })) } });
  }
  const pass = checks.every((ch) => ch.pass);
  results.push({ id: test.id, status: pass ? "PASS" : "FAIL", checks });
  console.log(`        ${pass ? "PASS" : "FAIL"}`);
  for (const ch of checks) console.log(`        ${ch.pass ? "+" : "-"} ${ch.label} (got: ${JSON.stringify(ch.got)})`);
}

// ───────────────────────────────────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`prod-harness ${RUN_ID} | skip=[${[...SKIP].join(",")}] | keep=${KEEP}`);
  await setup();
  try {
    for (const test of TESTS) {
      await runOne(test);
    }
  } finally {
    // Count HONEST_NO_ACTION canned-line fires inside THIS run window only
    const [, outbound] = await sbGet(`messages?direction=eq.out&contact_id=eq.${HARNESS_CONTACT_ID}&body=ilike.%25I have not actually done that yet%25&created_at=gte.${RUN_STARTED_AT}&select=id`);
    const cannedCount = (Array.isArray(outbound) ? outbound : []).length;
    results.push({ id: "META_canned_line_count", status: cannedCount === 0 ? "PASS" : "FAIL", checks: [{ label: "HONEST_NO_ACTION canned-line fires == 0", pass: cannedCount === 0, got: cannedCount }] });
    console.log(`[${cannedCount === 0 ? "PASS" : "FAIL"}] canned-line count = ${cannedCount}`);
    await cleanup();
  }
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  const skipped = results.filter((r) => r.status === "SKIPPED").length;
  console.log(`\nSummary: ${passed} pass, ${failed} fail, ${skipped} skip`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error("HARNESS ERROR", e); try { await cleanup(); } catch {} process.exit(2); });
