// Router unit tests — verifies domain classification accuracy.
// Pure local, no DB, no network, no Anthropic.

import { routeMessage, scoreDomains } from "../../lib/agents/router.js";
import { MANIFESTS, getToolsForDomain, TOOL_TO_DOMAIN, CROSS_CUTTING_TOOLS } from "../../lib/agents/manifests/index.js";

const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) fail(`${m} (got ${JSON.stringify(a)}, expected ${JSON.stringify(b)})`); else ok(m); };

console.log("\n=== ROUTER UNIT TESTS ===\n");

// ---- R1: Rule-based classification ----
{
  const work = scoreDomains("Remind me to call Mark at 3pm");
  if (work[0].domain !== "work") fail(`R1a work expected, got ${work[0].domain}`);
  else ok("R1a 'Remind me to call Mark' -> work");

  const money = scoreDomains("Paid Lucy 15000 salary");
  if (money[0].domain !== "money") fail(`R1b money expected, got ${money[0].domain}`);
  else ok("R1b 'Paid Lucy 15000 salary' -> money");

  const comms = scoreDomains("Tell Cynthia the meeting moved");
  if (comms[0].domain !== "comms") fail(`R1c comms expected, got ${comms[0].domain}`);
  else ok("R1c 'Tell Cynthia the meeting moved' -> comms");

  const people = scoreDomains("What's Mark's phone number");
  if (people[0].domain !== "people") fail(`R1d people expected, got ${people[0].domain}`);
  else ok("R1d 'What's Mark's phone number' -> people");

  const knowledge = scoreDomains("Find the KRA document");
  if (knowledge[0].domain !== "knowledge") fail(`R1e knowledge expected, got ${knowledge[0].domain}`);
  else ok("R1e 'Find the KRA document' -> knowledge");
}

// ---- R2: Manifests are complete and non-overlapping ----
{
  const allTools = new Set();
  for (const [domain, manifest] of Object.entries(MANIFESTS)) {
    if (domain === "general") continue; // General uses cross-cutting only
    for (const tool of manifest.tools) {
      if (CROSS_CUTTING_TOOLS.has(tool)) continue; // Cross-cutting allowed in all
      if (allTools.has(tool)) fail(`R2a tool ${tool} appears in multiple domains`);
      allTools.add(tool);
    }
  }
  if (!fail) ok("R2a no tool overlaps between domains");

  // Check TOOL_TO_DOMAIN reverse index
  for (const [tool, domain] of Object.entries(TOOL_TO_DOMAIN)) {
    if (CROSS_CUTTING_TOOLS.has(tool)) continue;
    const manifest = MANIFESTS[domain];
    if (!manifest.tools.includes(tool)) fail(`R2b ${tool} in index but not in ${domain} manifest`);
  }
  ok("R2b TOOL_TO_DOMAIN index matches manifests");
}

// ---- R3: getToolsForDomain returns correct subsets ----
{
  const workAdmin = getToolsForDomain("work", "admin");
  if (!workAdmin.includes("create_task")) fail("R3a work admin missing create_task");
  else ok("R3a work admin has create_task");

  const workTeam = getToolsForDomain("work", "team");
  if (workTeam.includes("delete_task")) fail("R3b work team should not have delete_task");
  else ok("R3b work team filtered correctly");

  const moneyAdmin = getToolsForDomain("money", "admin");
  if (!moneyAdmin.includes("record_payment")) fail("R3c money admin missing record_payment");
  else ok("R3c money admin has record_payment");

  const moneyTeam = getToolsForDomain("money", "team");
  if (moneyTeam.length > 0) fail("R3d money team should have no tools (admin only)");
  else ok("R3d money team has no tools (admin only domain)");
}

// ---- R4: Edge cases ----
{
  const empty = scoreDomains("");
  if (empty[0].score !== 0) fail("R4a empty message should score 0");
  else ok("R4a empty message scores 0");

  const greeting = scoreDomains("Hi how are you");
  if (greeting[0].score > 0.3) fail("R4b greeting should have low score");
  else ok("R4b greeting has low score");

  const multi = scoreDomains("Log the payment and remind Mark");
  // Should match both money and work
  const domains = multi.map((r) => r.domain);
  if (!domains.includes("money") || !domains.includes("work")) fail("R4c multi-domain should match both");
  else ok("R4c multi-domain matches both money and work");
}

// ---- R5: Guard leakage detection ----
{
  // Import the leakage check function
  const { checkDomainLeakage } = await import("../../lib/agents/orchestrator");

  // Work specialist calling money tool should leak
  const workLeak = checkDomainLeakage("", [{ name: "record_payment", result: { ok: true } }], "work");
  if (!workLeak.leakage) fail("R5a work calling record_payment should leak");
  else ok("R5a work calling record_payment detected as leakage");

  // Money specialist calling work tool should leak
  const moneyLeak = checkDomainLeakage("", [{ name: "create_task", result: { ok: true } }], "money");
  if (!moneyLeak.leakage) fail("R5b money calling create_task should leak");
  else ok("R5b money calling create_task detected as leakage");

  // Work specialist calling cross-cutting tool should NOT leak
  const workCross = checkDomainLeakage("", [{ name: "lookup_contact", result: { ok: true } }], "work");
  if (workCross.leakage) fail("R5c work calling lookup_contact should not leak");
  else ok("R5c work calling lookup_contact is allowed (cross-cutting)");

  // Money specialist calling money tool should NOT leak
  const moneyOk = checkDomainLeakage("", [{ name: "record_payment", result: { ok: true } }], "money");
  if (moneyOk.leakage) fail("R5d money calling record_payment should not leak");
  else ok("R5d money calling record_payment is allowed (same domain)");
}

if (process.exitCode) console.error("\nWALL RED."); else console.log("\nWALL GREEN.");
