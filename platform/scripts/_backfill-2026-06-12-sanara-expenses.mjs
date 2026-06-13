// Silent backfill for the two expenses Nur typed in the Finances group at
// 2026-06-12 17:13 Nairobi (UTC 13:13, message f87aecb6-e479-4482-8d44-1f73fbc3d94a):
//
//   "Sanara trainer-Ksh 25,000
//    Transport for trainer-Ksh 1,500"
//
// The parsePayment regex at that time only recognised "Ksh AMOUNT to PAYEE"
// (amount-first, preposition-required) — Nur's payee-first hyphen shape was
// not in the grammar, so neither expense was staged. The regex is now fixed
// (CHAT_PAYEE_FIRST_RE, 2026-06-13). This script writes the two missed rows
// directly into pending_actions in the SAME shape the live route writes them,
// so they show up in Nur's "Needs You" tab next time she opens the portal.
//
// Discipline:
//   - SILENT backend write. No sendTextAndLog, no pushIncident, no WhatsApp.
//   - Idempotent on (source_message_id + amount). Re-run is a no-op.
//   - status = 'awaiting_confirm', matching the route default.
//   - Same payload shape (idempotency_key prefixed "group_payment__") as the
//     live route so downstream consumers don't differentiate.
//   - Tries Supabase REST first. Falls back to psql via DATABASE_URL when
//     REST is restricted (egress quota), which is the project's current state.
//
// Run: node scripts/_backfill-2026-06-12-sanara-expenses.mjs

import fs from "node:fs";
import { spawnSync } from "node:child_process";

const ENV = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => {
  const m = ENV.match(new RegExp(`^${k}=(.*)$`, "m"));
  return m ? m[1].trim().replace(/^"|"$/g, "").replace(/\\n$/, "") : "";
};
const URL_ = get("SUPABASE_URL");
const KEY = get("SUPABASE_SERVICE_KEY");
const DBURL = get("DATABASE_URL");
const PSQL = "/usr/local/opt/libpq/bin/psql";

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const rest = (p, init = {}) => fetch(`${URL_}/rest/v1/${p}`, { ...init, headers: { ...H, ...(init.headers || {}) } });

// Constants
const SOURCE_MESSAGE_ID = "f87aecb6-e479-4482-8d44-1f73fbc3d94a";
const SOURCE_GROUP = "Nisria • Finances 💵";
const SOURCE_SENDER = "Nur M’nasria";
const NUR_CONTACT_ID = "46b86180-f2a3-4131-b41d-b70773a8d998";
const PAID_AT = "2026-06-12T13:13:34.031Z"; // matches message created_at

const ITEMS = [
  { payee: "Sanara trainer", amount: 25000, currency: "KES", method: "mpesa" },
  { payee: "Transport for trainer", amount: 1500, currency: "KES", method: "mpesa" },
];

function buildPayload(it) {
  return {
    payee: it.payee,
    amount: it.amount,
    currency: it.currency,
    method: it.method,
    paid_at: PAID_AT,
    purpose: null,
    screenshot_path: null,
    source_message_id: SOURCE_MESSAGE_ID,
    source_group: SOURCE_GROUP,
    source_sender: SOURCE_SENDER,
    idempotency_key: `group_payment__${SOURCE_MESSAGE_ID}__${it.amount}`,
    backfill_reason: "parsePayment_regex_miss_2026_06_12",
  };
}

function buildSummary(it) {
  return `${it.currency} ${it.amount.toLocaleString()} to ${it.payee} (from ${SOURCE_GROUP}, posted by ${SOURCE_SENDER})`;
}

async function tryRest() {
  // Probe a cheap read first to see if REST is up.
  const probe = await rest("pending_actions?select=id&limit=1");
  if (!probe.ok) return { ok: false, reason: `probe ${probe.status}` };
  return { ok: true };
}

function psqlInsert(it) {
  const payload = buildPayload(it);
  const summary = buildSummary(it);
  // Idempotency + insert in ONE SQL statement (RETURNING id). Skip if a row
  // for the same source_message_id + amount already exists.
  const sql = `
    INSERT INTO pending_actions (contact_id, kind, payload, summary, status)
    SELECT $1::uuid, 'record_payment', $2::jsonb, $3, 'awaiting_confirm'
    WHERE NOT EXISTS (
      SELECT 1 FROM pending_actions
      WHERE kind = 'record_payment'
        AND payload->>'source_message_id' = $4
        AND (payload->>'amount')::numeric = $5::numeric
    )
    RETURNING id, payload->>'amount' AS amount, payload->>'payee' AS payee, payload->>'source_message_id' AS smid;
  `;
  const args = [
    "-X", "-A", "-t",
    "-d", DBURL,
    "-v", "ON_ERROR_STOP=1",
    "-c", sql,
    "-v", `contact=${NUR_CONTACT_ID}`,
  ];
  // psql doesn't bind positional like that; use \gexec-friendly approach via params file.
  // Simpler: use libpq's `PREPARE`/`EXECUTE` through `psql -c` with escaping. We'll
  // build the SQL inline with safe literal quoting since we control all inputs.
  const safe = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const payloadJson = JSON.stringify(payload).replace(/'/g, "''");
  const inline = `
    INSERT INTO pending_actions (contact_id, kind, payload, summary, status)
    SELECT '${NUR_CONTACT_ID}'::uuid, 'record_payment', '${payloadJson}'::jsonb, ${safe(summary)}, 'awaiting_confirm'
    WHERE NOT EXISTS (
      SELECT 1 FROM pending_actions
      WHERE kind = 'record_payment'
        AND payload->>'source_message_id' = '${SOURCE_MESSAGE_ID}'
        AND (payload->>'amount')::numeric = ${Number(it.amount)}
    )
    RETURNING id, payload->>'amount' AS amount, payload->>'payee' AS payee;
  `;
  const r = spawnSync(PSQL, ["-X", "-A", "-t", "-q", "-F", "|", "-v", "ON_ERROR_STOP=1", "-d", DBURL, "-c", inline], { encoding: "utf8" });
  if (r.status !== 0) {
    console.log("PSQL ERR:", r.stderr);
    process.exit(2);
  }
  // psql in -t -A mode emits the RETURNING row on one line + a status footer
  // ("INSERT 0 1" / "INSERT 0 0") on the next. Split by line and take the
  // pipe-delimited row; zero-line result means the WHERE NOT EXISTS guard fired.
  const lines = (r.stdout || "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^INSERT\s+\d+\s+\d+$/.test(l));
  if (!lines.length) return { skipped: true };
  const [id, amount, payee] = lines[0].split("|");
  return { id, amount, payee };
}

const proofRows = [];
let inserted = 0, skipped = 0;

const restProbe = await tryRest();
const restOK = restProbe.ok;
console.log(`REST status: ${restOK ? "ok" : "restricted (" + restProbe.reason + "), using psql"}`);

for (const it of ITEMS) {
  if (restOK) {
    const checkUrl = `pending_actions?select=id,payload&kind=eq.record_payment&payload->>source_message_id=eq.${encodeURIComponent(SOURCE_MESSAGE_ID)}`;
    const existing = await (await rest(checkUrl)).json();
    const dupe = (existing || []).find((r) => Number(r.payload?.amount) === Number(it.amount));
    if (dupe) {
      console.log(`  SKIP (exists): ${it.currency} ${it.amount} to ${it.payee} -> ${dupe.id}`);
      proofRows.push({ id: dupe.id, amount: it.amount, payee: it.payee, source_message_id: SOURCE_MESSAGE_ID, status: "pre-existing" });
      skipped++;
      continue;
    }
    const r = await rest("pending_actions", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        contact_id: NUR_CONTACT_ID,
        kind: "record_payment",
        payload: buildPayload(it),
        summary: buildSummary(it),
        status: "awaiting_confirm",
      }),
    });
    if (!r.ok) { console.log(`FAIL REST: ${it.payee} -> ${r.status} ${await r.text()}`); process.exit(2); }
    const out = await r.json();
    const row = Array.isArray(out) ? out[0] : out;
    console.log(`  INSERT (rest): ${it.currency} ${it.amount} to ${it.payee} -> ${row.id}`);
    proofRows.push({ id: row.id, amount: it.amount, payee: it.payee, source_message_id: SOURCE_MESSAGE_ID, status: "inserted" });
    inserted++;
  } else {
    const res = psqlInsert(it);
    if (res.skipped) {
      console.log(`  SKIP (exists): ${it.currency} ${it.amount} to ${it.payee}`);
      proofRows.push({ id: null, amount: it.amount, payee: it.payee, source_message_id: SOURCE_MESSAGE_ID, status: "pre-existing" });
      skipped++;
    } else {
      console.log(`  INSERT (psql): ${it.currency} ${res.amount} to ${res.payee} -> ${res.id}`);
      proofRows.push({ id: res.id, amount: Number(res.amount), payee: res.payee, source_message_id: SOURCE_MESSAGE_ID, status: "inserted" });
      inserted++;
    }
  }
}

console.log("\n== PROOF ROWS ==");
console.log(JSON.stringify(proofRows, null, 2));
console.log(`\ninserted=${inserted} skipped=${skipped}`);
