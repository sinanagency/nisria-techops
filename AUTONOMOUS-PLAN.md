# Autonomous A-Z Plan: Harden Sasa + Heal the Platform

_You launch once. It self-drives. It hands you a PR and a report. You never babysit it._

**THE MAIN JOB (priority #1): fix what is broken inside the code.** Track B (the Platform Healer) is the primary deliverable, find where things don't connect, loop, or fail to communicate, and fix them. Track A (the Sasa Gym) is the supporting tool that hardens the bot and feeds the eventual self-host. Heal the code first.

Two tracks, one engine:
- **Track B, The Platform Healer (PRIMARY):** the closed-loop eval pointed at the codebase, to find and FIX what is broken, disconnected, looping, or not communicating.
- **Track A, The Sasa Gym (supporting):** adversarial self-play that hardens the bot. (Detail in SASA-GYM-PLAN.md.)

## KEY CUSTODY (locked, never violate)

Taona's standing instruction: "for training/healing no API keys, but once done it goes BACK to the API keys. I won't give them again, so save them."

- **Saved.** ANTHROPIC_API_KEY + OPENAI_API_KEY are backed up in macOS Keychain: `nisria-anthropic-key`, `nisria-openai-key`, plus a full `.env.local` snapshot `nisria-env-local-backup`. Source of truth remains `platform/.env.local` and Vercel env. He never has to provide them again.
- **During the gym/heal:** the keys are blanked ONLY inside the harness's own subprocess environment (a process-level override). The files `.env.local`, `.env`, and Vercel env are NEVER written or touched. Nothing is mutated, so nothing needs restoring. A paid call is impossible by construction, and the real keys sit untouched the whole time.
- **After the gym/heal:** Sasa's live runtime keeps using the real keys exactly as today (Claude generator + OpenAI verifier from .env.local/Vercel). The local-DGX swap was eval-only and never entered the production path. There is no "switch back" step because production was never switched away.
- If fine-tuning later produces a self-hosted Sasa good enough to replace Claude, swapping the runtime brain is a SEPARATE, explicit decision you make, not something the gym does on its own.

---

## HARD RULES (the autonomy guardrails, non-negotiable)

1. **Zero metered API. Neither ANTHROPIC_API_KEY nor OPENAI_API_KEY is touched by the gym or the heavy generation.** In eval mode BOTH Sasa's generator (Claude) AND her verifier (OpenAI gpt-4o-mini) are swapped to local DGX models. The harness sets `ANTHROPIC_API_KEY=""` and `OPENAI_API_KEY=""` for its own process so a paid call is impossible by construction, not by discipline.
2. **Never auto-deploy to production.** The pipeline analyzes, fixes on an isolated git worktree branch, verifies, and opens a PR. Merging and deploying stay your call (your single-driver + deploy-on-go rule). It can build and prove, it cannot ship.
3. **Auto-apply only HIGH-confidence + LOW-risk fixes** (dead imports, missing null guards, an obvious contract mismatch, a missing env doc, a typo'd table name). Anything MEDIUM or HIGH risk goes to the report as a draft, not applied.
4. **Every auto-fix passes the gate before it lives:** `tsc --noEmit` clean, `next build` green, `node eval/run.mjs` all-pass. A fix that breaks the gate is reverted automatically and demoted to a report finding.
5. **Respect the DGX no-apt rule.** Provisioning a model = HuggingFace download + vLLM serve inside the existing env (allowed). If a system/driver install is ever required, the pipeline STOPS and flags the GPU owner instead of touching the system.
6. **Work in a worktree.** All code changes happen in an isolated worktree so a long autonomous run never collides with live work on main.

---

## STEP 0 (one-time): pick the best model BY MEASUREMENT, then serve it

The model is NOT hardcoded. "Best" is decided at launch by a bake-off on OUR task, because the best open model changes monthly and a static pick goes stale. The selection runs in four moves:

1. **Pull current truth (live, not from memory).** Query today's leaderboards, primarily the **Berkeley Function-Calling Leaderboard (BFCL)** since Sasa's job is tool-calling, plus LMArena and the HF Open LLM Leaderboard. Shortlist 2 to 4 models that rank top on tool-calling AND fit the hardware (one A100 80GB, or 4xA100 tensor-parallel for a larger one).
2. **Bake-off on a held-out set of OUR scenarios.** Serve each candidate, run it through Sasa's REAL prompt + tools, measure tool-choice accuracy, loop rate, hallucination rate, latency. A leaderboard says what is good in general; the bake-off says what is best at being Sasa.
3. **Pick the empirical winner on our data.** The judge model is chosen from a DIFFERENT family than the winner (independent failure modes).
4. **Serve it** with vLLM as an OpenAI-compatible endpoint (`/v1/chat/completions`, tool-calling on), reachable over the existing SSH/Cloudflare tunnel; health-check with a tool-calling smoke test; write the endpoint to `gym/.endpoint`.

`gym/setup-dgx.sh` picks a free A100 node (`nvidia-smi`, avoiding Node03 GPU0 Emir-TTS and GPU1 Qwen-coder), downloads candidates from HuggingFace, runs the bake-off, serves the winner. No apt, no driver. If the serving env is missing, it STOPS and flags the GPU owner (rule 5). **Re-bake-off periodically:** when a stronger model drops, it is measured in and swapped if it wins. Best-of-best is maintained, not frozen.

---

## TRACK A — THE SASA GYM (hardening)

Engine: adversarial self-play, three local models (Adversary, Sasa-under-test with REAL prompt+tools, Judge), all on the Step-0 endpoint. Full detail and the report mockup are in SASA-GYM-PLAN.md. Autonomous sequence:

- **A1. Brain-swap harness** (`gym/local-runner.mjs`): imports the real `buildSystem` + `SMART_TOOLS`, routes to the local endpoint, runs Sasa with zero paid calls. Verifier swapped to the local Judge.
- **A2. PRD load:** the A-Z capability contract (SASA-GYM-PLAN.md section 2) becomes machine-readable `gym/prd.json` (capability, expected behavior, current status).
- **A3. Scenario generation:** the Adversary generates thousands of scenarios across the taxonomy, then escalates against whatever already broke her. Stored to `gym/scenarios/`.
- **A4. The run:** every scenario through A1, Judge scores the six failure classes. Results to `gym/runs/<date>.jsonl`.
- **A5. Improvement generation:** each gap + failure yields ranked candidate fixes (new tool spec, prompt edit, guardrail), drafted to `gym/improvements/`.
- **A6. Report:** the dated dashboard (Robustness Score + Coverage, drill-downs, ranked queue) served at sasa-gym.zanii.agency.
- **A7. Auto-apply (gated):** HIGH-confidence prompt/guardrail fixes applied on the worktree branch, gate-checked (rule 4), PR opened. Everything else stays in the report.

---

## TRACK B — THE PLATFORM HEALER (find + fix what's broken)

Same closed-loop idea, target = the whole codebase. Finds where things don't connect, loop, or fail to communicate, and proposes/fixes.

### What it checks (six dimensions, fanned out per module)

1. **Connection integrity.** Every frontend `fetch`/action maps to a real, reachable API route. Every route's DB table and column exists in the schema. Every referenced env var is set (local `.env.local` AND Vercel, cross-checked). Every import resolves. Flags orphaned routes, dead components, and calls into nothing.
2. **Loops & runaways.** `useEffect` dependency loops, unbounded retries/backoff storms, recursion without a base case, cron re-entrancy, and Sasa-style hedge/confirmation loops anywhere else in the agent code.
3. **Communication & contracts.** Frontend expects field X, backend returns Y. Webhook handlers that do not ack (Meta will retry-storm them). Serverless functions that exceed their timeout. RLS policies that silently block a legitimate read (the "empty results" class). Integration tokens missing or expired.
4. **Doctrine compliance (the 11 laws).** Invokes the existing sub-agents: doctrine-reviewer, money-truth-auditor (currency never mixes, no fabricated figures), local-first-enforcer, drill-to-core-checker. Plus one-brain (every Sasa path loads the Brain), idempotency on every gateway action, PII never reaches anon.
5. **Build & type health.** Runs `tsc --noEmit` (the build hides errors via `ignoreBuildErrors`, so this is where they surface), lint, dead-dependency scan, and unused-export detection.
6. **Security.** Service-role key never client-side, no secret committed, Drive/WhatsApp/bank creds in env not code, the verifier-fail-open class from node #30 anywhere it recurs.

### Method (the fan-out that beats the context limit)
1. **Map:** N agents in parallel, each owns one module (lib, app/api by feature, components, db, agents, group-bot, services). Each returns a structured inventory + its findings for the six dimensions.
2. **Adversarial verify:** each candidate finding is handed to a second, skeptical agent prompted to REFUTE it ("prove this is NOT a real bug"). Only findings that survive are kept. This kills the false-positive flood that makes audits useless.
3. **Dedup + rank:** merge by file+line, rank by severity × blast-radius.
4. **Auto-fix (gated, rule 3+4):** HIGH-confidence LOW-risk fixes applied on the worktree branch, gate-checked, batched into a PR. The rest become report findings with a draft fix attached.
5. **Report:** "Platform Health Score" leads, then critical issues (broken connections, live loops, contract breaks), then the ranked fix queue. Same one-headline format as the gym.

### Cost model for Track B
The deep code comprehension runs on the **Claude Code session (your subscription, not a metered per-token key)** for quality, one-shot per audit, not a high-volume loop. Heavy generation (drafting many fix variants) offloads to the DGX local model. No metered key is touched. If you want it fully local too, the same brain-swap applies, at some loss of comprehension quality. Default: subscription fan-out + DGX generation.

---

## THE A-Z RUNBOOK (what fires when you say go, with zero interference)

```
0.  Provision Qwen2.5-72B on a free A100 (Step 0). Health-check. Write endpoint.
1.  Create an isolated worktree branch: gym/auto-run-<date>.
2.  TRACK B map: fan agents across the whole codebase. Produce the complete
    capability + health map (this is also Track A's gap input). [beats context limit]
3.  TRACK B verify+rank: refute-test every finding, dedup, rank.
4.  TRACK B auto-fix: apply HIGH-confidence LOW-risk fixes, gate-check
    (tsc + build + eval), revert any that break it.
5.  TRACK A: build prd.json from the gap list (what map showed missing).
6.  TRACK A: Adversary generates + escalates scenarios on the DGX endpoint.
7.  TRACK A: run all scenarios (brain-swapped, zero paid calls), Judge scores.
8.  TRACK A: generate ranked improvements; apply HIGH-confidence prompt/guardrail
    fixes on the branch, gate-check.
9.  Build BOTH reports (Platform Health + Sasa Robustness), serve the links.
10. Open ONE PR with every gate-passing fix from both tracks, body = the
    summary + links to both reports.
11. STOP. Notify you: "PR ready, 2 report links, here's the headline." 
    You glance, you merge, you deploy on your go. Nothing shipped without you.
```

Your total interaction: say go once, then review one PR and two links. That is the whole "without me interfering."

---

## How you see it (both tracks, one format)
Two dashboards, each leading with ONE number and a trend:
- **Sasa Robustness Score** + **Portal Coverage** (Track A).
- **Platform Health Score** + **open critical issues** (Track B).
Drill into any red row to the exact file:line or the failing transcript. The fix queue underneath is ranked and pre-drafted. Both refresh every run so you watch the lines climb.
```
SASA ROBUSTNESS  94.2% ▲      PLATFORM HEALTH  88% ▲
unforgivables → 0             critical issues: 3 open
```
