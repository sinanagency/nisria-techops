// Group reaction idempotency wall (2026-06-22, KT #366 F3). A positive reaction (✅/👍)
// on a group message tells the bot "this is done" → runSasa → complete_task. WhatsApp
// re-delivers reaction events on reconnect/backfill, and the message-level dedup keys on
// the reaction event's OWN id while writing no row for a reaction — so it does NOT cover
// reactions. Without a dedicated guard, a re-fired reaction re-runs complete_task on an
// already-closed task ("the group bot doesnt have to hallucinate especially when it has
// already done"). Fix: dedup on (target message, emoji) via a durable
// group.reaction_processed event, written BEFORE the work (the marker is the gate).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ING = fs.readFileSync(path.resolve(HERE, "..", "..", "app", "api", "group", "ingest", "route.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

const i = ING.indexOf("if (reactionTargetId && reactionEmoji)");
const region = i >= 0 ? ING.slice(i, i + 1800) : "";

// ---- X1: the reaction branch exists ----
if (!region) fail("X1 the reaction handler must exist");
else ok("X1 reaction handler exists");

// ---- X2: it dedups on (target, emoji) BEFORE doing work ----
{
  if (!/group\.reaction_processed/.test(region)) fail("X2a must use a group.reaction_processed dedup marker");
  else ok("X2a uses a group.reaction_processed marker");
  if (!/payload->>target", reactionTargetId/.test(region) || !/payload->>emoji", reactionEmoji/.test(region))
    fail("X2b dedup must key on BOTH the target message and the emoji");
  else ok("X2b dedup keys on target + emoji");
  if (!/reaction: "deduped"/.test(region)) fail("X2c a re-fired reaction must short-circuit as deduped (no re-run)");
  else ok("X2c a re-delivered reaction short-circuits (deduped)");
}

// ---- X3: the marker is written BEFORE runSasa (gate, not side effect) ----
{
  const emitIdx = region.indexOf('type: "group.reaction_processed"');
  const runIdx = region.indexOf("await runSasa(");
  const dedupReturnIdx = region.indexOf('reaction: "deduped"');
  if (!(dedupReturnIdx > 0 && dedupReturnIdx < emitIdx)) fail("X3a the deduped early-return must precede writing the marker");
  else ok("X3a deduped check precedes the marker write");
  if (!(emitIdx > 0 && runIdx > emitIdx)) fail("X3b the processed-marker must be written BEFORE runSasa (so a race cannot double-fire)");
  else ok("X3b marker is written before runSasa (race-safe gate)");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
