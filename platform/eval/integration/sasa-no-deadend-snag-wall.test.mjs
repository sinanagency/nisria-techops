// No dead-end "snag/retry" wall (2026-06-20, KT #317). Part of #6: when the
// last-resort honesty catch (claimsToolResultMismatch) fired, it dumped
// "I hit a snag with that. Let me retry." — a dead-end that PROMISES a retry it
// never does and gives the operator no next step. (06-20 00:21: Nur "newsletter
// overdue is also a done" -> "I hit a snag. Let me retry." and nothing happened.)
//
// Fix: surface the real failing-tool reason (toolAsk, the ok=false tool summary —
// e.g. "two newsletter tasks, which one?") if one ran, else an honest, ACTIONABLE
// line. Never a fake retry promise.
//
// Seams:
//   S1  the dead-end string "I hit a snag with that. Let me retry." is GONE.
//   S2  the claimsToolResultMismatch branch surfaces toolAsk's summary.
//   S3  the fallback is actionable (tell me the exact one) and promises no retry.
//
// Pure local.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SASA = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "agents", "sasa.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

// ---- S1: the dead-end fake-retry line is gone ----
if (/I hit a snag with that\. Let me retry\./.test(SASA)) fail("S1 dead-end 'I hit a snag... Let me retry.' still present");
else ok("S1 dead-end snag/retry line removed");

// ---- S2: the mismatch branch surfaces the real failing-tool reason ----
// Find the claimsToolResultMismatch block and confirm toolAsk's summary is used there.
{
  const idx = SASA.indexOf("claimsToolResultMismatch(rawText, toolRuns)");
  const tail = idx >= 0 ? SASA.slice(idx, idx + 1200) : "";
  if (idx < 0) fail("S2 claimsToolResultMismatch branch not found");
  else if (!/toolAsk\?\.result|toolAsk\b[\s\S]{0,80}summary/.test(tail)) fail("S2 mismatch branch must surface toolAsk's real reason");
  else ok("S2 mismatch branch surfaces the real failing-tool reason");
}

// ---- S3: fallback is actionable + promises no retry ----
{
  const idx = SASA.indexOf("claimsToolResultMismatch(rawText, toolRuns)");
  const tail = idx >= 0 ? SASA.slice(idx, idx + 1200) : "";
  if (/Let me retry/.test(tail)) fail("S3 fallback must not promise a retry it won't do");
  else if (!/(tell me|the exact|which one|the title)/i.test(tail)) fail("S3 fallback must give a concrete next step");
  else ok("S3 fallback is honest + actionable, no fake retry");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
