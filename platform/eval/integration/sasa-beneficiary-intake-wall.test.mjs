// Beneficiary/case DM intake wall (2026-06-21, KT #359). add_beneficiary was MODEL-ONLY
// and the model wasn't calling it — the "Brian Simon" case Nur sent on 2026-06-20 was
// silently dropped, and there were ZERO bot-driven beneficiary writes in 14 days. Fix:
// an explicit intake in a DM is caught BEFORE the brain by a deterministic route that
// uses a GROUNDED Haiku extractor (only stated fields, no hallucination) then writes via
// add_beneficiary deterministically and confirms the real row. Owner/founder only; "case"
// → intake, "beneficiary" → accepted; no name → ask (never drop).
//
// Seams:
//   E1  the intake route exists before the brain, admin-gated, grounded-extractor +
//       deterministic add_beneficiary + confirm + markJobDone
//   E2  intent mirror: real intakes FIRE; reads/edits/counts do NOT
//   E3  "case" vs "beneficiary" routes casesIntake correctly
//
// Pure local (source-seam + behavioural mirror).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const W = fs.readFileSync(path.resolve(HERE, "..", "..", "app", "api", "whatsapp", "worker", "route.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

// ---- E1: route present, grounded, deterministic ----
{
  const i = W.indexOf("DETERMINISTIC BENEFICIARY/CASE INTAKE (KT #359)");
  const region = i >= 0 ? W.slice(i, i + 4200) : "";
  if (!region) fail("E1 the intake route must exist");
  else if (!(i < W.indexOf("let reply: string | undefined;"))) fail("E1 the intake route must run BEFORE the brain");
  else if (!/opRank === "owner" \|\| opRank === "founder"/.test(region)) fail("E1 intake must be owner/founder only (child-safeguarding data)");
  else if (!/claudeJSON\(/.test(region) || !/HAIKU/.test(region)) fail("E1 must use a grounded Haiku extractor (claudeJSON)");
  else if (!/NEVER invent, guess, or infer/.test(region)) fail("E1 the extractor prompt must forbid inventing fields (no hallucination)");
  else if (!/runSmartTool\("add_beneficiary"/.test(region)) fail("E1 the WRITE must be deterministic via add_beneficiary, not left to the model");
  else if (!/markJobDone\(job\.id\);\s*return;/.test(region)) fail("E1 a handled intake must markJobDone + return");
  else if (!/intake_needs_name|What's the person or family name/.test(region)) fail("E1 an intake with no extractable name must ASK, never drop it");
  else ok("E1 intake route: before brain, admin-only, grounded extractor → deterministic add_beneficiary → confirm/ask");
}

// ---- E2: intent mirror (fires on intakes, not on reads/edits/counts) ----
{
  const fires = (command) => (
    (/\b(?:new|add(?:\s+a)?|register|intake|create(?:\s+a)?|log(?:\s+a)?|onboard)\s+(?:a\s+)?(?:case|beneficiar(?:y|ies)|child|family)\b/i.test(command)
      || /\bthis\s+is\s+a\s+new\s+(?:case|beneficiary|child|family)\b/i.test(command))
    && !/\b(?:list|show|find|search|how\s+many|status|update|edit|set|delete|remove|merge|approve|decline|move)\b/i.test(command));
  // MUST fire
  if (!fires("new case: Brian Simon, 13, Uganda")) fail("E2 'new case: Brian...' must fire");
  else if (!fires("add a beneficiary named Amani, 12, Nairobi")) fail("E2 'add a beneficiary ...' must fire");
  else if (!fires("this is a new case, his name is Brian Simon from Uganda")) fail("E2 'this is a new case ...' must fire");
  else if (!fires("register a new child in the rescue program")) fail("E2 'register a new child' must fire");
  // MUST NOT fire — reads/counts
  else if (fires("how many beneficiaries do we have")) fail("E2 a count question must NOT fire");
  else if (fires("list the cases")) fail("E2 'list the cases' must NOT fire");
  else if (fires("show me the new case")) fail("E2 'show me the case' (read) must NOT fire");
  else if (fires("find the beneficiary Grace")) fail("E2 'find the beneficiary' must NOT fire");
  // MUST NOT fire — edits (handled by other routes/tools, not the add route)
  else if (fires("update the case for Brian")) fail("E2 'update the case' must NOT fire (edit, not add)");
  else if (fires("set Grace's funding to 1200")) fail("E2 'set funding' must NOT fire");
  else if (fires("approve the case for Amani")) fail("E2 'approve the case' must NOT fire");
  else ok("E2 intent mirror: real intakes fire; reads, counts, and edits all yield");
}

// ---- E3: case vs beneficiary routing ----
{
  const asCase = (command) => /\bcase\b/i.test(command) && !/\bbeneficiar/i.test(command);
  if (!asCase("new case: Brian, 13, Uganda")) fail("E3 'new case' must route to intake (casesIntake true)");
  else if (asCase("add a beneficiary named Amani")) fail("E3 'beneficiary' must NOT be a case (accepted record)");
  else if (asCase("add a case beneficiary")) fail("E3 a message naming both must default to beneficiary (not a case) to avoid mis-intake");
  else if (!/casesIntake: asCase/.test(W)) fail("E3 the add call must pass casesIntake from the case/beneficiary word");
  else ok("E3 'case' → intake_stage; 'beneficiary' → accepted; the write passes casesIntake");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
