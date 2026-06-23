// CRUD verified-write wall (2026-06-21, KT #336 generalized). The add-tools wall
// (sasa-add-tools-verified-write-wall) fixed add_team_member / add_inventory_item:
// they inserted WITHOUT checking the insert error, then returned ok:true "Added X"
// even when the write silently failed (RLS, constraint, network). This wall extends
// the SAME "no fake success" guarantee to EVERY mutating Sasa tool: a create/add/
// update/delete/insert may never narrate a write it did not verify.
//
// The bug pattern: `const { data: X } = await db.from(...).insert/update/delete(...)`
// (no `error:` destructure) followed by an `ok: true` "Did it" return. The fix:
// destructure `{ data, error }`, and `return { ok: false, ... }` with an honest
// "I could not …, so I have not" line when the write fails.
//
// Pure-local source-seam test: read smart-tools.ts as a string, and for each fixed
// tool assert its block (a) destructures the mutation error and (b) has an
// `ok: false` refusal guard wired to that error before the success return.
//
// Seams (one per audited tool's PRIMARY write):
//   add_beneficiary (case insert)      | add_beneficiary (beneficiary insert)
//   record_payment / commitPaymentRow  | create_event | move_event
//   update_contact | update_team_member | delete_event | delete_contact
//   delete_payment | update_payment | mark_payment_paid | log_payout
//   schedule_payment | add_contact | add_donor | update_donor | add_campaign
//   update_campaign | log_team_payment | add_grant | update_grant_status
//   move_case | edit_case | merge_case | delete_case | approve_case | decline_case
//   set_public_profile | set_beneficiary_funding | update_beneficiary
//   update_wishlist_item | fund_wishlist_item | update_inventory | delete_document
//   set_monthly_goal | edit_brain_section | activate_member | set_bot_access
//   add_task_comment | link_task_dependency | mark_handled | draft_post
//   complete_task | complete_calendar_event

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SMART = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "smart-tools.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);
const flat = (s) => s.replace(/\s+/g, " ");

// region from a marker to the NEXT tool boundary (`if (name === "…"`), so a
// guard belonging to the next tool can never satisfy this tool's assertion
// (no cross-tool false positive). Falls back to a generous span if the next
// boundary is unusually far.
function regionOf(marker, span = 12000) {
  const i = SMART.indexOf(marker);
  if (i < 0) return "";
  const next = SMART.indexOf('if (name === "', i + marker.length);
  const end = next > i ? Math.min(next, i + span) : i + span;
  return SMART.slice(i, end);
}

// A tool "verifies its write" iff, after the mutation, it destructures an error
// AND returns ok:false guarded on that error. We assert the two seams generically.
function assertErrorDestructured(region, label) {
  // matches `{ ... error: <ident> }` or `{ error }` from an await db...insert/update/delete
  if (!/\{\s*(?:data:\s*\w+\s*,\s*)?error(?:\s*:\s*\w+)?\s*\}\s*=\s*await\s+db\b/.test(flat(region)))
    fail(`${label}: must destructure the mutation error ({ data, error } = await db…)`);
  else ok(`${label}: destructures the mutation error`);
}
function assertRefusalGuard(region, label) {
  // matches `if ( …Err… || !x ) return { ok: false` OR `if ( …Err… ) return { ok: false`
  if (!/if\s*\(\s*[^)]*[Ee]rr[^)]*\)\s*return\s*\{\s*ok:\s*false/.test(flat(region)))
    fail(`${label}: must return ok:false when the mutation error is set (no fake success)`);
  else ok(`${label}: guards ok:false on the mutation error`);
}

// ---- add_beneficiary: BOTH inserts (case + beneficiary) ----
{
  const r = regionOf('name === "add_beneficiary"');
  // case insert path
  if (!/\{\s*data:\s*crow\s*,\s*error:/.test(r)) fail("add_beneficiary(case): must destructure the case-insert error");
  else ok("add_beneficiary(case): destructures the case-insert error");
  if (!/if\s*\(\s*[^)]*[Ee]rr[^)]*\|\|\s*!crow\s*\)\s*return\s*\{\s*ok:\s*false/.test(flat(r)))
    fail("add_beneficiary(case): must return ok:false when the case insert fails");
  else ok("add_beneficiary(case): guards ok:false on the case-insert error");
  // beneficiary insert path
  if (!/\{\s*data:\s*row\s*,\s*error:/.test(r)) fail("add_beneficiary(ben): must destructure the beneficiary-insert error");
  else ok("add_beneficiary(ben): destructures the beneficiary-insert error");
  if (!/if\s*\(\s*[^)]*[Ee]rr[^)]*\|\|\s*!row\s*\)\s*return\s*\{\s*ok:\s*false/.test(flat(r)))
    fail("add_beneficiary(ben): must return ok:false when the beneficiary insert fails");
  else ok("add_beneficiary(ben): guards ok:false on the beneficiary-insert error");
}

// ---- record_payment / commitPaymentRow (shared payment writer) ----
{
  // commitPaymentRow is the single ledger-insert seam; it must surface a failed insert.
  const r = SMART.slice(SMART.indexOf('export async function commitPaymentRow'), SMART.indexOf('export async function commitPaymentRow') + 1100);
  if (!/\{\s*data:\s*row\s*,\s*error\s*\}/.test(r)) fail("commitPaymentRow: must destructure the payment-insert error");
  else ok("commitPaymentRow: destructures the payment-insert error");
  // the writer returns { id, error? }; it must propagate a failed insert.
  if (!/return\s*\{\s*id:\s*null\s*,\s*error/.test(flat(r))) fail("commitPaymentRow: must return { id: null, error } on a failed insert");
  else ok("commitPaymentRow: returns { id: null, error } on a failed insert");
  const rp = regionOf('name === "record_payment"');
  if (!/const\s*\{\s*id\s*,\s*error[^}]*\}\s*=\s*await\s+commitPaymentRow/.test(flat(rp)))
    fail("record_payment: must read the error back from commitPaymentRow");
  else ok("record_payment: reads error back from commitPaymentRow");
  if (!/if\s*\(\s*[^)]*[Ee]rr[^)]*\)\s*return\s*\{\s*ok:\s*false/.test(flat(rp)))
    fail("record_payment: must return ok:false when the ledger insert fails");
  else ok("record_payment: guards ok:false on the ledger-insert error");
}

// ---- create_event ----
{
  const r = regionOf('name === "create_event"', 3700);
  assertErrorDestructured(r, "create_event");
  assertRefusalGuard(r, "create_event");
}

// ---- move_event ----
{
  const r = regionOf('name === "move_event"');
  assertErrorDestructured(r, "move_event");
  assertRefusalGuard(r, "move_event");
}

// ---- update_contact ----
{
  const r = regionOf('name === "update_contact"');
  assertErrorDestructured(r, "update_contact");
  assertRefusalGuard(r, "update_contact");
}

// ---- update_team_member ----
{
  const r = regionOf('name === "update_team_member"');
  assertErrorDestructured(r, "update_team_member");
  assertRefusalGuard(r, "update_team_member");
}

// ---- delete_event ----
{
  const r = regionOf('name === "delete_event"');
  assertErrorDestructured(r, "delete_event");
  assertRefusalGuard(r, "delete_event");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
