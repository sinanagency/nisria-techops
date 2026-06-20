// Real-people-not-banned wall (2026-06-21, KT #335). "Jensen" and "Stephen" were
// in Sasa's forbiddenBrands (cross-bot-leak words). But they are now REAL Nisria
// people (Nur's "Jensen"/Upaya contract; donor "Stephen Koitaat", KES 156,000).
// The ban rewrote EVERY legitimate reply mentioning them into the "Tell me a bit
// more" reask — so Sasa created the tasks but told Nur it did nothing (live 2026-06-21
// 00:05–00:09). They were removed from forbiddenBrands; genuine cross-PRODUCT brands
// (4Q, La Rencontre, CTH, Young at Heart, Canada Made) stay.
//
// Seams:
//   S1  "Jensen" is NOT in Sasa's forbiddenBrands
//   S2  "Stephen" is NOT in Sasa's forbiddenBrands
//   S3  the genuine cross-product brand bans are STILL present (4Q etc. — don't over-remove)
//
// Pure local.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CFG = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "bot", "guards-config.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

// Isolate the forbiddenBrands array.
const start = CFG.indexOf("forbiddenBrands:");
const block = start >= 0 ? CFG.slice(start, CFG.indexOf("]", start) + 1) : "";

if (!block) fail("forbiddenBrands array not found");
else {
  // ---- S1 ----
  if (/["']Jensen["']/.test(block)) fail("S1 'Jensen' must NOT be in forbiddenBrands — it is a real Nisria person now");
  else ok("S1 'Jensen' removed from forbiddenBrands");

  // ---- S2 ----
  if (/["']Stephen["']/.test(block)) fail("S2 'Stephen' must NOT be in forbiddenBrands — donor Stephen Koitaat is real");
  else ok("S2 'Stephen' removed from forbiddenBrands");

  // ---- S3: don't over-remove — the real cross-product brands stay ----
  const stillBanned = ["4Q", "La Rencontre", "Cape Town Halaal", "Young at Heart", "Canada Made"];
  const missing = stillBanned.filter((b) => !block.includes(b));
  if (missing.length) fail(`S3 cross-product brand bans must stay; missing: ${missing.join(", ")}`);
  else ok("S3 genuine cross-product brand bans intact (4Q, La Rencontre, CTH, Young at Heart, Canada Made)");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
