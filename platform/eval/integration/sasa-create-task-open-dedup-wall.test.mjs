// create_task OPEN-DUPLICATE dedup wall (2026-06-23, KT #378). From the 727 failure-surface
// cartography (multiplicity cell, TAG 6): "Write the weekly newsletter" landed ×3 and
// "Follow up with Mamoun" ×2 in prod because the deterministic parseTasks path only deduped
// on (source_kind, source_id, title) — two DIFFERENT inbound messages = different source_id
// = no dedup. Fix = ONE shared helper (findOpenDuplicate) used at BOTH create paths
// (smart-tool create_task + worker parseTasks insert): block a new task identical to an
// already-OPEN one for the SAME assignee.
//
// INVERSE-SAFETY (the cells this fix must NOT open):
//   - two DIFFERENT people's same-titled tasks must STILL both exist (KT #375 identity).
//   - a COMPLETED copy must STILL allow a fresh instance (recurrence-safe) — guaranteed by
//     the caller fetching only non-done rows; the wall asserts both call sites do .neq("status","done").
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findOpenDuplicate, isSameOpenTask } from "../../lib/match-dedup.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ST = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "smart-tools.ts"), "utf8");
const W = fs.readFileSync(path.resolve(HERE, "..", "..", "app", "api", "whatsapp", "worker", "route.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

// ---- C1: exact open duplicate (same assignee) is caught ----
{
  const open = [{ id: "a", title: "Write the weekly newsletter", assignee_id: "nur" }];
  const d = findOpenDuplicate(open, "Write the weekly newsletter", "nur");
  if (d?.id !== "a") fail("C1 exact same-assignee open duplicate must be caught");
  else ok("C1 exact open duplicate (same assignee) → deduped");
}

// ---- C2: case / whitespace variant is caught (the prod ×3 leak) ----
{
  const open = [{ id: "a", title: "Write the weekly newsletter", assignee_id: "nur" }];
  if (findOpenDuplicate(open, "write   the weekly  newsletter", "nur")?.id !== "a")
    fail("C2 case/space-variant duplicate must be caught (the newsletter ×3 leak)");
  else ok("C2 case/space variant → deduped");
}

// ---- C3 (INVERSE-SAFETY): two DIFFERENT people's same-titled tasks both survive ----
{
  const open = [{ id: "mk", title: "Call the bank", assignee_id: "mark" }];
  if (findOpenDuplicate(open, "Call the bank", "eliza") !== null)
    fail("C3 same title + DIFFERENT assignee must NOT dedup (Mark's vs Eliza's task)");
  else ok("C3 same-title-different-assignee → NOT deduped (identity preserved, KT #375)");
  // and the SAME assignee on that title still dedups
  if (findOpenDuplicate(open, "call the BANK", "mark")?.id !== "mk")
    fail("C3b same title + same assignee still dedups");
  else ok("C3b same-title-same-assignee → deduped");
}

// ---- C4 (INVERSE-SAFETY): genuinely different titles are NOT deduped ----
{
  const open = [{ id: "a", title: "Send the contract", assignee_id: "nur" }];
  if (findOpenDuplicate(open, "Send the catalogue", "nur") !== null)
    fail("C4 different titles must NOT dedup");
  else ok("C4 different titles → NOT deduped");
}

// ---- C5: unassigned (null/"") compare equal; empty open list → null ----
{
  if (!isSameOpenTask("X", null, "x", "")) fail("C5a null vs '' assignee must compare equal (both unassigned)");
  else ok("C5a unassigned null/'' compare equal");
  if (findOpenDuplicate([], "anything", "nur") !== null) fail("C5b empty open list → null");
  else ok("C5b empty open list → null");
}

// ---- C6: BOTH call sites wired + recurrence-safe (fetch only non-done) ----
{
  // smart-tool create_task
  if (!/import \{ pickFromMatches, isAllDuplicates, findOpenDuplicate \} from "\.\/match-dedup\.mjs";/.test(ST))
    fail("C6a smart-tools must import findOpenDuplicate");
  else ok("C6a smart-tools imports findOpenDuplicate");
  const ctI = ST.indexOf('if (name === "create_task")');
  const ctRegion = ctI >= 0 ? ST.slice(ctI, ctI + 6000) : "";
  if (!/findOpenDuplicate\(openRows \|\| \[\], title, member\?\.id \|\| null\)/.test(ctRegion))
    fail("C6b smart-tool create_task must call findOpenDuplicate keyed on the RESOLVED assignee");
  else ok("C6b smart-tool dedups on title + resolved assignee");
  if (!/from\("tasks"\)\.select\("id,title,assignee_id"\)\.neq\("status", "done"\)/.test(ctRegion))
    fail("C6c smart-tool must fetch only non-done rows (recurrence-safe)");
  else ok("C6c smart-tool fetches only non-done (recurrence-safe)");
  // worker parseTasks path
  if (!/import \{ findOpenDuplicate \} from "\.\.\/\.\.\/\.\.\/\.\.\/lib\/match-dedup\.mjs";/.test(W))
    fail("C6d worker must import findOpenDuplicate");
  else ok("C6d worker imports findOpenDuplicate");
  if (!/findOpenDuplicate\(openRows \|\| \[\], t\.title, t\.assignee_id \|\| null\)/.test(W))
    fail("C6e worker parseTasks insert must run the open-dup check before insert");
  else ok("C6e worker parseTasks dedups before insert");
  // recurrence-safety in worker too
  const wIdx = W.indexOf("OPEN-DUPLICATE dedup (KT #378");
  const wRegion = wIdx >= 0 ? W.slice(wIdx, wIdx + 700) : "";
  if (!/\.neq\("status", "done"\)/.test(wRegion)) fail("C6f worker open-dup check must fetch only non-done (recurrence-safe)");
  else ok("C6f worker fetches only non-done (recurrence-safe)");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
