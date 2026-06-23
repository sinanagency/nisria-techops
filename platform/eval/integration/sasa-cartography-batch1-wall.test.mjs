// 727 cartography batch-1 wall (2026-06-23). Two real holes the family probes found:
//   KT #382 — delete_payment silent newest-pick (money wrong-record, same class as #381).
//   KT #383 — task-digest honesty: the two WhatsApp "done" paths (group complete + emoji
//             reaction) omitted operator_task, so undefined!==false dropped EVERY team
//             completion from Nur's daily wrap-up. Fix at the emit (set from completer rank),
//             not the filter.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ST = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "smart-tools.ts"), "utf8");
const W = fs.readFileSync(path.resolve(HERE, "..", "..", "app", "api", "whatsapp", "worker", "route.ts"), "utf8");
const DG = fs.readFileSync(path.resolve(HERE, "..", "..", "app", "api", "cron", "task-digest", "route.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

// ---- B1: delete_payment no silent newest-pick; ambiguity guard intact; bot-logged scope ----
{
  const i = ST.indexOf('if (name === "delete_payment")');
  const region = i >= 0 ? ST.slice(i, i + 1100) : "";
  if (!region) fail("B1 delete_payment must exist");
  else if (/!input\.payee && !input\.amount\) cands = cands\.slice\(0, 1\)/.test(region))
    fail("B1a delete_payment must NOT silently slice to the newest payment (money wrong-record)");
  else ok("B1a delete_payment: no silent newest-pick");
  if (!/ilike\("ref", "AI-WA-%"\)/.test(region)) fail("B1b must stay scoped to bot-logged payments");
  else ok("B1b delete_payment scoped to bot-logged (AI-WA-%) only");
  if (!/cands\.length > 1\) return \{ ok: false[\s\S]*Which one should I remove/.test(region)) fail("B1c >1 candidate must still ask which one");
  else ok("B1c >1 candidate → asks (no blind delete)");
}

// ---- B2: both WhatsApp 'done' emits carry operator_task from the completer's rank ----
{
  // group-bot complete_task (smart-tools)
  if (!/type: "task\.completed", source: "agent:sasa",[\s\S]{0,260}operator_task: ctx\.rank === "owner" \|\| ctx\.rank === "founder"/.test(ST))
    fail("B2a group complete_task emit must set operator_task from ctx.rank");
  else ok("B2a group complete_task → operator_task from ctx.rank");
  // reaction-done (worker)
  if (!/source: "agent:sasa-reaction"[\s\S]{0,260}operator_task: opRank === "owner" \|\| opRank === "founder"/.test(W))
    fail("B2b reaction-done emit must set operator_task from opRank");
  else ok("B2b reaction-done → operator_task from opRank");
}

// ---- B3: the digest filter is unchanged (fix was at the emit, not by weakening the filter) ----
{
  if (!/operator_task === false/.test(DG)) fail("B3 the digest must still filter operator_task===false (fix belongs at the emit, not the filter)");
  else ok("B3 digest filter unchanged — team completions now arrive tagged, not by weakening the filter");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
