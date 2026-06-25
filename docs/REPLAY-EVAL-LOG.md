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
