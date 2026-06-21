// lib/sandbox.ts — the ONE switch the harness flips to keep its writes out of
// Nur's live brain.
//
// Two activation paths, both safe:
//
// 1) PROCESS-WIDE via env var. Set SASA_SANDBOX_MODE=true in a process where
//    every brain write should be tagged sandbox. Used by out-of-band scripts
//    that never touch real operator traffic (replay-nur.mjs, the brain
//    backfill scripts when run against a staging DB, etc).
//
// 2) REQUEST-SCOPED via withSandbox(fn). Wrap a single handler invocation in
//    sandbox mode without affecting concurrent requests in the same Vercel
//    worker. The WhatsApp webhook worker uses this when the inbound message ID
//    carries the `wamid.TOURN_` prefix (tournament-harness.mjs always stamps
//    it on every test fan-out) so harness traffic hitting prod webhook is
//    automatically isolated even when SASA_SANDBOX_MODE is OFF process-wide.
//
// isSandbox() checks the request-scoped store first, then the env. Both fail
// OFF (writes still land in prod) by design — better caught by the next sweep
// than lost silently.

import { AsyncLocalStorage } from "node:async_hooks";

let _warned = false;

// Per-request store. Each Vercel function invocation that calls withSandbox
// gets its own context; nested calls inherit the outer state.
const _als = new AsyncLocalStorage<{ on: boolean }>();

export function isSandbox(): boolean {
  const ctx = _als.getStore();
  const envOn = String(process.env.SASA_SANDBOX_MODE || "").toLowerCase() === "true";
  const on = ctx?.on === true || envOn;
  if (on && !_warned) {
    _warned = true;
    // Loud on first hit so a misflip in prod env surfaces in Vercel logs.
    console.warn(
      "[sandbox] active. Brain writes are tagged sandbox=true; recall reads sandbox-only rows. Trigger:",
      ctx?.on ? "request-scoped (withSandbox)" : "process env SASA_SANDBOX_MODE"
    );
  }
  return on;
}

// Run `fn` with request-scoped sandbox mode on. The brain write helpers in
// lib/memory.ts and lib/librarian.ts call isSandbox() at write time, so any
// remember()/rememberUpsert()/findOrCreateEntity() invocation inside fn
// receives sandbox=true. Concurrent requests outside this scope are unaffected.
//
// Used by app/api/whatsapp/worker/route.ts when the inbound message ID starts
// with `wamid.TOURN_` — that prefix is harness-only (tournament-harness.mjs
// stamps every payload), so even a forgotten env var on the harness side can't
// pollute Nur's brain anymore.
export function withSandbox<T>(fn: () => T | Promise<T>): Promise<T> | T {
  return _als.run({ on: true }, fn as any) as Promise<T> | T;
}

// Detector: does this WhatsApp message ID belong to the tournament harness?
// Keeping the prefix recognition in one place so the harness can change the
// stamp without a worker-side edit hunt. wamid.TOURN_ is the current marker
// (eval/integration/tournament-harness.mjs:48).
// All harness prefixes in one place. tournament-harness=TOURN_, prod-harness=
// HARNESS_, replay-nur=REPLAY_, extended-sweep=XSWP_, group-bot-harness=
// GROUPHARNESS_. KT #206542: any of these must mark traffic as test so a held
// deferred send registered during a test run is tagged origin='harness' (never
// 'live') and can never fire at a real user.
const HARNESS_PREFIXES = ["wamid.TOURN_", "wamid.HARNESS_", "wamid.REPLAY_", "wamid.XSWP_", "wamid.GROUPHARNESS_"];
export function isHarnessMessageId(waMsgId: string | null | undefined): boolean {
  if (!waMsgId) return false;
  return HARNESS_PREFIXES.some((p) => waMsgId.startsWith(p));
}
