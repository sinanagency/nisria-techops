// Pending-intents / deferred-subscription wall (2026-06-21, KT #206542). The bot
// promised future-contingent actions ("the moment Malek texts in I'll message
// him") with no durable trigger, so nothing fired and it forgot. Phase 1 builds the
// general primitive: a pending_intents subscription table + a worker dispatcher +
// an enqueue at message_person's off-window failure + a honesty-wall detector that
// rewrites any unbacked future-contingent promise. trigger_type='window_open'.
//
// Seams:
//   P1  migration: pending_intents table, status/origin CHECKs, dedup+flush indexes, RLS
//   P2  lib/pending-intents.ts: registerIntent + dispatchWindowOpenFor + guardrails
//   P3  enqueue: message_person off-window registers the intent, returns subscribed
//   P4  dispatcher: worker flushes window_open before the confirm gate, isLive-gated
//   P5  detector: claimsDeferredWithoutSubscription wired in finalize (+ behavioral mirror)
//
// Pure local (source-seam + behavioural mirror).

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const R = (p) => fs.readFileSync(path.resolve(HERE, "..", "..", p), "utf8");
const SB = R("lib/sandbox.ts");
const M = R("db/migrations/20260621_pending_intents.sql");
const L = R("lib/pending-intents.ts");
const ST = R("lib/smart-tools.ts");
const W = R("app/api/whatsapp/worker/route.ts");
const SA = R("lib/agents/sasa.ts");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

// ---- P1: migration ----
{
  if (!/CREATE TABLE IF NOT EXISTS public\.pending_intents/.test(M)) fail("P1 pending_intents table must exist (idempotent)");
  else if (!/trigger_type\s+text NOT NULL/.test(M) || !/trigger_key\s+text NOT NULL/.test(M)) fail("P1 must be keyed on trigger_type + trigger_key (general primitive)");
  else if (!/action_type\s+text NOT NULL/.test(M) || !/payload\s+jsonb NOT NULL/.test(M)) fail("P1 must carry action_type + payload");
  else if (!/origin\s+text NOT NULL DEFAULT 'live'/.test(M) || !/pending_intents_origin_check/.test(M)) fail("P1 must carry origin (live/dev/maintenance/harness) for test isolation");
  else if (!/pending_intents_status_check/.test(M) || !/'firing'/.test(M)) fail("P1 status CHECK must include the 'firing' claim state");
  else if (!/expires_at\s+timestamptz NOT NULL/.test(M)) fail("P1 must carry expires_at (TTL, no stale fire)");
  else if (!/CREATE UNIQUE INDEX IF NOT EXISTS pending_intents_dedup_uniq[\s\S]{0,120}WHERE status = 'pending'/.test(M)) fail("P1 partial-unique dedup index on (dedup_key) WHERE pending");
  else if (!/CREATE INDEX IF NOT EXISTS pending_intents_flush_idx/.test(M)) fail("P1 flush index on (trigger_type, trigger_key, created_at)");
  else if (!/ENABLE ROW LEVEL SECURITY/.test(M)) fail("P1 RLS must be enabled (service-role only)");
  else ok("P1 migration: general pending_intents table, status/origin checks, dedup+flush indexes, RLS");
}

// ---- P2: the primitive lib ----
{
  if (!/export async function registerIntent\(/.test(L)) fail("P2 registerIntent must exist");
  else if (!/export async function dispatchWindowOpenFor\(/.test(L)) fail("P2 dispatchWindowOpenFor must exist");
  else if (!/export function intentDedupKey\(/.test(L)) fail("P2 intentDedupKey (pure) must exist");
  // atomic claim: pending -> firing, guarded by status
  else if (!/status:\s*"firing"[\s\S]{0,140}\.eq\("status",\s*"pending"\)/.test(L)) fail("P2 dispatch must atomically claim pending->firing guarded by status (no double-send)");
  // only live rows fire
  else if (!/\.eq\("origin",\s*"live"\)/.test(L)) fail("P2 dispatch must only fire origin='live' rows");
  // isLive gate
  else if (!/if \(!opts\.isLive\) return 0/.test(L)) fail("P2 dispatch must no-op when the inbound is not live (harness/maintenance)");
  // expiry filter
  else if (!/\.gt\("expires_at",\s*nowIso\)/.test(L)) fail("P2 dispatch must skip expired intents");
  // attempt cap / dead-letter
  else if (!/MAX_ATTEMPTS/.test(L) || !/status: exhausted \? "failed" : "pending"/.test(L)) fail("P2 a failed flush must retry then dead-letter, never loop forever");
  // best-effort / fail-open
  else if (!/catch \{\s*\n\s*return null;/.test(L)) fail("P2 registerIntent must be best-effort (null if table absent)");
  else if (!/catch \{\s*\n\s*return 0;/.test(L)) fail("P2 dispatch must be fail-open (0 if anything throws)");
  else ok("P2 primitive: register + dispatch, atomic claim, live-only, expiry, attempt-cap, fail-open");
}

// ---- P3: enqueue seam (message_person off-window) ----
{
  const i = ST.indexOf("KT #206542: do NOT drop the relay");
  const region = i >= 0 ? ST.slice(i - 200, i + 1200) : "";
  if (!region) fail("P3 the enqueue must exist at message_person's off-window failure");
  else if (!/registerIntent\(db,\s*\{/.test(region)) fail("P3 it must call registerIntent");
  else if (!/triggerType:\s*"window_open"/.test(region) || !/actionType:\s*"send_text"/.test(region)) fail("P3 it must register a window_open / send_text intent");
  else if (!/triggerKey:\s*number/.test(region)) fail("P3 the intent must be keyed on the recipient's number");
  else if (!/queued:\s*true,\s*subscribed:\s*true/.test(region)) fail("P3 a held send must return detail.subscribed (so the honesty wall passes it)");
  else if (!/I've held your message and will send it the moment they next message in/.test(region)) fail("P3 the reply must be the honest 'held it' line, not a silent drop");
  else if (!(ST.indexOf("if (sub) {") > i)) fail("P3 it must only claim 'held' when the subscription actually registered (best-effort fall-through)");
  else ok("P3 enqueue: off-window relay registers a window_open intent, returns subscribed, honest held-line");
}

// ---- P4: dispatcher seam (worker) ----
{
  const i = W.indexOf("PENDING-INTENTS FLUSH (window_open)");
  const region = i >= 0 ? W.slice(i, i + 900) : "";
  if (!region) fail("P4 the worker flush gate must exist");
  else if (!/dispatchWindowOpenFor\(db,\s*from,/.test(region)) fail("P4 it must flush for the inbound sender (from)");
  else if (!/!isHarnessMessageId\(waMsgId\)/.test(region) || !/MAINTENANCE_MODE !== "1"/.test(region)) fail("P4 isLive must gate OUT harness + maintenance (no test fires at a real user)");
  else if (!/!!\(text \|\| mediaId\)/.test(region)) fail("P4 must only fire on a real text/media inbound, never a bodyless event");
  else if (!/catch \{ \/\* a flush fault must never block the turn \*\//.test(region)) fail("P4 the gate must be fail-open");
  else if (!(i < W.indexOf("COMPLETE-TASK NOTE SLOT"))) fail("P4 the flush must run before the confirm/note gates");
  else ok("P4 dispatcher: flushes window_open for the sender, isLive-gated, fail-open, before the confirm gate");
}

// ---- P5: detector seam (sasa.ts finalize) ----
{
  if (!/function claimsDeferredWithoutSubscription\(/.test(SA)) fail("P5 the detector function must exist");
  else if (!/function subscribedThisTurn\(/.test(SA)) fail("P5 subscribedThisTurn gate must exist");
  else if (!/d\.subscribed === true \|\| d\.queued === true/.test(SA)) fail("P5 a real subscription (detail.subscribed/queued) must exempt the promise");
  else if (!/} else if \(claimsDeferredWithoutSubscription\(reply, toolRuns\)\)/.test(SA)) fail("P5 the detector must be wired into the finalize substitution chain");
  else if (!/reply = humanize\(HONEST_DEFERRED_NO_SUB/.test(SA)) fail("P5 an unbacked promise must be rewritten to the honest line");
  else if (!/sasa\.deferred_promise_unbacked/.test(SA)) fail("P5 an unbacked promise must emit an observable event (gap visibility)");
  else if (!/rewrites = \[[^\]]*HONEST_DEFERRED_NO_SUB/.test(SA)) fail("P5 the rewrite must be in the guard-mark array so the loop-breaker never re-flags it");
  else {
    // behavioral mirror of the two detector regexes
    const FWD = /\b(?:i['’]?\s?ll|i\s+will|i\s+can\s+have\s+it\s+ready)\b[^.?!\n]{0,70}\b(?:the\s+moment|as\s+soon\s+as|once|when|whenever)\b[^.?!\n]{0,45}\b(?:messages?|texts?|reach(?:es)?\s+out|gets?\s+back|repl(?:y|ies)|comes?\s+back|back\s+online|hears?\s+back|in\s+touch)\b/i;
    const REV = /\b(?:the\s+moment|as\s+soon\s+as|once|whenever)\b[^.?!\n]{0,45}\b(?:messages?|texts?|reach(?:es)?\s+out|gets?\s+back|repl(?:y|ies)|comes?\s+back|back\s+online|hears?\s+back)\b[^.?!\n]{0,45}\b(?:i['’]?\s?ll|i\s+will|i\s+can)\b/i;
    const hit = (s) => FWD.test(s) || REV.test(s);
    const must = [
      "His number is saved. The moment he texts in, I can message him about the SIMA task.",
      "I will message him the moment he texts this line.",
      "Sent your question to Taona, I will let you know once he replies.",
    ];
    const mustNot = [
      "I will remind you when the meeting starts at 3pm.",
      "Sent to Mark just now.",
      "Want me to message Wahome about the reimbursement?",
      "Logged it on Mark board, he will see it in his daily brief.",
      "Once the report is done I will share the numbers.",
    ];
    const badHit = must.find((s) => !hit(s));
    const badMiss = mustNot.find((s) => hit(s));
    if (badHit) fail(`P5 detector must catch a hollow future-contingent promise: ${JSON.stringify(badHit).slice(0, 60)}`);
    else if (badMiss) fail(`P5 detector must NOT catch a legit/clock-backed line: ${JSON.stringify(badMiss).slice(0, 60)}`);
    else ok("P5 detector: catches unbacked future-contingent promises, exempts subscribed + clock-backed + offers");
  }
}

// ---- P6: dedup-key idempotency mirror ----
{
  const key = (tt, tk, at, body, req) => {
    const h = createHash("sha256").update(`${at}:${String(body || "").slice(0, 2000)}`).digest("hex").slice(0, 16);
    return `${tt}:${tk}:${h}:${req || "sys"}`;
  };
  const a = key("window_open", "254718686515", "send_text", "propose the Cherry film", "254501168462");
  const b = key("window_open", "254718686515", "send_text", "propose the Cherry film", "254501168462");
  const c = key("window_open", "254718686515", "send_text", "different message", "254501168462");
  if (a !== b) fail("P6 identical intents must share a dedup key (idempotent enqueue)");
  else if (a === c) fail("P6 a different body must produce a different dedup key (a new send is allowed)");
  else if (!/intentDedupKey/.test(L) || !/dedup_key/.test(M)) fail("P6 dedup key must be wired in the lib + migration");
  else ok("P6 dedup: same relay = one live row, a different relay is its own row");
}

// ---- P7: held-vs-sent honesty in the confirm gate (skeptic blocker fix) ----
{
  const i = W.indexOf('p.kind === "send_message"');
  const region = i >= 0 ? W.slice(i, i + 3000) : "";
  if (!region) fail("P7 the send_message confirm arm must exist");
  else if (!/else if \(r\?\.ok === true && r\?\.detail\?\.queued\)/.test(region)) fail("P7 a HELD (queued) send must be its own branch, reported honestly");
  else if (!/!r\?\.detail\?\.queued/.test(region)) fail("P7 reallySent must exclude a queued/held result (never count a hold as Sent)");
  else if (!/r\?\.detail\?\.queued\)\s*\{[\s\S]{0,700}?notes\.push/.test(region)) fail("P7 the held branch must report via notes (honest), not sent[]");
  else ok("P7 confirm gate: an off-window held send is reported honestly, never as 'Sent to X'");
}

// ---- P8: test-isolation (harness origin) — guardrail 5, fully closed ----
{
  if (!/import \{ isSandbox \} from "\.\/sandbox"/.test(L)) fail("P8 registerIntent must import isSandbox");
  else if (!/isSandbox\(\) \? "harness"/.test(L)) fail("P8 an intent registered in a sandbox/harness run must be tagged origin='harness', never 'live'");
  else if (!/HARNESS_PREFIXES/.test(SB) || !/REPLAY_|XSWP_|GROUPHARNESS_/.test(SB)) fail("P8 isHarnessMessageId must recognize ALL harness prefixes (replay/sweep/group)");
  else if (!/isHarnessMessageId\(waMsgId\) \? await withSandbox\(_sendCall\)/.test(W)) fail("P8 the confirm-gate send must run inside withSandbox during a harness run (so its enqueue tags harness)");
  else ok("P8 test-isolation: harness enqueues tag origin='harness'; only origin='live' fires; a test can never reach a real user");
}

// ---- P9: detector exempts a real send this turn (false-positive fix) ----
{
  if (!/function deliveredThisTurn\(/.test(SA)) fail("P9 deliveredThisTurn must exist");
  else if (!/if \(deliveredThisTurn\(toolRuns\)\) return false/.test(SA)) fail("P9 the detector must exempt a turn where a real send was delivered (don't clobber a true 'Sent' confirmation)");
  else ok("P9 detector: a real delivery this turn exempts the reply (a true confirmation is never eaten)");
}

// ---- P10: firing-row reaper (no silent loss on crash) ----
{
  if (!/\.eq\("status", "firing"\)\.lt\("fired_at", staleCut\)/.test(L)) fail("P10 a crashed 'firing' row must be reclaimed to 'pending' after a stale cutoff (no silent loss)");
  else ok("P10 reaper: a row stuck 'firing' after a crash is retried, never silently dropped");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
