// Cases-intake default wall (2026-06-22, Bug 3 / KT #367). Two bugs in the DM intake
// route (app/api/whatsapp/worker/route.ts):
//   1. asCase = `case && !beneficiar` was defeated by "new case, not a beneficiary"
//      — the word "beneficiary" ANYWHERE flipped a clear case into an ACCEPTED
//      beneficiary (auto-accepted into the active roster, wrong + unsafe).
//   2. Intake was owner/founder-only, so a team member reporting a case in a DM got
//      nothing (the team tier doctrine explicitly allows beneficiary intakes).
// Fix: DEFAULT TO A CASE (intake/under_review, never auto-accept). A record is an
// ACCEPTED beneficiary ONLY when an ADMIN explicitly says "beneficiary" without "case".
// A team member can ONLY ever open a case. Gate widened to team-with-bot_access.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { intakeIsCase } from "../../lib/intake-class.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const W = fs.readFileSync(path.resolve(HERE, "..", "..", "app", "api", "whatsapp", "worker", "route.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

// The REAL deployed classifier (shared module, imported by the worker too — zero drift).
const asCaseDecision = (cmd, isAdmin) => intakeIsCase(cmd, isAdmin);
const T = (got, want, m) => (got === want ? ok(m) : fail(`${m} (got ${got}, want ${want})`));

// ---- C1: the "not a beneficiary" bug is dead ----
T(asCaseDecision("new case: Brian Simon, 13", true), true, "C1a admin 'new case' -> CASE");
T(asCaseDecision("new beneficiary: Brian Simon", true), false, "C1b admin 'new beneficiary' -> ACCEPTED");
T(asCaseDecision("new case, not a beneficiary: Brian", true), true, "C1c admin 'new case, not a beneficiary' -> CASE (the bug)");
T(asCaseDecision("add a child: Mercy, 7", true), true, "C1d admin bare 'child' -> CASE (safe default, never auto-accept)");
T(asCaseDecision("register a family: the Otienos", true), true, "C1e admin bare 'family' -> CASE (safe default)");
T(asCaseDecision("new beneficiary case: Brian", true), true, "C1f admin 'beneficiary case' -> CASE (case wins, intake is the safe side)");

// ---- C2: a team member can ONLY ever open a CASE ----
T(asCaseDecision("new beneficiary: Brian", false), true, "C2a team 'new beneficiary' -> still a CASE (never auto-accept)");
T(asCaseDecision("new case: Brian", false), true, "C2b team 'new case' -> CASE");
T(asCaseDecision("add a child: Mercy", false), true, "C2c team bare 'child' -> CASE");

// ---- C3: the deployed worker uses the shared classifier (seam, zero drift) ----
{
  if (!/import \{ intakeIsCase \} from ".*intake-class\.mjs"/.test(W))
    fail("C3a worker must import the shared intakeIsCase classifier");
  else ok("C3a worker imports the shared classifier");
  if (!/const asCase = intakeIsCase\(command, isAdminIntake\)/.test(W))
    fail("C3b worker must classify via intakeIsCase(command, isAdminIntake)");
  else ok("C3b worker classifies via the shared module (no inline drift)");
}

// ---- C4: the intake gate is widened to team-with-bot_access (Bug 3 part 2) ----
{
  if (!/const canIntake = isAdminIntake \|\| \(role === "team" && botAccess === true\)/.test(W))
    fail("C4a intake must be open to owner/founder OR a team member with bot_access");
  else ok("C4a intake gate widened to team-with-bot_access");
  // a team intake must pass casesIntake true and tier 'team'
  if (!/tier: isAdminIntake \? "admin" : "team"/.test(W)) fail("C4b a team intake must run as tier 'team'");
  else ok("C4b team intake runs as tier 'team'");
  if (!/I've opened it as a case for Nur to review/.test(W)) fail("C4c a team intake must tell them it's a case for Nur to review");
  else ok("C4c team intake confirms it's a case for Nur");
}

// ---- C6: SAME-NODE FLOOR at the primitive (skeptic finding) ----
// add_beneficiary is a TEAM tool the brain can call directly, bypassing the route guard.
// The never-auto-accept invariant must live at the primitive (smart-tools.ts) where the
// route AND the brain converge, forcing a case for ANY team-tier call.
{
  const ST = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "smart-tools.ts"), "utf8");
  const i = ST.indexOf('name === "add_beneficiary"');
  const region = i >= 0 ? ST.slice(i, i + 4000) : "";
  if (!/const casesIntake = ctx\.casesIntake \|\| ctx\.tier === "team"/.test(region))
    fail("C6a add_beneficiary must FORCE a case for any team-tier call (brain-path leak floor)");
  else ok("C6a add_beneficiary forces a case for any team-tier call (same-node floor)");
  if (!/if \(casesIntake\) \{/.test(region))
    fail("C6b the case branch must key on the FORCED casesIntake, not the raw ctx flag");
  else ok("C6b case branch keys on the forced casesIntake");
}

// ---- C5: never auto-accept — the only path to an ACCEPTED record is admin+beneficiary-only ----
// (belt-and-braces: assert no decision returns false for a team member)
{
  const teamFalse = ["new beneficiary: X", "beneficiary X", "accept X as a beneficiary", "new case: X"]
    .some((c) => asCaseDecision(c, false) === false);
  if (teamFalse) fail("C5a a team member must NEVER produce an accepted beneficiary");
  else ok("C5a a team member can never auto-accept (every team intake is a case)");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
