// Group-bot prod harness. Hits /api/group/ingest directly with the
// x-group-secret header (the same shape the Baileys/Railway userbot uses).
// Verifies parsePayment-in-group-ingest stages a payment for Nur.
//
// Reuses the same env load + Supabase shape as prod-harness.mjs.

import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

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
const GROUP_BOT_SECRET = process.env.GROUP_BOT_SECRET || "";
const INGEST_URL = process.env.GROUP_INGEST_URL || "https://command.nisria.co/api/group/ingest";

if (!SUPABASE_URL || !SUPABASE_KEY) { console.error("missing supabase env"); process.exit(2); }
if (!GROUP_BOT_SECRET) { console.error("missing GROUP_BOT_SECRET"); process.exit(2); }

const args = process.argv.slice(2);
const KEEP = args.includes("--keep");

const RUN_ID = "g_" + randomBytes(4).toString("hex");
const SH = { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY };

async function sbGet(path) {
  const r = await fetch(SUPABASE_URL + "/rest/v1/" + path, { headers: SH });
  return [r.status, await r.json().catch(() => null)];
}
async function sbDelete(path) {
  const r = await fetch(SUPABASE_URL + "/rest/v1/" + path, { method: "DELETE", headers: SH });
  return r.status;
}

async function postGroup(payload) {
  const r = await fetch(INGEST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-group-secret": GROUP_BOT_SECRET },
    body: JSON.stringify(payload),
  });
  return [r.status, await r.text().catch(() => "")];
}

const RUN_STARTED_AT = new Date().toISOString();
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const TESTS = [
  {
    id: "G1",
    desc: "M-Pesa SMS in Finances group stages a payment on Nur's contact",
    body: {
      group: "Nisria • Finances 💵",
      sender_phone: "254703119486",
      sender_name: "Mark Test Harness",
      message_id: `wamid.GROUPHARNESS_${RUN_ID}_G1_${randomBytes(3).toString("hex")}`,
      text: "M-Pesa Confirmed. Ksh 4,750 sent to Group Test Payee 0700111222 on 8/6/26 at 2:30 PM. New M-PESA balance is Ksh 5,000.00. Transaction cost, Ksh 0.00.",
    },
    expect: {
      paymentStaged: { amount: 4750, payeeContains: "Group Test Payee", currency: "KES" },
    },
  },
  {
    id: "G2",
    desc: "Same M-Pesa SMS forwarded twice doesn't double-stage (idempotency_key)",
    body: {
      group: "Nisria • Finances 💵",
      sender_phone: "254703119486",
      sender_name: "Mark Test Harness",
      message_id: `wamid.GROUPHARNESS_${RUN_ID}_G2_${randomBytes(3).toString("hex")}`,
      text: "M-Pesa Confirmed. Ksh 2,300 sent to Idempotency Test Payee 0700333444 on 8/6/26 at 3:15 PM.",
    },
    expect: {
      stagedExactlyOnceAfterDoubleFire: { amount: 2300, payeeContains: "Idempotency Test Payee" },
    },
  },
];

const results = [];
async function runOne(test) {
  console.log(`[FIRE] ${test.id}: ${test.desc}`);
  const [status, body] = await postGroup(test.body);
  if (status !== 200) {
    results.push({ id: test.id, status: "FAIL", reason: `HTTP ${status} ${body.slice(0, 200)}` });
    console.log(`        FAIL HTTP ${status} ${body.slice(0, 100)}`);
    return;
  }
  await sleep(2500);
  const checks = [];

  if (test.expect.paymentStaged) {
    const { amount, payeeContains, currency } = test.expect.paymentStaged;
    const [, rows] = await sbGet(`pending_actions?kind=eq.record_payment&created_at=gte.${RUN_STARTED_AT}&select=id,payload,summary,status&order=created_at.desc&limit=10`);
    const match = (rows || []).find((r) => {
      const p = r.payload || {};
      return Number(p.amount) === amount && String(p.payee || "").toLowerCase().includes(payeeContains.toLowerCase()) && String(p.currency).toUpperCase() === currency.toUpperCase();
    });
    checks.push({ label: `payment staged amount=${amount} payee~"${payeeContains}"`, pass: !!match, got: rows?.map((r) => ({ amount: r.payload?.amount, payee: r.payload?.payee, source_group: r.payload?.source_group })) });
  }

  if (test.expect.stagedExactlyOnceAfterDoubleFire) {
    // Fire the SAME messageId again — idempotency_key should refuse
    const [s2] = await postGroup(test.body);
    await sleep(1500);
    const { amount, payeeContains } = test.expect.stagedExactlyOnceAfterDoubleFire;
    const [, rows] = await sbGet(`pending_actions?kind=eq.record_payment&created_at=gte.${RUN_STARTED_AT}&select=id,payload&limit=20`);
    const matches = (rows || []).filter((r) => Number(r.payload?.amount) === amount && String(r.payload?.payee || "").toLowerCase().includes(payeeContains.toLowerCase()));
    checks.push({ label: `staged exactly once after 2 posts (got ${matches.length})`, pass: matches.length === 1, got: { count: matches.length, second_http: s2 } });
  }

  const pass = checks.every((c) => c.pass);
  results.push({ id: test.id, status: pass ? "PASS" : "FAIL", checks });
  console.log(`        ${pass ? "PASS" : "FAIL"}`);
  for (const c of checks) console.log(`        ${c.pass ? "+" : "-"} ${c.label} (got: ${JSON.stringify(c.got)})`);
}

async function cleanup() {
  if (KEEP) { console.log("[--keep] skipping cleanup"); return; }
  await sbDelete(`pending_actions?summary=ilike.${encodeURIComponent("%Group Test Payee%")}&created_at=gte.${RUN_STARTED_AT}`);
  await sbDelete(`pending_actions?summary=ilike.${encodeURIComponent("%Idempotency Test Payee%")}&created_at=gte.${RUN_STARTED_AT}`);
  await sbDelete(`messages?external_id=like.${encodeURIComponent("wamid.GROUPHARNESS_%")}`);
  console.log("cleanup: dropped staging + group-harness messages");
}

async function main() {
  console.log(`group-bot harness ${RUN_ID} | keep=${KEEP}`);
  try {
    for (const t of TESTS) await runOne(t);
  } finally {
    await cleanup();
  }
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  console.log(`\nSummary: ${passed} pass, ${failed} fail`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error("HARNESS ERROR", e); try { await cleanup(); } catch {} process.exit(2); });
