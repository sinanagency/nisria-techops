#!/usr/bin/env node
// Sasa agent-clock wiring (KT #283, 2026-06-15).
//
// Validates the @zanii/agent-clock ClockInjector vendored at
// lib/_vendor/agent-clock/ plus the sasa.ts prompt-assembly wiring. Pins the
// canonical "Current trusted datetime:" block shape so a future "cleanup"
// cannot regress it.
//
// Pure local. No DB hit, no Anthropic spend, no network. Mirror of the
// source contract so a future loosening of the guard fails here.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { ClockInjector } from "../../lib/_vendor/agent-clock/index.mjs";

const PLATFORM = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => readFileSync(resolve(PLATFORM, rel), "utf8");

const tests = [];
function check(name, fn) { tests.push({ name, fn }); }

// ─── seam: vendor sources present and well-shaped ──────────────────────────

check("seam: agent-clock/index.ts exports ClockInjector", () => {
  const src = read("lib/_vendor/agent-clock/index.ts");
  if (!/export \{[^}]*ClockInjector[^}]*\} from "\.\/injector\.js"/s.test(src)) {
    return "ClockInjector export missing from agent-clock/index.ts";
  }
  return null;
});

check("seam: injector.ts defines TRUSTED_BLOCK_HEADER", () => {
  const src = read("lib/_vendor/agent-clock/injector.ts");
  if (!src.includes('TRUSTED_BLOCK_HEADER = "Current trusted datetime:"')) {
    return "TRUSTED_BLOCK_HEADER constant missing or text drifted";
  }
  return null;
});

check("seam: injector.ts block() emits Timezone + UTC Offset lines", () => {
  const src = read("lib/_vendor/agent-clock/injector.ts");
  if (!/`Timezone: \$\{t\.timezone\}/.test(src)) return "Timezone line drifted";
  if (!/`UTC Offset: \$\{t\.utcOffset\}/.test(src)) return "UTC Offset line drifted";
  return null;
});

check("seam: lib/now.ts imports ClockInjector and exports clockBlock", () => {
  const src = read("lib/now.ts");
  // Allow either index.js (TS-resolved) or index.mjs (ESM-resolved) — the
  // vendored agent-clock exposes both; concurrent commits switched lib/now.ts
  // to the .mjs entry point. Intent preserved: ClockInjector reaches lib/now.ts.
  if (!/import \{ ClockInjector \} from "\.\/_vendor\/agent-clock\/index\.(?:js|mjs)"/.test(src)) {
    return "ClockInjector import missing from lib/now.ts";
  }
  if (!/export function clockBlock\(\)/.test(src)) return "clockBlock export missing";
  if (!/export function clockInjectorFor\(/.test(src)) return "clockInjectorFor export missing";
  if (!/export const sasaClockInjector/.test(src)) return "sasaClockInjector export missing";
  return null;
});

check("seam: lib/now.ts keeps the legacy formatters byte-stable", () => {
  const src = read("lib/now.ts");
  for (const name of ["nowDate", "today", "formatLong", "formatWeekdayLong", "formatClock", "nowISO", "now", "nowFor"]) {
    if (!new RegExp(`export (?:async )?function ${name}\\b`).test(src) && !new RegExp(`export const ${name}\\b`).test(src)) {
      return `legacy export ${name} missing`;
    }
  }
  return null;
});

check("seam: sasa.ts imports clockBlock from ../now", () => {
  const src = read("lib/agents/sasa.ts");
  if (!/import \{[^}]*\bnow\b[^}]*\bclockBlock\b[^}]*\} from "\.\.\/now"/.test(src)) {
    return "clockBlock import missing from lib/agents/sasa.ts";
  }
  return null;
});

check("seam: sasa.ts wires clockBlock() into the dynamic tail", () => {
  const src = read("lib/agents/sasa.ts");
  // Post 3986b67/d4f401b: agent-clock moved INTO the dynamic tail, inlined
  // through clockLine. The standalone clockHeader + system assembly is gone.
  // The contract we still pin: clockBlock() is interpolated into clockLine
  // (so the canonical "Current trusted datetime:" block reaches the model).
  if (!/const clockLine = `[^`]*\$\{clockBlock\(\)\}/.test(src)) {
    return "clockBlock() not interpolated into clockLine (dynamic tail)";
  }
  return null;
});

check("seam: sasa.ts keeps the 06-09 weekdayLong + clockLine belt-and-braces", () => {
  const src = read("lib/agents/sasa.ts");
  if (!/\$\{n\.weekdayLong\} \(Asia\/Dubai\)/.test(src)) {
    return "weekdayLong injection into buildSystem missing";
  }
  // Loosened to match the new shape where clockBlock() is inlined ahead of
  // the legacy "Current clock:" line:
  //   const clockLine = `\n\n${clockBlock()}\n\nCurrent clock: ${n.clock} (Asia/Dubai).`;
  if (!/const clockLine = `[^`]*Current clock: \$\{n\.clock\} \(Asia\/Dubai\)\.`/.test(src)) {
    return "dynamic-tail clockLine missing";
  }
  return null;
});

check("seam: no em-dashes leaked into lib/_vendor", () => {
  const files = [
    "lib/_vendor/agent-clock/index.ts",
    "lib/_vendor/agent-clock/injector.ts",
    "lib/_vendor/agent-clock/models.ts",
    "lib/_vendor/agent-clock/sources.ts",
    "lib/_vendor/agent-clock/index.mjs",
    "lib/_vendor/truststack-core/index.ts",
    "lib/_vendor/truststack-core/core.ts",
    "lib/_vendor/truststack-core/events.ts",
    "lib/_vendor/truststack-core/telemetry.ts",
  ];
  for (const f of files) {
    if (read(f).includes("—")) return `em-dash present in ${f}`;
  }
  return null;
});

// ─── behavioral: ClockInjector contract ────────────────────────────────────

check("B: block() contains the canonical header", () => {
  const c = new ClockInjector({ timezone: "Asia/Dubai" });
  const out = c.block();
  if (!out.includes("Current trusted datetime:")) return `header missing: ${out}`;
  return null;
});

check("B: block() contains a real weekday word", () => {
  const c = new ClockInjector({ timezone: "Asia/Dubai" });
  const out = c.block();
  if (!/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/.test(out)) {
    return `no weekday word in block: ${out}`;
  }
  return null;
});

check("B: block() contains a four-digit year", () => {
  const c = new ClockInjector({ timezone: "Asia/Dubai" });
  const out = c.block();
  if (!/\b20\d{2}\b/.test(out)) return `no year in block: ${out}`;
  return null;
});

check("B: block() contains Asia/Dubai zone label", () => {
  const c = new ClockInjector({ timezone: "Asia/Dubai" });
  const out = c.block();
  if (!out.includes("Asia/Dubai")) return `zone label missing: ${out}`;
  return null;
});

check("B: block() contains UTC Offset line in +HH:MM shape", () => {
  const c = new ClockInjector({ timezone: "Asia/Dubai" });
  const out = c.block();
  if (!/UTC Offset: [+-]\d{2}:\d{2}/.test(out)) return `UTC Offset shape wrong: ${out}`;
  return null;
});

check("B: block() never contains 'undefined' or 'NaN'", () => {
  const c = new ClockInjector({ timezone: "Asia/Dubai" });
  const out = c.block();
  if (/undefined|NaN/.test(out)) return `block leaked undefined/NaN: ${out}`;
  return null;
});

check("B: Asia/Dubai abbreviation renders as +04 (post-2018 GCC zone)", () => {
  const c = new ClockInjector({ timezone: "Asia/Dubai" });
  const out = c.block();
  // The time line ends with the zone abbreviation. Dubai is fixed +04.
  if (!/\b\d{2}:\d{2} \+04\b/.test(out)) return `expected +04 abbreviation, got: ${out}`;
  return null;
});

check("B: separate America/New_York injector renders a different block", () => {
  const a = new ClockInjector({ timezone: "Asia/Dubai" }).block();
  const b = new ClockInjector({ timezone: "America/New_York" }).block();
  if (a === b) return "same block for two different zones";
  if (!b.includes("America/New_York")) return `NY block missing zone label: ${b}`;
  return null;
});

// ─── runner ────────────────────────────────────────────────────────────────

(async () => {
  let pass = 0;
  let fail = 0;
  let sample = null;
  for (const t of tests) {
    let err = null;
    try {
      err = await t.fn();
    } catch (e) {
      err = e?.stack || String(e);
    }
    if (err) {
      fail += 1;
      console.error(`FAIL ${t.name}: ${err}`);
    } else {
      pass += 1;
      console.log(`PASS ${t.name}`);
    }
  }
  // Print one sample block so the operator can eyeball the canonical shape.
  try {
    sample = new ClockInjector({ timezone: "Asia/Dubai" }).block();
    console.log("\n--- sample clockBlock() output (Asia/Dubai) ---");
    console.log(sample);
    console.log("--- end sample ---");
  } catch (e) {
    console.error("sample render failed:", e);
  }
  console.log(`\n${pass} pass, ${fail} fail (of ${tests.length})`);
  process.exit(fail === 0 ? 0 : 1);
})();
