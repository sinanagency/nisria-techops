# ADR 0012 — Pending Intents: a durable subscription to a future external event

Status: accepted (Phase 1) · 2026-06-21 · KT #206542

## Problem

Sasa makes commitments contingent on a future action by a DIFFERENT party
("the moment Malek texts in I'll message him", "send me the photo and I'll
attach it", "I'll let you know when Taona replies") but persists no durable
trigger. The promise lives only in chat narration; once `historyFor`'s 12-message
window scrolls past, even the memory is gone. Result: dropped relays, orphaned
photos, amnesia on re-ask. The bot can defer on the CLOCK (crons, reminders) and
on the operator's OWN next "yes" (the 20-min confirm gate), but it has no way to
defer on "when person X does Y". This is one defect with many surfaces.

## Decision

Build ONE general primitive, not a point-fix per surface:

1. A durable table `pending_intents(trigger_type, trigger_key, action_type,
   payload, status, origin, expiry, ...)` — a subscription: "when an event of
   `trigger_type` matching `trigger_key` occurs, run `action_type(payload)`."
2. A single dispatcher in the inbound worker that, on each real inbound, fires the
   matching pending intents through typed, separately-guarded handlers.
3. A honesty-wall detector (`claimsDeferredWithoutSubscription`) that rewrites any
   reply promising a future-contingent action when NO subscription was registered
   this turn. This is the immune system that stops the next hollow promise, the
   generalization of the #357 "claimed to send without sending" wall.

A new scenario becomes a new `trigger_type` + a typed handler on the SAME table,
dispatcher, soak events and wall harness. Not a re-architecture.

## Why not a god-engine

Each trigger needs its own guards (window_open needs privacy re-authz; the
cross-surface photo join needs disambiguation; the owner reply-back needs the
privacy wall + a human gate). So: one table + one dispatcher + typed handlers,
each guarded. General enough that the next case is cheap, not so general it is
unsafe on a live children's-data bot.

## Phase 1 scope (this ADR)

`trigger_type='window_open'`, `action_type='send_text'`: the deferred relay
(Malek). Enqueue at `message_person`'s outside-24h-window failure
(`lib/smart-tools.ts` ~2130); flush in the worker before the confirm gate; the
detector in `finalize`. Phases 2 (cross-surface photo join) and 3 (owner
reply-back) add trigger types later.

## Guardrails (binding, from the red-team)

1. Atomic per-row claim (`pending`→`firing` guarded flip) — no double send.
2. Fire only on a real text/media inbound, never a reaction/status callback.
3. Short TTL (48h) + non-silent expiry; never queue confirm-prompts or
   time-relative statements (content whitelist: static relays only).
4. Suppress owner-mirror + recency-pick for flushes; log with a deferred marker.
5. Persist `origin` (live/dev/maintenance/harness); only `live` rows fire on a
   live inbound. A test message can never become a row that fires at real Nur.
6. Re-authz at flush + canonical key; never fire to a different identity/tier.
7. Attempt cap + dead-letter; verify the insert before telling the operator
   "I've held it".
8. Dark until the migration runs: every DB call is best-effort and falls through
   to today's behavior if the table is absent, so deploying changes nothing until
   Taona runs the migration.

## Reversibility

Additive only: new table, new lib, new guarded pre-brain gate, one new honesty
check. `send()`, the owner-mirror, the confirm gate, the coalescer and
`pending_actions` are untouched. Each phase is one revertable commit.
