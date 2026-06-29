// Audit #2/#3/#4 honesty wall (2026-06-29). Funder/board + dashboard figures and the inbox
// must fail LOUD, never fake success: a DB error must not render as $0, a USD total must not
// include non-USD rows, and a thread must not be marked answered when nothing was sent.
// Source-assertion wall, offline.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const RB = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "report-builder.ts"), "utf8");
const EX = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "expenses.ts"), "utf8");
const IN = fs.readFileSync(path.resolve(HERE, "..", "..", "app", "inbox", "actions.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

// ---- #3: report figures fail loud on a DB error (no fake $0) ----
{
  if (!/if \(donRes\.error \|\| payRes\.error\) \{[\s\S]*?throw new Error/.test(RB)) fail("#3a computeFigures must throw on a donations/payments query error, not render $0");
  else ok("#3a report figures throw on a query error (no fake zeros)");
  if (!/if \(payRes\.error \|\| bankRes\.error\) \{[\s\S]*?throw new Error/.test(EX)) fail("#3b loadExpenses must throw on a query error (the /finance Money-Out headline reads it)");
  else ok("#3b loadExpenses throws on a query error");
}

// ---- #4: report income sum is USD-only (currency-never-mix) ----
{
  if (!/const incomeUsd = succeeded\.filter\(isUsd\)\.reduce/.test(RB)) fail("#4a the USD income total must filter isUsd (the expense side already does)");
  else ok("#4a report income total is USD-only");
}

// ---- #2: inbox reply only closes the thread on a real successful send ----
{
  if (!/let status = "failed";/.test(IN)) fail("#2a sendReply must default status to 'failed', not 'replied'");
  else ok("#2a sendReply defaults to failed");
  // success is set only AFTER sendEmail resolves
  if (!/await sendEmail\([\s\S]*?\);\s*\n\s*status = "replied";/.test(IN)) fail("#2b status becomes 'replied' only after sendEmail succeeds");
  else ok("#2b status flips to replied only after a successful send");
  if (!/if \(contact_id && status === "replied"\) await admin\(\)\.from\("messages"\)\.update\(\{ status: "replied" \}\)/.test(IN)) fail("#2c the inbound thread must be closed ONLY when the reply actually went out");
  else ok("#2c inbound thread closed only on a real reply");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
