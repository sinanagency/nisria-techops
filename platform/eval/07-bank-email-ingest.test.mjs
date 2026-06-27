// Eval 07 — bank-email -> staged payments (Nur confirms).
// Imports the REAL parser from lib/bank-email.ts (Node strips TS types) and
// simulates the ingest_bank_email staging branch from lib/smart-tools.ts against
// a stub db. WARNING: the staging block below mirrors production logic in
// lib/smart-tools.ts (runAction, name === "ingest_bank_email"). If you change the
// source, update this mirror.
//
// Verifies the five-law spine for the live graft:
//   1. Parser reads M-Pesa/Sendwave/statement lines; balance never staged.
//   2. Currencies kept distinct (KES/USD/AED never blended).
//   3. Light category mapped to live finance buckets; unsure -> other.
//   4. looksLikeBankEmail gate: non-bank ignored, bank sender / parseable staged.
//   5. Staging writes record_payment pending_actions; re-run dedups; a txn already
//      on the ledger is flagged (held back), never duplicated.

import assert from "node:assert/strict";
import { parseBankEmail, looksLikeBankEmail, batchTag, payeeOverlap, withinDays } from "../lib/bank-email.ts";

let pass = 0, fail = 0;
function run(name, fn) {
  try { fn(); console.log(`  PASS   ${name}`); pass++; }
  catch (e) { console.log(`  FAIL   ${name}\n      ${e.message}`); fail++; }
}

// ---- Inline mirror of the ingest_bank_email staging branch (smart-tools.ts) ----
const CAT_MAP = { salary: "payroll", rent: "rent", utilities: "utilities", fee: "other", refund: "other", procurement: "other", courier: "other", unknown: "other" };

function makeStubDb({ ledger = [], pending = [] } = {}) {
  const inserted = [];
  return {
    inserted, ledger, pending,
    from(table) {
      const state = { table, filters: {} };
      const api = {
        select() { return api; },
        eq(col, val) { state.filters[col] = val; return api; },
        gte() { return api; },
        lte() { return api; },
        limit() { return api; },
        single() { const row = { id: `pay_${ledger.length + 1}` }; return { then: (r) => r({ data: row, error: null }) }; },
        // terminal: return rows matching all set filters for the queried table
        then(resolve) {
          const match = (rows) => rows.filter((r) => Object.entries(state.filters).every(([k, v]) => r[k] === v));
          if (state.table === "pending_actions") return resolve({ data: match(pending) });
          if (state.table === "payments") return resolve({ data: match(ledger) });
          return resolve({ data: [] });
        },
        insert(row) {
          inserted.push(row);
          if (state.table === "pending_actions") pending.push(row);
          if (state.table === "payments") ledger.push({ id: `pay_${ledger.length + 1}`, status: "paid", ...row });
          return { select: () => ({ single: () => ({ then: (r) => r({ data: { id: `pay_${ledger.length}` }, error: null }) }) }), then: (r) => r({ error: null }) };
        },
      };
      return api;
    },
  };
}

// Inline mirror of the bank_tag idempotency in commitPaymentRow (smart-tools.ts).
async function simulateCommit(db, args) {
  const bankTag = args.bank_tag ? String(args.bank_tag) : null;
  if (bankTag) {
    const { data: prior } = await db.from("payments").select("id").eq("ref", bankTag).limit(1);
    if (prior && prior.length) return { id: prior[0].id, deduped: true };
  }
  db.ledger.push({ id: `pay_${db.ledger.length + 1}`, payee: args.payee, amount: args.amount, currency: args.currency, status: "paid", ref: bankTag || `AI-WA-${db.ledger.length}` });
  return { id: db.ledger[db.ledger.length - 1].id };
}

async function simulateIngest(db, ctx, input) {
  if (!ctx.contactId) return { ok: false, ignored: false, staged: 0, refusedNoContact: true };
  const from = String(input.from || "").trim();
  const text = String(input.text || "").trim();
  const attTexts = Array.isArray(input.attachments_text) ? input.attachments_text.map(String).filter(Boolean) : [];
  if (!looksLikeBankEmail(from, text, attTexts)) return { ok: false, ignored: true, staged: 0 };
  const txns = [...parseBankEmail(text), ...attTexts.flatMap((t) => parseBankEmail(t))];
  if (!txns.length) return { ok: false, ignored: true, staged: 0 };

  const { data: pend } = await db.from("pending_actions").select("payload").eq("contact_id", ctx.contactId).eq("kind", "record_payment").eq("status", "awaiting_confirm");
  const stagedKeys = new Set((pend || []).map((p) => p?.payload?.bank_tag).filter(Boolean));
  let staged = 0, dup = 0, flagged = 0;
  for (const t of txns) {
    const tag = batchTag(t);
    if (stagedKeys.has(tag)) { dup += 1; continue; }
    const { data: cand } = await db.from("payments").select("id,payee,paid_at").eq("amount", t.amount).eq("currency", t.currency).eq("status", "paid").limit(25);
    const onLedger = (cand || []).some((c) => payeeOverlap(String(c.payee || ""), t.description) && withinDays(t.date, c.paid_at ? String(c.paid_at).slice(0, 10) : null, 3));
    if (onLedger) { flagged += 1; continue; }
    const category = CAT_MAP[t.category] || "other";
    const method = t.ref ? "mpesa" : "bank";
    const paid_at = t.date ? new Date(`${t.date}T12:00:00Z`).toISOString() : new Date().toISOString();
    const pargs = { payee: t.description, purpose: "bank email import", amount: t.amount, currency: t.currency, method, paid_at, category, screenshot_path: null, source_message_id: null, bank_tag: tag };
    const { error } = await db.from("pending_actions").insert({ contact_id: ctx.contactId, kind: "record_payment", payload: pargs, summary: `${t.currency} ${t.amount} to ${t.description}`, status: "awaiting_confirm" });
    if (error) continue;
    stagedKeys.add(tag);
    staged += 1;
  }
  return { ok: staged > 0 || dup > 0 || flagged > 0, staged, dup, flagged };
}

console.log("\n  Eval 07 — bank-email -> staged payments\n");

run("M-Pesa: code is ref, balance excluded, Ksh normalized to KES", () => {
  const t = parseBankEmail("QGR7H1A2BC Confirmed. Ksh29,000.00 sent to GRACE on 29/5/26. New M-PESA balance is Ksh 1,200.00")[0];
  assert.equal(t.ref, "QGR7H1A2BC");
  assert.equal(t.amount, 29000, "transacted amount, not the 1,200 balance");
  assert.equal(t.currency, "KES", "Ksh normalized to KES");
  assert.equal(t.direction, "out");
});

run("currencies kept distinct, never blended", () => {
  const txns = parseBankEmail([
    "QGR7H1A2BC Confirmed. Ksh29,000.00 sent to GRACE",
    "You sent $200.00 to JOHN",
    "12/05/26 Dubai office AED 450.00 DR",
  ].join("\n"));
  const curs = [...new Set(txns.map((t) => t.currency))].sort();
  assert.deepEqual(curs, ["AED", "KES", "USD"], "three currencies, each on its own row");
});

run("light category maps to finance buckets, unsure stays unknown", () => {
  const [salary, util, plain] = parseBankEmail([
    "30/05/26 staff salary 50,000 KES DR",
    "30/05/26 KPLC token 2,000 KES DR",
    "30/05/26 random payee 1,000 KES DR",
  ].join("\n"));
  assert.equal(salary.category, "salary");
  assert.equal(util.category, "utilities");
  assert.equal(plain.category, "unknown", "no keyword -> never invented");
});

run("gate: non-bank email is ignored, not force-parsed", async () => {
  const db = makeStubDb();
  const r = await simulateIngest(db, { contactId: "c1" }, { from: "friend@gmail.com", text: "lunch tomorrow at 1pm?" });
  assert.equal(r.ignored, true);
  assert.equal(r.staged, 0);
  assert.equal(db.inserted.length, 0, "nothing staged for a non-bank email");
});

run("staging: parseable bank email stages record_payment pending_actions", async () => {
  const db = makeStubDb();
  const text = ["QGR7H1A2BC Confirmed. Ksh29,000.00 sent to GRACE on 29/5/26", "You sent $200.00 to JOHN"].join("\n");
  const r = await simulateIngest(db, { contactId: "c1" }, { from: "alerts@kcb.co.ke", text });
  assert.equal(r.staged, 2);
  assert.equal(db.inserted.length, 2);
  assert.ok(db.inserted.every((row) => row.kind === "record_payment" && row.status === "awaiting_confirm"), "staged as record_payment for the worker yes-path");
  assert.ok(db.inserted.every((row) => row.contact_id === "c1"));
  const curs = [...new Set(db.inserted.map((r) => r.payload.currency))].sort();
  assert.deepEqual(curs, ["KES", "USD"], "each staged row carries its own currency");
});

run("idempotent staging: re-running the same email dedups by bank_tag", async () => {
  const text = "QGR7H1A2BC Confirmed. Ksh29,000.00 sent to GRACE on 29/5/26";
  const tag = batchTag(parseBankEmail(text)[0]);
  const pending = [{ contact_id: "c1", kind: "record_payment", status: "awaiting_confirm", payload: { bank_tag: tag } }];
  const db = makeStubDb({ pending });
  const r = await simulateIngest(db, { contactId: "c1" }, { from: "safaricom", text });
  assert.equal(r.dup, 1, "already staged -> counted as dup, not re-staged");
  assert.equal(r.staged, 0);
});

run("cross-source: a txn already on the ledger is flagged, not duplicated", async () => {
  const ledger = [{ id: "p1", payee: "GRACE WAOBRIEN", amount: 29000, currency: "KES", status: "paid", paid_at: "2026-05-29T12:00:00Z" }];
  const db = makeStubDb({ ledger });
  const r = await simulateIngest(db, { contactId: "c1" }, { from: "safaricom", text: "QGR7H1A2BC Confirmed. Ksh29,000.00 sent to GRACE on 29/5/26" });
  assert.equal(r.flagged, 1, "manual ledger row matched -> held back");
  assert.equal(r.staged, 0);
  assert.equal(db.inserted.length, 0);
});

run("no contact -> refuses to stage", async () => {
  const db = makeStubDb();
  const r = await simulateIngest(db, {}, { from: "safaricom", text: "QGR7H1A2BC Confirmed. Ksh29,000.00 sent to GRACE" });
  assert.equal(r.refusedNoContact, true);
  assert.equal(db.inserted.length, 0);
});

run("commit idempotency: same bank_tag committed twice lands once (P0 fix)", async () => {
  const db = makeStubDb();
  const t = parseBankEmail("QGR7H1A2BC Confirmed. Ksh29,000.00 sent to GRACE on 29/5/26")[0];
  const args = { payee: t.description, amount: t.amount, currency: t.currency, bank_tag: batchTag(t) };
  const first = await simulateCommit(db, args);
  const second = await simulateCommit(db, args); // e.g. email cc'd again after the first confirm
  assert.equal(second.deduped, true, "second commit recognized as already on the ledger");
  assert.equal(first.id, second.id, "returns the existing row id");
  assert.equal(db.ledger.filter((r) => r.ref === batchTag(t)).length, 1, "exactly one ledger row for the M-Pesa code");
});

console.log(`\n  SUMMARY: ${pass} passed / ${fail} failed\n`);
if (fail) process.exit(1);
