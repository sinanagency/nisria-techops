// FLAG_NUR honesty wall (2026-06-22, skeptic F1). The group bot escalates to Nur on
// the 727 by returning "FLAG_NUR: <reason>". That reason fires EVEN in listen-only and
// is the one group-surface text Nur actually reads. The bug: runSasa returned the raw
// model text for this path, BYPASSING finalize() (the whole honesty chain), so a false
// completion/send claim inside the flag ("I recorded the case and notified the family")
// reached Nur ungated. Fix: strip the sentinel, run the reason through finalize(), then
// RE-PREFIX the sentinel so the caller's routing is unchanged.
//
// Proof split: this wall pins the STRUCTURE (the path routes through finalize + re-prefix,
// and the completion guard it relies on is NOT group-gated). The deployed guard VERDICT
// on the exact false-flag text is proven live via /api/gym guardcheck (guard:"completion").
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SASA = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "agents", "sasa.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);
const flat = (s) => s.replace(/\s+/g, " ");

// ---- N1: the FLAG_NUR path no longer returns the raw model text ----
{
  const i = SASA.indexOf("if (inGroup && /^\\s*FLAG_NUR:/i.test(modelText))");
  const region = i >= 0 ? SASA.slice(i, i + 600) : "";
  if (!region) fail("N1a the FLAG_NUR branch must exist");
  else ok("N1a FLAG_NUR branch exists");
  // must NOT be the old one-line raw return
  if (/test\(modelText\)\)\s*return\s*\{\s*reply:\s*modelText\.trim\(\)/.test(flat(SASA)))
    fail("N1b FLAG_NUR must NOT return the raw model text (the ungated bypass)");
  else ok("N1b FLAG_NUR no longer returns raw model text");
}

// ---- N2: the reason is run through finalize() then the sentinel is re-prefixed ----
{
  const i = SASA.indexOf("if (inGroup && /^\\s*FLAG_NUR:/i.test(modelText))");
  const region = i >= 0 ? SASA.slice(i, i + 600) : "";
  if (!/const reason = modelText\.replace\(\/\^\\s\*FLAG_NUR:\\s\*\/i, ""\)\.trim\(\)/.test(region))
    fail("N2a must strip the FLAG_NUR sentinel to get the bare reason");
  else ok("N2a strips the sentinel to the bare reason");
  if (!/const checked = await finalize\(reason\)/.test(region))
    fail("N2b must run the reason through finalize() (the honesty chain)");
  else ok("N2b runs the reason through finalize()");
  if (!/reply: `\$\{GROUP_FLAG\}: \$\{safeReason\}`/.test(region))
    fail("N2c must RE-PREFIX the sentinel so the caller's routing is unchanged");
  else ok("N2c re-prefixes the sentinel (routing preserved)");
}

// ---- N3: the completion guard finalize relies on is NOT group-gated ----
// (if it were `if (!inGroup)`-gated it would never run on the FLAG_NUR reason).
{
  const i = SASA.indexOf("function claimsCompletionWithoutSuccess");
  const region = i >= 0 ? SASA.slice(i, i + 200) : "";
  if (/!inGroup/.test(region)) fail("N3a claimsCompletionWithoutSuccess must NOT be group-gated");
  else ok("N3a completion guard is not group-gated (runs on the flag reason)");
}

// ---- N4: the caller still routes a FLAG_NUR reply to Nur on the 727 (unchanged contract) ----
{
  const ING = fs.readFileSync(path.resolve(HERE, "..", "..", "app", "api", "group", "ingest", "route.ts"), "utf8");
  if (!/\/\^\\s\*FLAG_NUR:\/i\.test\(reply/.test(ING)) fail("N4a group ingest must still detect the FLAG_NUR sentinel");
  else ok("N4a group ingest still detects the FLAG_NUR sentinel");
  if (!/group\.flagged_nur/.test(ING)) fail("N4b escalation must still emit group.flagged_nur + push to operators");
  else ok("N4b escalation still routes to Nur on the 727");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
