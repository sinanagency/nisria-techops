// Recall-timeout wall (2026-06-26). Pins the graceful-degradation budget added
// to memory.ts recall(): the SLOW query arms (vector RPC + tsv scan) are
// time-boxed, so a slow brain search falls back to [] instead of hanging a
// WhatsApp reply to the 300s function ceiling. The org grounding (brand_voice +
// org_fact) loads OUTSIDE the budget and must always survive (one-brain law).
// Ported in spirit from EmirVoice's rag.js 2s search cap.
//
// Behavioural half imports the REAL pure helper. Wiring half reads memory.ts as
// text to assert the helper is imported and wraps the query arms, and that org
// grounding is pushed BEFORE the timed block.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withTimeout } from "../../lib/with-timeout.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MEM = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "memory.ts"), "utf8");

const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);
const eq = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? ok(m) : fail(`${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`));
const truthy = (v, m) => (v ? ok(m) : fail(m));

const delay = (ms, val) => new Promise((r) => setTimeout(() => r(val), ms));

// ---- T1: fast promise wins — returns its real value, never the fallback ----
{
  const got = await withTimeout(delay(5, "REAL"), 100, "FALLBACK", "t1");
  eq(got, "REAL", "T1 fast promise resolves to its real value");
}

// ---- T2: slow promise loses — returns the fallback after the budget ----
{
  const got = await withTimeout(delay(500, "TOO-LATE"), 30, "FALLBACK", "t2");
  eq(got, "FALLBACK", "T2 slow promise falls back gracefully (no hang)");
}

// ---- T3: the fallback is honoured as an empty array (recall's real fallback) ----
{
  const got = await withTimeout(delay(500, ["late"]), 30, [], "t3");
  eq(got, [], "T3 timed-out query arms yield [] (org grounding still answers)");
}

// ---- T4: the FAST path must NOT emit a false timeout warn, and must not leak ----
{
  const orig = console.warn;
  const warns = [];
  console.warn = (...a) => warns.push(a.join(" "));
  await withTimeout(delay(5, "REAL"), 100, "FALLBACK", "t4");
  // give any stray timer time to (wrongly) fire before we judge
  await delay(150);
  console.warn = orig;
  const falsePos = warns.filter((w) => w.includes("recall_query_timeout"));
  eq(falsePos.length, 0, "T4 fast path emits no false recall_query_timeout (timer cleared)");
}

// ---- T5: the SLOW path DOES emit exactly one structured soak signal ----
{
  const orig = console.warn;
  const warns = [];
  console.warn = (...a) => warns.push(a.join(" "));
  await withTimeout(delay(500, "x"), 20, [], "recall:query");
  await delay(40);
  console.warn = orig;
  const hits = warns.filter((w) => w.includes("recall_query_timeout") && w.includes("recall:query"));
  eq(hits.length, 1, "T5 slow path emits one recall_query_timeout soak signal");
}

// ---- W1..W4: memory.ts is actually wired to use the helper ----
{
  truthy(/import\s+\{\s*withTimeout\s*\}\s+from\s+["']\.\/with-timeout\.mjs["']/.test(MEM),
    "W1 memory.ts imports withTimeout from the pure .mjs");
  truthy(/withTimeout\(\s*gatherQueryMatches\(\)\s*,\s*RECALL_QUERY_TIMEOUT_MS/.test(MEM),
    "W2 the query arms (gatherQueryMatches) are wrapped in withTimeout");

  // org grounding must be pushed BEFORE the timed query block, so it survives a timeout
  const groundingPush = MEM.indexOf("push(data);");                 // step 1 org-grounding push
  const timedBlock = MEM.indexOf("withTimeout(gatherQueryMatches()");
  truthy(groundingPush > -1 && timedBlock > -1 && groundingPush < timedBlock,
    "W3 org grounding is pushed BEFORE the time-boxed query block (one-brain law holds on timeout)");

  truthy(/const\s+RECALL_QUERY_TIMEOUT_MS\s*=\s*\d+/.test(MEM),
    "W4 a concrete query-timeout budget is defined");
}

if (process.exitCode) console.error("\nrecall-timeout-wall: FAILED");
else console.log("\nrecall-timeout-wall: all green");
