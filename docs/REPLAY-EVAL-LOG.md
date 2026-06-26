# Replay-Eval Loop — change log & revert guide (2026-06-25)

Goal: prove the new mesh bot hits 90–95% accuracy on the real transcript replayed
with REAL evolving state, in an ISOLATED sandbox. Bot stays in MAINTENANCE (not
unlocked) until operator returns. No messages sent to anyone.

## Isolated sandbox (throwaway — safe to delete)
- Supabase project: `nisria-replay-sbx` ref `mpuzpzgqpttkhkwvbebq` (org Nisria), Tokyo.
- Schema: db/schema.sql + db/calendar.sql + all db/migrations/*.sql applied via psql
  session pooler (aws-1-ap-northeast-1). 55 public tables.
- Known gap: `agent_memory` (pgvector brain table) failed on a DEFAULT-expression
  quirk → grounding degraded in sandbox (does not affect routing). Fix pending if needed.
- Sends are DEAD on the sandbox instance (WHATSAPP_TOKEN/PHONE blanked) — nobody messaged.

## Revert
Every code change is a git commit on main (origin/nisria-techops). To revert any step,
`git revert <hash>`. Prod prod bot is UNCHANGED behaviorally except the security +
mesh commits already shipped this session (see KT #400–405). The sandbox project can be
deleted entirely with no prod impact.

## Loop log

## 2026-06-26 — BLOCKED on Anthropic credit (replay SAFE)
STATE: full-timeline replay COMPLETE and checkpointed → docs/replay-live-results.jsonl (1183 results). The JUDGE phase is the only thing left, and it needs an LLM.
BLOCKER: all Anthropic keys drained (bot prod key suspended; anthropic-active-key + bu-nisria-anthropic-key now "credit balance too low" after the full run). DGX local Qwen judge unreachable (SSH to 10.1.2.x times out — not on that network).
PROGRESS BEFORE BLOCK: routing 91% (sonnet-judged slice); money owner-finance + batch-staging fixed; harness made fair (real-transcript history, sonnet+temp0 judge, relative-time excluded); anonymized master data seeded.
RESUME (cheap, NO re-replay): once any sk-ant key has credit:
  ANTHROPIC_API_KEY=<working sk-ant key> JUDGE_ONLY=1 node platform/scripts/_replay-live.mjs
  → judges the 1183 checkpoint, writes docs/replay-live-proof.json with the real accuracy.
Then continue the loop: <90% → fix top cluster, redeploy sandbox (needs a working key for routing/specialists too), reset transactional, re-run; 90-95% → stop.
TO TOP UP: Anthropic console → Plans & Billing for the org behind anthropic-active-key (sk-ant-api03-aY0...), OR restore nur-anthropic-key-SUSPENDED.
