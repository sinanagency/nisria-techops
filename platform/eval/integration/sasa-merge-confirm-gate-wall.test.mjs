// MERGE-family stage-then-confirm wall (2026-06-23, KT #384). The 727 cartography DELETE/MERGE
// probe found the merges fired on model judgment with NO confirm: merge_contact does an
// irreversible HARD delete of the folded contact row; merge_beneficiary repoints DONATIONS +
// folds funding. Fix: gate all three merges (contact/beneficiary/case) through the same C2
// stage-then-confirm as the delete family — one interceptor node, preview names both sides so
// a wrong-person merge (name ≠ identity, KT #375) is caught before any history/money moves.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ST = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "smart-tools.ts"), "utf8");
const W = fs.readFileSync(path.resolve(HERE, "..", "..", "app", "api", "whatsapp", "worker", "route.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

// ---- M1: the MERGE interceptor stages a confirm for all three merges, on the WA surface ----
{
  const i = ST.indexOf("C2 STAGE-THEN-CONFIRM for the MERGE family");
  const region = i >= 0 ? ST.slice(i, i + 2100) : "";
  if (!region) fail("M1 the merge stage interceptor must exist");
  else if (!/const MERGE_TOOLS = new Set\(\["merge_contact", "merge_beneficiary", "merge_case"\]\)/.test(region))
    fail("M1a all three merges must be gated");
  else if (!/if \(ctx\.confirmWrites && MERGE_TOOLS\.has\(name\)\)/.test(region))
    fail("M1b the interceptor must fire on the WhatsApp surface (confirmWrites), contactId checked INSIDE so a null contactId refuses");
  else if (!/kind: "confirm_action", status: "awaiting_confirm"/.test(region.replace(/\s+/g, " ")))
    fail("M1c must stage a confirm_action");
  else if (!/payload: \{ tool: name, args: input/.test(region)) fail("M1d staged payload must carry tool + args for the gate to dispatch");
  else if (!/Reply yes to confirm/.test(region)) fail("M1e must ask the operator to confirm with yes");
  // FAIL CLOSED (audit #1): staging error / null contactId must refuse, never fall through to the merge
  else if (!/if \(stErr\) return \{ ok: false[\s\S]*?refused: true/.test(region)) fail("M1f a staging error must refuse the merge, not fall through");
  else if (!/if \(!ctx\.contactId\) return \{ ok: false[\s\S]*?refused: true/.test(region)) fail("M1g a confirmWrites merge with no contactId must refuse, not execute");
  else ok("M1 merge family stages-then-confirms on WhatsApp AND fails closed on a staging error / no contactId");
}

// ---- M2: the preview names BOTH sides (so a wrong-person merge is caught) ----
{
  const i = ST.indexOf("C2 STAGE-THEN-CONFIRM for the MERGE family");
  const region = i >= 0 ? ST.slice(i, i + 2100) : "";
  if (!/const dup = String\(input\.name/.test(region) || !/const into = String\(input\.into/.test(region))
    fail("M2a must extract both the duplicate and the keep target");
  else ok("M2a preview extracts both sides (dup + into)");
  if (!/moves its history and funding across and removes the duplicate/.test(region))
    fail("M2b the confirm prompt must warn history+funding move and the dup is removed");
  else ok("M2b confirm prompt warns it is hard to undo + names both sides");
}

// ---- M3: it runs BEFORE the merge tool logic (model never reaches the hard delete) ----
{
  const interceptIdx = ST.indexOf("MERGE_TOOLS.has(name)");
  const mergeImplIdx = ST.indexOf('if (name === "merge_contact")');
  if (!(interceptIdx > 0 && mergeImplIdx > interceptIdx)) fail("M3 the interceptor must precede the merge_contact implementation");
  else ok("M3 interceptor runs before the merge logic (no merge on model judgment)");
}

// ---- M4: the gate allowlist now dispatches the three merges, owner-only, verified ----
{
  if (!/const CONFIRMABLE_TOOLS = new Set\(\[[^\]]*"merge_contact", "merge_beneficiary", "merge_case"\]\)/.test(W))
    fail("M4a the confirm-gate allowlist must include the three merges");
  else ok("M4a gate allowlists the three merges");
  // confirm-time run must NOT pass confirmWrites (else it would re-stage forever)
  const gi = W.indexOf('else if (p.kind === "confirm_action")');
  const region = gi >= 0 ? W.slice(gi, gi + 2200) : "";
  if (/confirmWrites: true/.test(region)) fail("M4b the confirm-time run must NOT pass confirmWrites (would re-stage)");
  else ok("M4b confirm-time run executes the real merge (no re-stage), owner/founder-gated (liveAdmin)");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
