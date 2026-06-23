// Parser cluster wall (2026-06-24, KT #392). Two real transcript bugs in the deterministic parsers:
//   1. Reminder TITLE kept the leading time — "Remind me at 2PM to contact Snoopy" titled the task
//      "at 2PM to contact Snoopy" (live L83 -> L135). Fix: cleanReminderTitle strips a leading
//      time-of-day + the following "to". Inverse-safety: a non-time "at <word>" is NOT stripped.
//   2. "Call with MT is done" missed "Call MT - BHF" (live L134-137): distinctiveWords drops the
//      2-char "MT" (>=3 floor). Fix: ALL-CAPS acronyms (MT/BHF/OB) join the distinctive set.
import { parseTasks } from "../../app/api/whatsapp/worker/parseTasks.mjs";
import { fuzzyMatchTasks } from "../../app/api/whatsapp/worker/parseTaskOps.mjs";
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);
const titleOf = (body) => (parseTasks({ body, today: "2026-06-24" }).tasks[0] || {}).title;

// ---- P1: leading time-of-day is stripped from a reminder title ----
{
  if (titleOf("Remind me at 2PM to contact Snoopy") !== "contact Snoopy")
    fail(`P1a 'at 2PM' must be stripped → 'contact Snoopy' (got '${titleOf("Remind me at 2PM to contact Snoopy")}')`);
  else ok("P1a 'Remind me at 2PM to contact Snoopy' → 'contact Snoopy'");
  if (titleOf("Remind me at 9 AM to print the EMX receipt") !== "print the EMX receipt")
    fail("P1b 'at 9 AM' stripped, EMX acronym preserved in the title");
  else ok("P1b 'at 9 AM to print the EMX receipt' → 'print the EMX receipt'");
  if (titleOf("Remind me at 14:00 to call the bank") !== "call the bank")
    fail("P1c 24h time 'at 14:00' is stripped");
  else ok("P1c 'at 14:00 to call the bank' → 'call the bank'");
}

// ---- P2 (INVERSE-SAFETY): a non-time 'at <word>' must NOT be stripped ----
{
  const t = titleOf("Remind me at the office to call John about the order");
  if (!/at the office/.test(String(t))) fail(`P2 a non-time 'at the office' must survive (got '${t}')`);
  else ok("P2 non-time 'at the office ...' is preserved (only a time after at/by is stripped)");
}

// ---- P3: ALL-CAPS acronym match (the 'Call with MT' miss) ----
{
  const open = [{ id: "1", title: "Call MT - BHF" }, { id: "2", title: "Sign the contract" }];
  const m = fuzzyMatchTasks("Call with MT", open).map((t) => t.title);
  if (!(m.length === 1 && m[0] === "Call MT - BHF")) fail(`P3a 'Call with MT' must match 'Call MT - BHF' (got ${JSON.stringify(m)})`);
  else ok("P3a 'Call with MT' → matches 'Call MT - BHF' (acronym distinctive)");
}

// ---- P4 (INVERSE-SAFETY): acronyms don't cause spurious matches ----
{
  // no shared acronym/word → no match
  const m = fuzzyMatchTasks("Call with MT", [{ id: "1", title: "Email the BHF report" }]).map((t) => t.title);
  if (m.length !== 0) fail(`P4a 'MT' must NOT match a title with only a DIFFERENT acronym 'BHF' (got ${JSON.stringify(m)})`);
  else ok("P4a a different acronym (MT vs BHF) → no spurious match");
  // a normal-word fragment is unaffected
  const m2 = fuzzyMatchTasks("contact Snoopy", [{ id: "1", title: "contact Snoopy" }]).map((t) => t.title);
  if (!(m2.length === 1)) fail("P4b a normal fragment still matches by substring");
  else ok("P4b normal fragment matching unaffected");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
