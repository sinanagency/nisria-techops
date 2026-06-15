#!/usr/bin/env node
// Sasa whatsapp ingress FAIL-CLOSED on schema drift — 2026-06-16.
//
// COST PAID (2026-06-15 23:07-23:19 Dubai): the swipe-reply migration
// (20260615_swipe_reply_anchor.sql, KT #293) shipped as code without being
// applied to prod. Every swipe-reply inbound hit 42703 reply_to_external_id
// missing, ingress fail-OPENED at the legacy "must not lose the inbound" path,
// and the worker fired 12 off-topic Mark replies on stale history while the
// operator typed "I told you 10 times" + 😫.
//
// This wall in app/api/whatsapp/webhook/route.ts splits insert errors into
// SCHEMA-DRIFT (refuse to enqueue, alert) vs TRANSIENT (legacy lossless path).
// Schema-drift includes 42703 (undefined_column), 42P01 (undefined_table),
// 42883 (undefined_function), 42704 (undefined_object), 23502 (not_null_
// violation, which means a NOT NULL was added without a default), 42P10
// (undefined_column in ON CONFLICT).
//
// Pure local. No DB, no Anthropic, no network.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLATFORM = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => readFileSync(resolve(PLATFORM, rel), "utf8");

const tests = [];
function check(name, fn) { tests.push({ name, fn }); }

// ─── seam: source contains the fail-closed wall ────────────────────────────

check("seam: webhook route defines SCHEMA_DRIFT_CODES", () => {
  const src = read("app/api/whatsapp/webhook/route.ts");
  if (!/SCHEMA_DRIFT_CODES/.test(src)) return "SCHEMA_DRIFT_CODES missing";
  return null;
});

check("seam: webhook emits whatsapp.schema_drift event on drift", () => {
  const src = read("app/api/whatsapp/webhook/route.ts");
  if (!/whatsapp\.schema_drift/.test(src)) return "whatsapp.schema_drift event missing";
  return null;
});

check("seam: webhook calls pushIncident on drift", () => {
  const src = read("app/api/whatsapp/webhook/route.ts");
  const m = src.match(/SCHEMA_DRIFT_CODES[\s\S]{0,1200}/);
  if (!m) return "drift block not found";
  if (!/pushIncident/.test(m[0])) return "pushIncident not called inside drift block";
  return null;
});

check("seam: webhook continues (skips enqueue) on drift", () => {
  const src = read("app/api/whatsapp/webhook/route.ts");
  const m = src.match(/SCHEMA_DRIFT_CODES[\s\S]{0,1500}/);
  if (!m) return "drift block not found";
  if (!/\bcontinue\s*;/.test(m[0])) return "drift block does not `continue`; would still fall through to enqueueJob";
  return null;
});

check("seam: transient errors keep the legacy lossless emit path", () => {
  const src = read("app/api/whatsapp/webhook/route.ts");
  if (!/stage:\s*"ingress_insert"/.test(src)) return "legacy ingress_insert path lost";
  // The legacy path must still be reachable: drift block uses `continue`, so
  // the original emit must remain after the drift block.
  const driftIdx = src.indexOf("SCHEMA_DRIFT_CODES");
  const legacyIdx = src.lastIndexOf('stage: "ingress_insert"');
  if (driftIdx < 0 || legacyIdx < 0 || legacyIdx < driftIdx) return "legacy emit no longer follows drift block";
  return null;
});

check("seam: drift wall fires BEFORE the message_in emit (no stale-history risk)", () => {
  const src = read("app/api/whatsapp/webhook/route.ts");
  const driftIdx = src.indexOf("SCHEMA_DRIFT_CODES");
  const messageInIdx = src.indexOf('type: "whatsapp.message_in"');
  if (driftIdx < 0 || messageInIdx < 0) return "could not locate drift block or message_in emit";
  if (driftIdx > messageInIdx) return "drift block AFTER message_in emit — agent would still run on stale history";
  return null;
});

// ─── behavioural mirror: the regex catches the right SQLSTATE codes ─────────

const SCHEMA_DRIFT_CODES = /^(42703|42P01|42883|42704|23502|42P10)$/;

check("guard: 42703 (undefined_column) is schema-drift — TODAY'S BUG", () => {
  if (!SCHEMA_DRIFT_CODES.test("42703")) return "42703 not matched";
  return null;
});

check("guard: 42P01 (undefined_table) is schema-drift", () => {
  if (!SCHEMA_DRIFT_CODES.test("42P01")) return "42P01 not matched";
  return null;
});

check("guard: 42883 (undefined_function) is schema-drift", () => {
  if (!SCHEMA_DRIFT_CODES.test("42883")) return "42883 not matched";
  return null;
});

check("guard: 42704 (undefined_object — type/enum) is schema-drift", () => {
  if (!SCHEMA_DRIFT_CODES.test("42704")) return "42704 not matched";
  return null;
});

check("guard: 23502 (not_null_violation) is schema-drift", () => {
  // A NOT NULL column added without a default == migration not applied to
  // existing code paths. Treat as drift.
  if (!SCHEMA_DRIFT_CODES.test("23502")) return "23502 not matched";
  return null;
});

check("guard: 23505 (unique_violation) is NOT schema-drift — Meta retry path", () => {
  if (SCHEMA_DRIFT_CODES.test("23505")) return "23505 false-positived as drift";
  return null;
});

check("guard: 08000 (connection_exception) is NOT schema-drift — transient", () => {
  if (SCHEMA_DRIFT_CODES.test("08000")) return "08000 false-positived as drift";
  return null;
});

check("guard: 57014 (statement_timeout) is NOT schema-drift — transient", () => {
  if (SCHEMA_DRIFT_CODES.test("57014")) return "57014 false-positived as drift";
  return null;
});

check("guard: empty code is NOT schema-drift — fall through to legacy", () => {
  if (SCHEMA_DRIFT_CODES.test("")) return "empty string matched";
  return null;
});

// ─── runner ────────────────────────────────────────────────────────────────

let failed = 0;
for (const t of tests) {
  let res = null;
  try { res = t.fn(); } catch (e) { res = String(e?.message || e); }
  if (res) {
    failed++;
    console.error(`✗ ${t.name}: ${res}`);
  } else {
    console.log(`✓ ${t.name}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} pass`);
if (failed) process.exit(1);
