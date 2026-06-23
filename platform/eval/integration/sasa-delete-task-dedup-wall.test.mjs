// delete_task duplicate-resolution wall (2026-06-23, KT #375). LIVE: Nur asked to delete one
// of two tasks identical except letter-case ("Contact Jensen..." vs "contact Jensen..."). The
// resolver matched both (ilike is case-insensitive), returned "which one?" forever, and the
// operator could NOT break the loop ("lowercase" re-ran the same match → still 2 → ambiguous).
// Fix: when the matches are DUPLICATES (same title ignoring case + whitespace) they are the
// SAME task, so "delete one of them" is unambiguous — delete one, keep the rest. A GENUINELY
// different second task still asks.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ST = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "smart-tools.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

// Pure mirror of the deployed decision: dedup if all candidate titles normalize to one.
const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
function resolve(cands) {
  if (cands.length <= 1) return { action: cands.length ? "delete" : "none" };
  const distinct = new Set(cands.map((c) => norm(c.title)));
  return distinct.size === 1 ? { action: "delete", deduped: true } : { action: "ask" };
}
const T = (got, want, m) => (JSON.stringify(got) === JSON.stringify(want) ? ok(m) : fail(`${m} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`));

// ---- D1: the exact live case — two tasks identical but for case → delete one, no loop ----
T(resolve([{ title: "Contact Jensen and send him the contract and catalogue" }, { title: "contact Jensen and send him the contract and catalogue" }]),
  { action: "delete", deduped: true }, "D1a case-only duplicates → delete one (no ambiguous loop)");
T(resolve([{ title: "Send Jensen the contract" }, { title: "Send Jensen  the contract " }]),
  { action: "delete", deduped: true }, "D1b whitespace-only duplicates → delete one");

// ---- D2: genuinely different tasks STILL ask (no over-delete) ----
T(resolve([{ title: "Contact Jensen and send the contract" }, { title: "Call the bank about the grant" }]),
  { action: "ask" }, "D2a two DIFFERENT tasks → still ask which one (no wrong delete)");
T(resolve([{ title: "Send Jensen the contract" }, { title: "Send Jensen the catalogue" }]),
  { action: "ask" }, "D2b similar-but-different (contract vs catalogue) → still ask");

// ---- D3: single / none unchanged ----
T(resolve([{ title: "x" }]), { action: "delete" }, "D3a single match → delete");
T(resolve([]), { action: "none" }, "D3b no match → none");

// ---- D4: the deployed code carries this decision (seam) ----
{
  const i = ST.indexOf('name === "delete_task"');
  const region = i >= 0 ? ST.slice(i, i + 2600) : "";
  const flat = region.replace(/\s+/g, " ");
  if (!/const distinct = new Set\(cands\.map\(\(c\) => norm\(c\.title\)\)\)/.test(flat)) fail("D4a delete_task must compute distinct normalized titles");
  else ok("D4a delete_task computes distinct normalized titles");
  if (!/if \(distinct\.size === 1\) \{ cands = \[cands\[cands\.length - 1\]\]/.test(flat))
    fail("D4b on all-duplicates it must collapse to one candidate (delete one)");
  else ok("D4b all-duplicates collapse to one (delete one, keep the rest)");
  if (!/wasDuplicate \? `Removed the duplicate "\$\{t\.title\}" and kept the other copy\.`/.test(ST)) fail("D4c the success message must say it removed the duplicate + kept the other");
  else ok("D4c the reply tells the operator it removed the duplicate and kept the copy");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
