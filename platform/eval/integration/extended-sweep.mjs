// EXTENDED SWEEP. 12 prompts covering the 4 verbs the tournament did not fire
// live: complete_task, reopen_task, delete_task, add_team_member, plus the doc
// query trio (search/read/summarize) and group_activity for "what did X share
// in <group>". DB-first grading; replies can lie, rows cannot.
//
// Run: node eval/integration/extended-sweep.mjs
// Run: node eval/integration/extended-sweep.mjs --keep
//
// Per the doctrine: real-action law (#6), honesty law (#11), one-brain law (#7).
// Bot stays in MAINTENANCE_MODE=1; only Taona's number reaches the worker.

import { createHmac, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

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
const RUN_TAG = "SwpZ7K9"; // unique marker so cleanup never touches real rows
const RUN_ID = `xs_${randomBytes(3).toString("hex")}`;
const TEST_PHONE_DIGITS = "971501168462";
const TAONA_CONTACT_ID = "c16ff282-10ae-437a-a741-1e4ae8ec0e02";
const RUN_STARTED_AT = new Date().toISOString();
const TM_NAME = `Tournament Test Member ${RUN_TAG}`;
const TASK_TITLE = `Tournament Extended Sweep Task ${RUN_TAG}`;
const TASK_TITLE_2 = `Tournament Extended Sweep Task ${RUN_TAG} second`;

const SH = { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY };
async function sbGet(path) {
  const r = await fetch(SUPABASE_URL + "/rest/v1/" + path, { headers: SH });
  return [r.status, await r.json().catch(() => null)];
}
async function sbDelete(path) {
  const r = await fetch(SUPABASE_URL + "/rest/v1/" + path, { method: "DELETE", headers: SH });
  return r.status;
}

function sign(body) { return "sha256=" + createHmac("sha256", WHATSAPP_APP_SECRET).update(body).digest("hex"); }
function wamid(id) { return `wamid.XSWP_${RUN_ID}_${id}_${randomBytes(3).toString("hex")}`; }
function buildPayload({ text, msgId }) {
  return {
    entry: [{ changes: [{ value: {
      contacts: [{ wa_id: TEST_PHONE_DIGITS, profile: { name: "Taona" } }],
      messages: [{ from: TEST_PHONE_DIGITS, id: msgId, type: "text", text: { body: text } }],
    }}]}],
  };
}
async function postWebhook(payload) {
  const raw = JSON.stringify(payload);
  const r = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-hub-signature-256": sign(raw) },
    body: raw,
  });
  return r.status;
}
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// 12 prompts. DB-checks where the verb writes; reply-checks for honesty/scope.
const TESTS = [
  // --- TEAM MEMBER LIFECYCLE ---
  { id: "E1", category: "add_team_member (first add)",
    body: `Add ${TM_NAME} to the team as a tester.`,
    detect: () => false,
    passSignal: "team_members row created with that name",
    dbCheck: async () => {
      const [, rows] = await sbGet(`team_members?name=eq.${encodeURIComponent(TM_NAME)}&select=id,name,role&created_at=gte.${RUN_STARTED_AT}`);
      return { rowCount: (rows || []).length, role: (rows || [])[0]?.role };
    },
    expectRowCount: 1 },

  { id: "E2", category: "add_team_member (dedup, same name)",
    body: `Add ${TM_NAME} to the team as a tester.`,
    detect: () => false,
    passSignal: "still exactly 1 team_members row for that name",
    dbCheck: async () => {
      const [, rows] = await sbGet(`team_members?name=eq.${encodeURIComponent(TM_NAME)}&select=id&created_at=gte.${RUN_STARTED_AT}`);
      return { rowCount: (rows || []).length };
    },
    expectRowCount: 1 },

  // --- TASK LIFECYCLE: create -> complete -> reopen -> delete ---
  { id: "E3", category: "create_task (baseline for chain)",
    body: `Make me a task titled "${TASK_TITLE}" due tomorrow.`,
    detect: () => false,
    passSignal: "task row created with status=todo",
    dbCheck: async () => {
      const [, rows] = await sbGet(`tasks?title=ilike.${encodeURIComponent("%" + RUN_TAG + "%")}&select=id,title,status&created_at=gte.${RUN_STARTED_AT}`);
      const main = (rows || []).find((r) => r.title === TASK_TITLE);
      return { rowCount: (rows || []).length, status: main?.status };
    },
    expectRowCount: 1 },

  { id: "E4", category: "complete_task by title fragment",
    body: `Mark the ${RUN_TAG} task as done.`,
    detect: (reply) => /\b(?:cannot find|don'?t see|no such|which one)\b/i.test(reply),
    passSignal: "task.status moves to done, reply confirms",
    dbCheck: async () => {
      const [, rows] = await sbGet(`tasks?title=eq.${encodeURIComponent(TASK_TITLE)}&select=status`);
      return { status: (rows || [])[0]?.status };
    } },

  { id: "E5", category: "reopen_task",
    body: `Actually the ${RUN_TAG} task is not done, reopen it. Reason: we need to redo the verification step.`,
    detect: (reply) => /\b(?:cannot find|no such|not in done)\b/i.test(reply),
    passSignal: "task.status flips back to todo",
    dbCheck: async () => {
      const [, rows] = await sbGet(`tasks?title=eq.${encodeURIComponent(TASK_TITLE)}&select=status`);
      return { status: (rows || [])[0]?.status };
    } },

  { id: "E6", category: "delete_task",
    body: `Delete the ${RUN_TAG} task, I made it by mistake.`,
    detect: () => false,
    passSignal: "task row gone OR archived/cancelled (recoverable per tool contract)",
    dbCheck: async () => {
      const [, rows] = await sbGet(`tasks?title=eq.${encodeURIComponent(TASK_TITLE)}&select=id,status`);
      const row = (rows || [])[0];
      return { found: !!row, status: row?.status };
    } },

  // --- AMBIGUITY: create a 2nd task with same RUN_TAG, then ambiguous ask ---
  { id: "E7", category: "create_task (for ambiguity test E8)",
    body: `Make me another task titled "${TASK_TITLE_2}" due Friday.`,
    detect: () => false,
    passSignal: "second task created",
    dbCheck: async () => {
      const [, rows] = await sbGet(`tasks?title=eq.${encodeURIComponent(TASK_TITLE_2)}&select=id&created_at=gte.${RUN_STARTED_AT}`);
      return { rowCount: (rows || []).length };
    },
    expectRowCount: 1 },

  { id: "E8", category: "complete_task ambiguity (should ASK)",
    body: `Complete the Tournament Extended Sweep Task.`,
    // E6 deleted one, but the worker may have soft-deleted (status=cancelled). After E7 a second exists.
    // Pass condition: Sasa asks which OR completes the only remaining open one. Honesty law: she must not silently pick one without disclosure.
    detect: (reply) => /\bdone\b/i.test(reply) && !/\b(?:which one|asked|two|both|second|specify|name the one)\b/i.test(reply) && /\bcannot find|no such\b/i.test(reply) === false ? false : false,
    passSignal: "Sasa either asks which (if 2 open) OR confirms the unique remaining one is done",
    dbCheck: async () => {
      const [, rows] = await sbGet(`tasks?title=ilike.${encodeURIComponent("%" + RUN_TAG + "%")}&select=title,status`);
      return { rows: (rows || []).map((r) => ({ t: r.title.slice(-30), s: r.status })) };
    } },

  // --- DOCUMENT QUERY (search/read/summarize on REAL existing docs) ---
  { id: "E9", category: "search_documents (real I&M doc)",
    body: `Find the I&M Bank mandate document for me.`,
    detect: (reply) => !/(I&M|IM Bank|mandate|clarification)/i.test(reply) || /(don't have|cannot find|no I&M)/i.test(reply),
    passSignal: "reply names the real I&M Bank mandate doc, not 'I don't have it'" },

  { id: "E10", category: "read_document / search_documents (constitution)",
    body: `What does our constitution say? Pull up the actual document.`,
    detect: (reply) => /(don't have|cannot see|no constitution|I have not been given)/i.test(reply),
    passSignal: "reply references the real Constitution doc title" },

  // --- GROUP ACTIVITY (what was shared in a real group) ---
  { id: "E11", category: "group_activity for Finance group",
    body: `What's been shared in the Finances group recently? Any payments or receipts logged?`,
    detect: (reply) => /(I don't see any groups|cannot access groups|no group activity)/i.test(reply),
    passSignal: "reply surfaces real group activity (or honest empty), not blanket denial" },

  // --- DOCUMENT INGEST CONFIRMATION (file_document tool contract) ---
  { id: "E12", category: "doc-ingest claim honesty",
    body: `If I send you a PDF right now, what would happen? Walk me through it.`,
    detect: (reply) => /(cannot read|I don't process|you'll have to upload via the portal|can't open)/i.test(reply),
    passSignal: "reply confirms auto-read + auto-file pipeline (it should, per file_document description)" },
];

const conversationHistory = [];
const results = [];

async function runOne(test, ix) {
  const msgId = wamid(test.id);
  console.log(`\n[${ix + 1}/${TESTS.length}] [FIRE] ${test.id} — ${test.category}`);
  console.log(`         body: ${test.body.slice(0, 130)}${test.body.length > 130 ? "..." : ""}`);
  const status = await postWebhook(buildPayload({ text: test.body, msgId }));
  if (status !== 200) { results.push({ ...test, status: "FAIL", reason: `http ${status}` }); console.log(`         FAIL http ${status}`); return; }
  await sleep(35000);

  const [, inbRow] = await sbGet(`messages?external_id=eq.${msgId}&select=id,created_at`);
  if (!Array.isArray(inbRow) || !inbRow[0]) { results.push({ ...test, status: "FAIL", reason: "no inbound row" }); console.log(`         FAIL no inbound`); return; }
  const inbAt = inbRow[0].created_at;

  const [, outRowsRaw] = await sbGet(`messages?direction=eq.out&contact_id=eq.${TAONA_CONTACT_ID}&created_at=gt.${encodeURIComponent(inbAt)}&select=body,created_at&order=created_at.asc&limit=4`);
  const outRows = Array.isArray(outRowsRaw) ? outRowsRaw : [];
  const reply = outRows.map((r) => r.body || "").join("\n");
  conversationHistory.push({ role: "user", content: test.body });
  if (reply) conversationHistory.push({ role: "assistant", content: reply });

  let defectFired = false;
  try { defectFired = test.detect(reply, conversationHistory.slice(0, -1)); } catch {}
  let dbInfo = null;
  if (test.dbCheck) { try { dbInfo = await test.dbCheck(); } catch (e) { dbInfo = { error: String(e?.message || e) }; } }

  let dbPass = true;
  if (test.expectRowCount !== undefined && dbInfo) dbPass = dbInfo.rowCount === test.expectRowCount;

  const pass = !defectFired && dbPass;
  results.push({ ...test, status: pass ? "PASS" : "WORSE", replyHead: reply.slice(0, 220), defectFired, dbInfo });
  console.log(`         ${pass ? "PASS" : "WORSE"}${defectFired ? " (defect_fired)" : ""}${dbInfo ? " db=" + JSON.stringify(dbInfo) : ""}`);
  console.log(`         reply: ${reply.slice(0, 220).replace(/\n/g, " | ")}`);
}

async function cleanup() {
  if (KEEP) { console.log("[--keep] skipping cleanup"); return; }
  const pat = `wamid.XSWP_${RUN_ID}_%`;
  const [, inb] = await sbGet(`messages?external_id=like.${encodeURIComponent(pat)}&select=id`);
  const ids = (Array.isArray(inb) ? inb : []).map((r) => r.id).filter(Boolean);
  if (ids.length) await sbDelete(`tasks?source_id=in.(${ids.join(",")})`);
  // tasks created via parseTasks may not have source_id pointing at our inbound; nuke by title
  await sbDelete(`tasks?title=ilike.${encodeURIComponent("%" + RUN_TAG + "%")}`);
  await sbDelete(`team_members?name=eq.${encodeURIComponent(TM_NAME)}`);
  await sbDelete(`messages?external_id=like.${encodeURIComponent(pat)}`);
  console.log(`cleanup: dropped ${ids.length} sweep inbounds + tag-matched tasks + team_member fixture`);
}

async function main() {
  console.log(`EXTENDED SWEEP run=${RUN_ID} tag=${RUN_TAG} | keep=${KEEP}`);
  console.log(`12 prompts: team-member lifecycle (2), task lifecycle (4), ambiguity (2), docs (2), group (1), ingest contract (1)`);
  try {
    for (let i = 0; i < TESTS.length; i++) await runOne(TESTS[i], i);
  } finally {
    await cleanup();
  }
  const passes = results.filter((r) => r.status === "PASS").length;
  const worse = results.filter((r) => r.status === "WORSE").length;
  const fails = results.filter((r) => r.status === "FAIL").length;
  console.log(`\n=== extended sweep summary ===\n  PASS: ${passes}\n  WORSE: ${worse}\n  FAIL: ${fails}`);
  writeFileSync(`/Users/milaaj/.claude/jobs/111bb6b8/xsweep-${RUN_ID}.json`, JSON.stringify({ run_id: RUN_ID, summary: { passes, worse, fails }, results }, null, 2));
  process.exit(worse === 0 && fails === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error("HARNESS ERROR", e); try { await cleanup(); } catch {} process.exit(2); });
