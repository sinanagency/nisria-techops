// Audit #6 + #9 wall (2026-06-29).
// #6: the /tasks "Open tasks" headline must use the canonical counts.ts head-count, not
//     openTasks.length off the capped limit(300) fetch (past 300 it silently undercounts).
// #9: composeBankSummary must group per currency, never blend KES/USD/AED under one tag.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TP = fs.readFileSync(path.resolve(HERE, "..", "..", "app", "tasks", "page.tsx"), "utf8");
const BI = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "bank-import.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

// ---- #6: tasks headline uses the canonical count ----
{
  if (!/import \{ openTasksCount \} from "\.\.\/\.\.\/lib\/counts"/.test(TP)) fail("#6a tasks page must import the canonical openTasksCount");
  else ok("#6a tasks page imports openTasksCount");
  if (!/const openCount = mine \? openTasks\.length : await openTasksCount\(db\);/.test(TP)) fail("#6b the everyone-view headline must use openTasksCount(db), the mine-view its filtered length");
  else ok("#6b headline count is canonical (everyone) / filtered (mine)");
  if (!/label="Open tasks" value=\{<span className="disp2">\{openCount\}<\/span>\}/.test(TP)) fail("#6c the Open tasks Stat must render openCount, not openTasks.length");
  else ok("#6c Open tasks Stat renders the canonical openCount");
  if (/label="Open tasks" value=\{<span className="disp2">\{openTasks\.length\}/.test(TP)) fail("#6d the headline must NOT render openTasks.length off the capped fetch");
  else ok("#6d headline no longer renders the capped .length");
}

// ---- #9: bank summary groups per currency ----
{
  if (!/const byCur = new Map/.test(BI)) fail("#9a composeBankSummary must accumulate per currency");
  else ok("#9a bank summary accumulates per currency");
  if (!/Total out \(\$\{cur\}\): \$\{money\(slot\.outTotal, cur\)\}/.test(BI)) fail("#9b each currency must get its own labeled total line");
  else ok("#9b one total line per currency, tagged with the currency");
  if (!/- \$\{m\} \(\$\{cur\}\): \$\{money\(c\.outSum, cur\)\} out/.test(BI)) fail("#9c each month line must be tagged with its currency and money()-rendered in it");
  else ok("#9c month lines are per-currency");
  // the old single-blend total (one money(outTotal, ccy) over all rows) must be gone
  if (/Total out: \$\{money\(outTotal, ccy\)\}/.test(BI)) fail("#9d the blended single Total-out under the first row's currency must be gone");
  else ok("#9d no blended cross-currency total");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
