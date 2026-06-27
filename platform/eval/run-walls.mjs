#!/usr/bin/env node
// run-walls.mjs — single regression green-gate for Sasa's wall tests.
//
// Finds every eval/integration/*.test.mjs, runs each with `node <file>`,
// prints a per-wall PASS/FAIL line, then a summary. Exits non-zero if any wall
// fails so it can gate a deploy.
//
// Usage:
//   node eval/run-walls.mjs          (from platform/)
//   npm run walls
//
// A wall PASSES iff its process exits 0. Both wall formats in this repo
// ("WALL GREEN" / "N passed" style and "PASS:" line style) exit 0 only when
// every seam holds, so exit code is the single reliable signal.

import { readdirSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLATFORM = resolve(HERE, "..");
const INTEGRATION = resolve(HERE, "integration");
const UNIT = resolve(HERE, "unit");

// Run both the integration walls AND the unit suites (router, specialist-isolation,
// intent, multi-domain-replay) so the routing/isolation layer is gated too and the
// unit tests cannot silently rot again.
const files = [
  ...readdirSync(INTEGRATION).filter((f) => f.endsWith(".test.mjs")).map((f) => resolve(INTEGRATION, f)),
  ...readdirSync(UNIT).filter((f) => f.endsWith(".test.mjs")).map((f) => resolve(UNIT, f)),
].sort();

if (files.length === 0) {
  console.error("run-walls: no *.test.mjs found under eval/integration or eval/unit");
  process.exit(2);
}

console.log(`\nrun-walls: ${files.length} wall(s) under eval/integration + eval/unit\n`);

const passed = [];
const failed = [];

for (const f of files) {
  const full = f;
  const res = spawnSync("node", [full], {
    cwd: PLATFORM,
    encoding: "utf8",
  });
  const code = res.status;
  const name = basename(f);
  if (code === 0) {
    passed.push(name);
    console.log(`  PASS   ${name}`);
  } else {
    failed.push({ name, code, out: (res.stdout || "") + (res.stderr || "") });
    console.log(`  FAIL   ${name}  (exit ${code})`);
  }
}

console.log("\n" + "─".repeat(56));
console.log(`SUMMARY: ${passed.length} passed / ${failed.length} failed  (of ${files.length})`);

if (failed.length > 0) {
  console.log("\nFAILED WALLS:");
  for (const { name, code } of failed) {
    console.log(`  ✗ ${name} (exit ${code})`);
  }
  console.log("\nWALLS RED — deploy must be blocked.\n");
  process.exit(1);
}

console.log("\nALL WALLS GREEN ✓\n");
process.exit(0);
