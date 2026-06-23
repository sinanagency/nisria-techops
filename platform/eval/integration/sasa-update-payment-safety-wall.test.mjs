// update_payment safety wall (2026-06-23, KT #381). From the 727 failure-surface cartography
// (MONEY wrong-record cell): update_payment edits a logged payment. Two invariants must hold,
// or a vague edit mutates the WRONG money row:
//   1. SCOPE: it may only ever touch payments the BOT logged (ref like 'AI-WA-%'), never a
//      manual or bank-imported ledger entry.
//   2. NO SILENT NEWEST-PICK: with NO match criteria (no payee, no amount) AND more than one
//      candidate, it must ASK — not silently edit the newest (the removed slice(0,1)). A SOLE
//      logged payment is still unambiguous. Mirrors delete_task's "too generic to act" (KT #274).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ST = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "smart-tools.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

const i = ST.indexOf('if (name === "update_payment")');
const region = i >= 0 ? ST.slice(i, i + 2600) : "";

// ---- U1: scoped to bot-logged payments only (cannot corrupt manual/imported rows) ----
{
  if (!region) fail("U1 update_payment must exist");
  else if (!/ilike\("ref", "AI-WA-%"\)/.test(region)) fail("U1 update_payment must scope to bot-logged payments (ref AI-WA-%), never arbitrary ledger rows");
  else ok("U1 update_payment scoped to bot-logged payments only");
}

// ---- U2: the silent newest-pick fallback is GONE ----
{
  if (/!input\.match_payee && !input\.match_amount\) cands = cands\.slice\(0, 1\)/.test(region))
    fail("U2 update_payment must NOT silently slice to the newest when no match criteria (money wrong-record)");
  else ok("U2 no silent newest-pick on missing match criteria");
}

// ---- U3: the ambiguity guard asks when >1 candidate, BEFORE the update ----
{
  const askIdx = region.indexOf("cands.length > 1");
  const updIdx = region.indexOf('from("payments").update(patch)');
  if (askIdx < 0 || !/Which payment:/.test(region)) fail("U3a must ASK 'which payment' when more than one candidate");
  else ok("U3a >1 candidate → asks which payment");
  if (!(askIdx > 0 && updIdx > askIdx)) fail("U3b the ambiguity guard must run BEFORE the ledger update");
  else ok("U3b ambiguity guard precedes the update (no edit before disambiguation)");
}

// ---- U4: zero candidates refuses (no fabricated success) ----
{
  if (!/I could not find a payment I logged to correct/.test(region)) fail("U4 zero matches must refuse, not invent");
  else ok("U4 zero candidates → honest refuse");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
