// Cross-turn self-recall wall (2026-06-22, KT #372). LIVE 11:40pm: Sasa sent to Malieng,
// then 6s later said "I have not actually messaged them" and re-offered → it re-sent
// (Taona: "why u double sending... bot should have awareness of what it sent so it doesnt
// repeat"). Root cause: claimsSendWithoutSend sees only THIS turn's tools; the send landed
// in a PRIOR turn of the multi-step request. Fix: recentlySentTo() reads the REAL outbound
// log and matches via the shared recallMatch() (one contains the other / >=3-char prefix),
// so a claim about "Malek" finds a send logged under "Malieng". If found, the claim is TRUE
// → no lie, no re-offer (so no double-send). recentlySentTo's only non-pure part is the DB
// read; the MATCHING (the thing that broke) is the pure recallMatch tested here, and a
// seam check pins sasa.ts to it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recallMatch, isNameVariant } from "../../lib/name-variant.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SASA = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "agents", "sasa.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);
const T = (got, want, m) => (got === want ? ok(m) : fail(`${m} (got ${JSON.stringify(got)}, want ${want})`));

// ---- S1: the exact live bug — "Send it to Malek", a real send logged under "Malieng" ----
T(recallMatch(["Malieng"], ["Malek"], "Send it to Malek"), "Malieng",
  "S1a a send to 'Malieng' satisfies a claim about 'Malek' (variant) → no lie/re-offer");
T(recallMatch(["Malieng"], [], "Send it to Malek as well"), "Malieng",
  "S1b unnamed claim ('them') falls back to the command's 'to Malek' and still recalls the send");
T(recallMatch(["Malek Malieng"], ["Malek"], "tell Malek"), "Malek Malieng",
  "S1c a full-name 'Malek Malieng' is recalled for a 'Malek' claim (token match)");

// ---- S2: must NOT falsely recall — a different person, or nothing sent ----
T(recallMatch(["Grace"], ["Malek"], "Send it to Malek"), null,
  "S2a a send to Grace does NOT satisfy a claim about Malek (no variant) → guard still fires");
T(recallMatch([], ["Malek"], "Send it to Malek"), null,
  "S2b no recent outbound at all → null (the honest no-send path runs)");
T(recallMatch(["Wahome", "Cynthia"], ["Malek"], "Send it to Malek"), null,
  "S2c unrelated recent recipients → null");

// ---- S2b: the variant primitive is conservative ----
{
  if (!isNameVariant("Malek", "Malieng")) fail("S2d Malek<->Malieng must be a variant (shared 'mal')");
  else ok("S2d Malek<->Malieng is a variant");
  if (isNameVariant("Grace", "Malieng")) fail("S2e Grace<->Malieng must NOT be a variant");
  else ok("S2e Grace<->Malieng is not a variant");
  if (!isNameVariant("Malek", "Malek Malieng".split(" ")[0])) fail("S2f first-name token match");
  else ok("S2f first-name token matches");
}

// ---- S3: the guard branch consults the log BEFORE lying (seam), and shares the module ----
{
  if (!/import \{ recallMatch \} from "\.\.\/name-variant\.mjs";/.test(SASA))
    fail("S3a sasa.ts must import recallMatch from the shared module (zero drift)");
  else ok("S3a sasa.ts imports the shared recallMatch");
  const i = SASA.indexOf("} else if (claimsSendWithoutSend(reply, toolRuns)) {");
  const region = i >= 0 ? SASA.slice(i, i + 1400) : "";
  if (!/const alreadySent = await recentlySentTo\(db, extractClaimedRecipients\(reply\), opts\.command/.test(region))
    fail("S3b the send-claim branch must consult recentlySentTo BEFORE substituting");
  else ok("S3b the branch consults the outbound log before crying no-send");
  if (!/if \(alreadySent\) \{/.test(region)) fail("S3c a confirmed send must skip the lie + the re-offer");
  else ok("S3c a confirmed send skips the substitution (no double-send)");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
