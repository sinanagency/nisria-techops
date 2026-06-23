// Child-safeguarding name-resolution wall (2026-06-23, KT #385). The 727 cartography intake-edit
// probe found set_public_profile / set_beneficiary_funding resolve a beneficiary by fuzzy
// ilike('%name%') and act on the SOLE substring hit — so "fund Mary" could write the wrong
// child's funding bar / public story. Fix: exact-match preference + a bare-first-name floor on
// these two child-facing writes. Pure decision (lib/resolve-name.mjs) imported by code + wall.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyNameMatch, isBareFirstName, normName } from "../../lib/resolve-name.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ST = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "smart-tools.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

// ---- N1: exact match preferred over a longer substring ----
{
  const list = [{ id: "a", full_name: "Mary" }, { id: "b", full_name: "Mary Atieno" }];
  const m = classifyNameMatch(list, "Mary", "full_name");
  if (m.kind !== "exact-one" || m.pick.id !== "a") fail("N1 an exact name match must be preferred over a substring sibling");
  else ok("N1 exact match preferred over longer substring");
}

// ---- N2: the live risk — bare first name + sole FUZZY hit → must NOT auto-act ----
{
  const list = [{ id: "b", full_name: "Mary Atieno" }];
  const m = classifyNameMatch(list, "Mary", "full_name");
  if (m.kind !== "fuzzy-one") fail("N2a 'Mary' over sole 'Mary Atieno' is a fuzzy-one");
  else ok("N2a sole substring hit on a first name → fuzzy-one");
  if (!isBareFirstName("Mary")) fail("N2b 'Mary' must read as a bare first name");
  else ok("N2b 'Mary' is a bare first name (→ confirm, not act)");
  if (isBareFirstName("Mary Atieno")) fail("N2c a full name must NOT be a bare first name");
  else ok("N2c 'Mary Atieno' is a full name (→ acts normally)");
}

// ---- N3: multi-match still asks; none → none ----
{
  if (classifyNameMatch([{ id: "a", full_name: "Mary K" }, { id: "b", full_name: "Mary N" }], "Mary", "full_name").kind !== "fuzzy-many")
    fail("N3a two substring matches must ask (fuzzy-many)");
  else ok("N3a two substring matches → ask");
  if (classifyNameMatch([], "Mary", "full_name").kind !== "none") fail("N3b empty → none");
  else ok("N3b empty → none");
  // a full-name sole fuzzy hit still ACTS (no needless friction)
  if (isBareFirstName("Grace Wanjiru")) fail("N3c full name must act, not confirm");
  else ok("N3c full-name command acts normally (no friction)");
}

// ---- N4: normName case/space-insensitive (so 'mary' == 'Mary') ----
{
  if (classifyNameMatch([{ id: "a", full_name: "Mary" }], "  MARY ", "full_name").kind !== "exact-one")
    fail("N4 exact match must be case/space-insensitive");
  else ok("N4 exact match is case/space-insensitive");
}

// ---- N5: the safeguarding resolver is wired to the shared decision + the floor ----
{
  if (!/import \{[^}]*classifyNameMatch[^}]*isBareFirstName[^}]*\} from "\.\/resolve-name\.mjs";/.test(ST))
    fail("N5a smart-tools must import the shared name resolver");
  else ok("N5a smart-tools imports resolve-name");
  const i = ST.indexOf("CHILD-SAFEGUARDING resolver (KT #385");
  const region = i >= 0 ? ST.slice(i, i + 1100) : "";
  if (!/classifyNameMatch\(list, nm, "full_name"\)/.test(region)) fail("N5b must classify via the shared resolver");
  else ok("N5b uses classifyNameMatch");
  if (!/nameMatch\.kind === "fuzzy-one" && isBareFirstName\(nm\)/.test(region)) fail("N5c must apply the bare-first-name floor");
  else ok("N5c applies the bare-first-name floor (confirm, not write)");
  if (!/will not act on a first name alone/.test(region)) fail("N5d must tell the operator to give the full name");
  else ok("N5d asks for the full name on a bare-name sole match");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
