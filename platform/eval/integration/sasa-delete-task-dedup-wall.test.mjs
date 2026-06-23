// Ambiguity-loop class wall (2026-06-23, KT #375). LIVE: Nur asked to delete one of two tasks
// identical except letter-case ("Contact Jensen..." vs "contact Jensen..."). The resolver
// matched both (case-insensitive ilike), asked "which one?", and she could NOT break the loop
// ("lowercase" re-ran the same match → still 2 → asked again forever).
//
// Fix = ONE shared helper (lib/match-dedup.mjs) applied at the TASK resolvers (complete/update/
// reopen/delete_task): when matches are TRUE duplicates they are the same task → act on one;
// genuinely different tasks still ask. CRITICAL inverse-safety: the duplicate key is title AND
// assignee (two people can share a task title), and the helper is applied ONLY to tasks — NOT
// to people/cases/contacts/payments (a name is NOT an identity; two children can share a name),
// where collapsing would act on the wrong record.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pickFromMatches, isAllDuplicates } from "../../lib/match-dedup.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ST = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "smart-tools.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);
const key = (c) => `${c.title}|${c.assignee_id || ""}`;

// ---- D1: the exact live case — two tasks identical but for case, same owner → act on one ----
{
  const dupes = [{ title: "Contact Jensen and send him the contract and catalogue", assignee_id: "nur" },
                 { title: "contact Jensen and send him the contract and catalogue", assignee_id: "nur" }];
  const picked = pickFromMatches(dupes, key);
  if (!picked) fail("D1a case-only duplicates (same owner) must resolve to ONE, not loop");
  else ok("D1a case-only duplicates → act on one (no ambiguous loop)");
  if (!isAllDuplicates(dupes, key)) fail("D1b must recognise them as all-duplicates");
  else ok("D1b recognised as all-duplicates (reply can say 'removed the duplicate')");
}

// ---- D2: genuinely different tasks STILL ask (no wrong action) ----
{
  // same title, DIFFERENT assignee = two different people's tasks → must NOT collapse
  const diffOwner = [{ title: "Call the bank", assignee_id: "mark" }, { title: "Call the bank", assignee_id: "eliza" }];
  if (pickFromMatches(diffOwner, key) !== null) fail("D2a same title + DIFFERENT assignee must NOT collapse (Mark's vs Eliza's task)");
  else ok("D2a same-title-different-assignee → ask (the inverse-safety catch)");
  // different titles → ask
  const diffTitle = [{ title: "Send the contract", assignee_id: "nur" }, { title: "Send the catalogue", assignee_id: "nur" }];
  if (pickFromMatches(diffTitle, key) !== null) fail("D2b different titles must NOT collapse");
  else ok("D2b different titles → ask");
}

// ---- D3: single / none ----
{
  if (pickFromMatches([{ title: "x", assignee_id: "a" }], key)?.title !== "x") fail("D3a single match → that one");
  else ok("D3a single match → act");
  if (pickFromMatches([], key) !== null) fail("D3b no match → null");
  else ok("D3b no match → null");
}

// ---- D4: the SAFE scope — collapse applied to TASKS only, NOT to people/cases/docs ----
{
  // the 4 task resolvers key on title + assignee
  const taskKeyCount = (ST.match(/assignee_id \|\| ""/g) || []).length;
  if (taskKeyCount < 4) fail("D4a all four task resolvers (complete/update/reopen/delete_task) must key on title+assignee");
  else ok("D4a the four task resolvers collapse on title+assignee (safe)");
  // delete_case must NOT collapse (a case is a person; two children can share a name)
  const caseI = ST.indexOf("do NOT collapse \"duplicates\" by name here");
  if (caseI < 0) fail("D4b delete_case must explicitly NOT collapse by name (person identity)");
  else ok("D4b delete_case does NOT collapse by name (two children can share a name)");
  // delete_document must NOT collapse (versions)
  if (!/do NOT collapse by title/.test(ST)) fail("D4c delete_document must NOT collapse by title (versions)");
  else ok("D4c delete_document does NOT collapse by title");
  // the helper is imported
  if (!/import \{[^}]*pickFromMatches[^}]*isAllDuplicates[^}]*\} from "\.\/match-dedup\.mjs";/.test(ST)) fail("D4d smart-tools must import the shared helper");
  else ok("D4d smart-tools imports the shared dedup helper");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
