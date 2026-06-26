# ADR 0015: Intent-parse-then-execute (Sasa deterministic rails)

Status: accepted
Date: 2026-06-26
Context spec: specs/005-deterministic-rails
Relates to: KT #406 (take the pen away), KT #206540 (deterministic route + grounded LLM), ADR 0011 (honesty law)

## Context

After the mesh routes a message to a specialist, the specialist's LLM call currently does everything in one free loop: choose which tool to call, call it, and write the reply. Two failure classes come from that freedom:

1. Wrong-words: the model narrates an outcome the tool did not produce ("Logged" for a staged payment). Slice 1 fixed this for confirm-gated actions by relaying the tool's own summary (KT #406).
2. Wrong-tool: the model picks the wrong action for a clear command (creates a task when asked to edit one, stages an unrequested calendar delete, asks a question already answered). Relaying the tool summary cannot fix this, because the wrong tool already ran.

To reach near-100 percent on clear commands and make the bot gradable, the tool choice itself must become deterministic for recognized intents, with the LLM constrained to understanding only.

## Decision

Insert one structured parse step between the router and the engine, per specialist:

`router -> specialist.parse (LLM, forced schema) -> executor (deterministic) -> templated confirmation`

- parse: ONE LLM call returns `{intent, slots, confidence}` against that domain's intent catalog, via a forced tool/JSON schema. It does not call action tools and does not write the reply.
- executor: a deterministic `intent -> tool` table (over the specialist's already-scoped tools) validates required slots, calls the one matching tool, and captures the result. Missing required slot -> one targeted question, no tool call.
- confirmation: rendered from the tool result (slice 1 mechanism), never free model prose.
- fallback: when `intent === conversation` or `confidence < threshold`, run the existing free-form engine turn for that message only (today's behavior, with the honesty guards active).

The forced-schema single parse call is chosen over the alternative of parsing inside the existing multi-tool agent loop.

## Alternatives considered

- Parse inside the existing agent loop (let the model call tools, then post-validate). Rejected: it keeps tool choice on the model, which is exactly the wrong-tool failure class. Post-validation is the guard game we are leaving (KT #406).
- Pure rules/regex intent detection, no LLM. Rejected: the transcript shows messy, multilingual, multi-intent phrasing the router's regex already struggles with; the LLM is needed for understanding. We constrain it to understanding, we do not remove it.
- Rebuild the bot from scratch (fourth architecture). Rejected: the mesh router, scoped tools, shared engine, and honesty guards all work and stay. This is one insertion, not a rebuild.

## Consequences

- Recognized clear commands become deterministic and gradable: one correct tool, one correct confirmation, asserted against the golden set in spec 005.
- The honesty guards become a backstop with a target hit-rate near zero; a guard firing signals a parse or executor gap to fix, not a shipped lie.
- New work per domain: an intent catalog, an intent->tool table, slot validators, and confirmation templates. Built and walled domain by domain, starting with work (largest failure cluster), then money (already half-done via slice 1), people, comms, knowledge, programs.
- The conversational fallback preserves today's behavior for the fuzzy tail, so ambiguous turns never force a wrong action.
- Risk: an intent the parser does not recognize must fall back to conversation, never to a wrong rail. The confidence threshold (start 0.6) is tuned against the golden set during EVAL.

## Verification

- Per domain: walls assert the intent->tool table and slot validators (source + behavioral on real transcript strings).
- End to end: one safe sandbox deploy (scripts/_deploy-sandbox.sh, sends dead, never prod) plus one replay run against spec 005's golden set, measured once after the build, not per slice (key-spend discipline).
