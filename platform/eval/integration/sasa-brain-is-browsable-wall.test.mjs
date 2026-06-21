// Brain-is-browsable wall (2026-06-21, KT #343). Nur saved a link, asked "where
// did you save this, I can't see it", and the bot first pointed at a vague
// "Settings or Brain section" then DENIED the page exists ("the Brain is more of a
// backend memory I hold, not a page you can browse directly in the portal yet").
// That is false: /memory is a real, browsable read-only Brain viewer. The bot must
// (1) return a clickable affordance to /memory when it saves a fact, and (2) never
// deny the page exists.
//
// Seams:
//   S1  remember_fact success returns an affordance to /memory
//   S2  the prompt asserts the Brain is a real browsable page at /memory
//   S3  the prompt explicitly forbids denying the page ("not a page you can browse")
//
// Pure local.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SMART = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "smart-tools.ts"), "utf8");
const SASA = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "agents", "sasa.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

// ---- S1: remember_fact success carries the /memory affordance ----
{
  const i = SMART.indexOf('if (name === "remember_fact")');
  const region = i >= 0 ? SMART.slice(i, i + 9000) : "";
  // the success return line (ok:true, remembered:true) must carry the /memory affordance
  const successLine = region.split("\n").find((l) => /ok:\s*true/.test(l) && /remembered:\s*true/.test(l)) || "";
  if (!/affordance:\s*\{\s*kind:\s*"open"[^}]*href:\s*"\/memory"/.test(successLine)) fail("S1 remember_fact success must return an affordance to /memory");
  else ok("S1 remember_fact returns an Open-the-Brain /memory affordance");
}

// ---- S2: prompt asserts the Brain is browsable at /memory ----
if (!/BRAIN IS A REAL, BROWSABLE PAGE at https:\/\/command\.nisria\.co\/memory/.test(SASA)) fail("S2 the prompt must assert the Brain is browsable at the FULL https://command.nisria.co/memory URL (clickable on WhatsApp)");
else ok("S2 prompt asserts the Brain is browsable at the full clickable /memory URL");

// ---- S3: prompt forbids denying the page ----
{
  const anchor = SASA.indexOf("BRAIN IS A REAL, BROWSABLE PAGE");
  const region = anchor >= 0 ? SASA.slice(anchor, anchor + 900) : "";
  if (!/not a page you can browse/i.test(region) || !/NEVER tell her the Brain is/i.test(region)) fail("S3 the prompt must explicitly forbid denying the /memory page exists");
  else ok("S3 prompt forbids the 'not a page you can browse' denial");
}

// ---- S4: /memory must EXCLUDE owner-private notes (KT #344 privacy hole) ----
//          The portal is a single shared session (no per-user tier), and the #343
//          affordance now drives Nur to /memory, so the page must never render
//          owner_private facts or Nur could read Taona's "between us" notes.
{
  const PAGE = fs.readFileSync(path.resolve(HERE, "..", "..", "app", "memory", "page.tsx"), "utf8");
  const i = PAGE.indexOf('from("agent_memory")');
  const region = i >= 0 ? PAGE.slice(i, i + 400) : "";
  if (!/import\s*\{\s*OWNER_PRIVATE_KIND\s*\}/.test(PAGE)) fail("S4 /memory page must import OWNER_PRIVATE_KIND");
  else if (!/\.neq\(\s*"kind"\s*,\s*OWNER_PRIVATE_KIND\s*\)/.test(region)) fail("S4 /memory query must exclude owner_private (neq kind OWNER_PRIVATE_KIND)");
  else ok("S4 /memory excludes owner-private notes from the shared portal");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
