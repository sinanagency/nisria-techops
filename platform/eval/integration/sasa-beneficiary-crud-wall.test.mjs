// Beneficiary CRUD + case-shape guard wall (2026-06-21, KT #348). Nur reported she
// could not add new cases/beneficiaries via the bot, nor edit existing beneficiaries
// on the portal. Two fixes:
//   (1) PORTAL: the accepted-beneficiary surface had no edit/archive/merge/create
//       actions or UI (only status + consent). Added them, guarded to
//       `intake_stage IS NULL` so they never touch a case; DELETE is a SOFT archive
//       (status='exited', restorable) because these are vulnerable-people records.
//   (2) BOT: the honesty guard's SHAPE_CASE regex matches the word "beneficiary",
//       but CASE_TOOLS excluded add_beneficiary/update_beneficiary — so a truthful
//       "I added X as a beneficiary" reply was rewritten to a reask, making the add
//       look failed. The case shape now backs on CASE_OR_BENEFICIARY_TOOLS.
//
// Seams:
//   S1  the 5 beneficiary actions exist and are exported
//   S2  every write guards to intake_stage IS NULL (accepted only, never a case)
//   S3  delete is a SOFT archive (status 'exited'); merge archives the dup, never hard-deletes
//   S4  BeneficiaryManage UI is wired into the 360 page (edit/merge/archive)
//   S5  the guard fix: CASE_OR_BENEFICIARY_TOOLS includes the beneficiary write tools
//       AND backs the case shape (so beneficiary-add success replies aren't eaten)
//
// Pure local (source-seam).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const R = (p) => fs.readFileSync(path.resolve(HERE, "..", "..", p), "utf8");
const ACT = R("app/beneficiaries/actions.ts");
const PAGE = R("app/beneficiaries/[id]/page.tsx");
const MANAGE = R("components/BeneficiaryManage.tsx");
const SASA = R("lib/agents/sasa.ts");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

// ---- S1 ----
{
  const need = ["editBeneficiary", "archiveBeneficiary", "restoreBeneficiary", "mergeBeneficiary", "createBeneficiary"];
  const missing = need.filter((n) => !new RegExp(`export async function ${n}\\(`).test(ACT));
  if (missing.length) fail("S1 missing beneficiary actions: " + missing.join(", "));
  else ok("S1 edit/archive/restore/merge/create actions exported");
}

// ---- S2: accepted-only guard (intake_stage IS NULL) on edit/archive/restore/merge ----
{
  const guarded = ["editBeneficiary", "archiveBeneficiary", "restoreBeneficiary", "mergeBeneficiary"];
  let bad = null;
  for (const fn of guarded) {
    const i = ACT.indexOf(`export async function ${fn}(`);
    const region = ACT.slice(i, i + 1600);
    if (!/\.is\("intake_stage",\s*null\)/.test(region)) { bad = fn; break; }
  }
  if (bad) fail(`S2 ${bad} must guard to intake_stage IS NULL (accepted beneficiaries only)`);
  else ok("S2 all writes guard to accepted beneficiaries (never a case)");
}

// ---- S3: soft-delete semantics ----
{
  const arc = ACT.slice(ACT.indexOf("function archiveBeneficiary"), ACT.indexOf("function archiveBeneficiary") + 900);
  const mrg = ACT.slice(ACT.indexOf("function mergeBeneficiary"), ACT.indexOf("function mergeBeneficiary") + 2600);
  if (!/status:\s*"exited"/.test(arc)) fail("S3 archive must SOFT-delete (status 'exited'), not hard delete");
  else if (/\.delete\(\)/.test(arc) || /\.delete\(\)/.test(mrg)) fail("S3 archive/merge must NOT hard-delete a beneficiary row");
  else if (!/status:\s*"exited"/.test(mrg)) fail("S3 merge must archive the duplicate (status 'exited'), not delete it");
  else ok("S3 delete is a soft archive; merge archives the dup, never hard-deletes");
}

// ---- S4: UI wired ----
{
  if (!/import BeneficiaryManage/.test(PAGE) || !/<BeneficiaryManage\b/.test(PAGE)) fail("S4 the 360 page must render <BeneficiaryManage>");
  else if (!/editBeneficiary|mergeBeneficiary|archiveBeneficiary/.test(MANAGE)) fail("S4 BeneficiaryManage must wire the edit/merge/archive actions");
  else if (!/!isCase/.test(PAGE)) fail("S4 Manage must only show for accepted beneficiaries (not a case)");
  else ok("S4 BeneficiaryManage wired into the 360 page (accepted only)");
}

// ---- S5: the honesty-guard fix ----
{
  if (!/CASE_OR_BENEFICIARY_TOOLS\s*=\s*new Set\(\[\s*\.\.\.CASE_TOOLS/.test(SASA)) fail("S5 must define CASE_OR_BENEFICIARY_TOOLS extending CASE_TOOLS");
  else if (!/CASE_OR_BENEFICIARY_TOOLS[^;]*"add_beneficiary"[^;]*"update_beneficiary"/.test(SASA)) fail("S5 the set must include add_beneficiary + update_beneficiary");
  else if (!/regex:\s*SHAPE_CASE,\s*requiredTools:\s*CASE_OR_BENEFICIARY_TOOLS/.test(SASA)) fail("S5 the case shape must back on CASE_OR_BENEFICIARY_TOOLS (so beneficiary-add replies aren't eaten)");
  else ok("S5 case shape backs beneficiary write tools (add/update no longer misread as fabricated)");
}

// ---- S5b: behavioural — mirror the shape check for a beneficiary-add reply ----
{
  const CASE_TOOLS = ["approve_case", "decline_case", "move_case", "edit_case", "merge_case", "delete_case"];
  const CASE_OR_BEN = new Set([...CASE_TOOLS, "add_beneficiary", "update_beneficiary", "set_public_profile", "set_beneficiary_funding", "delete_beneficiary", "merge_beneficiary"]);
  const SHAPE_CASE = /\b(?:case|beneficiary|merged?\s+\w+'?s?\s+case)\b/i;
  const okIn = (runs, set) => runs.some((t) => set.has(t.name) && t.result?.ok === true);
  // a real add: reply says "beneficiary", add_beneficiary ran ok -> shape is satisfied -> NOT a fabrication
  const reply = "I've added Amani as a new beneficiary in the rescue program.";
  const shapeMatches = SHAPE_CASE.test(reply);
  const satisfied = okIn([{ name: "add_beneficiary", result: { ok: true } }], CASE_OR_BEN);
  if (!shapeMatches) fail("S5b sanity: SHAPE_CASE should match the word 'beneficiary'");
  else if (!satisfied) fail("S5b a real add_beneficiary success must satisfy the case shape (no reask)");
  // and a fabricated 'beneficiary' claim with no beneficiary/case tool still fails the shape
  else if (okIn([{ name: "remember_fact", result: { ok: true } }], CASE_OR_BEN)) fail("S5b an unrelated tool must NOT satisfy the beneficiary/case shape");
  else ok("S5b real beneficiary-add passes the guard; a fabricated one still caught");
}

// ---- S6: bot delete_beneficiary + merge_beneficiary tools (KT #348 parity) ----
{
  const SMART = R("lib/smart-tools.ts");
  // registry defs
  if (!/\{ name: "delete_beneficiary"/.test(SMART) || !/\{ name: "merge_beneficiary"/.test(SMART)) fail("S6 bot must expose delete_beneficiary + merge_beneficiary tool defs");
  else {
    const del = SMART.slice(SMART.indexOf('name === "delete_beneficiary"'), SMART.indexOf('name === "delete_beneficiary"') + 1400);
    const mrg = SMART.slice(SMART.indexOf('name === "merge_beneficiary"'), SMART.indexOf('name === "merge_beneficiary"') + 3600);
    if (!del || !mrg) fail("S6 missing bot handler impls");
    else if (!/status:\s*"exited"/.test(del) || /\.delete\(\)/.test(del)) fail("S6 bot delete_beneficiary must SOFT-archive (status 'exited'), never hard delete");
    else if (!/\.is\("intake_stage",\s*null\)/.test(del) || !/\.is\("intake_stage",\s*null\)/.test(mrg)) fail("S6 bot delete/merge must guard to accepted beneficiaries (intake_stage IS NULL)");
    else if (!/ctx\.tier === "team"/.test(del) || !/ctx\.tier === "team"/.test(mrg)) fail("S6 bot delete/merge must refuse team tier (admin only)");
    else if (!/status:\s*"exited"/.test(mrg) || /\.delete\(\)/.test(mrg)) fail("S6 bot merge must archive the dup (status 'exited'), never hard delete");
    else ok("S6 bot delete/merge_beneficiary: soft-archive, accepted-only, admin-only");
  }
}

// ---- S7: completion guard backs the new tools (no eaten replies) ----
{
  if (!/"delete_beneficiary",\s*"merge_beneficiary"/.test(SASA)) fail("S7 COMPLETION_TOOLS + CASE_OR_BENEFICIARY_TOOLS must include delete_beneficiary + merge_beneficiary");
  else ok("S7 delete/merge_beneficiary completion claims are backed (not misread as fabricated)");
}

// ---- S8: portal Add button wired ----
{
  const LIST = R("app/beneficiaries/page.tsx");
  const ADD = R("components/BeneficiaryAdd.tsx");
  if (!/import BeneficiaryAdd/.test(LIST) || !/<BeneficiaryAdd\b/.test(LIST)) fail("S8 the list page must render <BeneficiaryAdd>");
  else if (!/createBeneficiary/.test(ADD)) fail("S8 BeneficiaryAdd must call createBeneficiary");
  else ok("S8 portal manual Add-beneficiary button wired to createBeneficiary");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
