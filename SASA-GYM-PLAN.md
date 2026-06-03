# Sasa: PRD + Hardening Pipeline ("The Gym")

_Goal: make Sasa the full A-Z agentic operator of the Nisria portal from WhatsApp, and make her foolproof with a measured failure rate. Compute is not a constraint; DGX availability is._

---

## DECISIONS (locked — auto-decided, top-1% solution)

**D1. Zero metered API. The entire gym runs on DGX-hosted open models. No Anthropic/OpenAI keys in the loop, ever.**
The non-obvious problem: evaluating Sasa means running her brain, which calls Claude (paid). Solution: a **brain-swap eval harness**. It imports the REAL production system prompt (`buildSystem`) and the REAL tool set (`SMART_TOOLS`) from `lib/agents/sasa.ts`, but routes them to a local vLLM endpoint on a free A100 node instead of Anthropic. We test the SYSTEM (prompt + tools + guardrails), not Claude. Anything robust on a local 70B is robust on Claude. No drift, because the prompt and tools are the real ones, only the brain behind them is free.

**D2. The gym is an adversarial self-play loop, three local models, all on DGX:**
- **Adversary** (Qwen2.5-72B-Instruct): plays "Nur trying to break the bot." Generates scenarios across the full taxonomy AND learns from what already broke her, escalating.
- **Sasa-under-test**: the real prompt + tools, local brain (D1).
- **Judge** (a second 72B instance, different prompt): scores each turn on the six failure classes. A different model family from the one under test, so it catches what the generator is blind to.
Loop: adversary attacks, judge scores, failures feed the improvement generator, propose patches, re-run. This is how we "assume all the things the bot might go through" without us imagining them by hand.

**D3. Eval/scenario/judge model: Qwen2.5-72B-Instruct via vLLM on a free A100 node.** Strong tool-calling, free, OpenAI-compatible API so the harness is a drop-in. (Coordinate with the GPU guy to serve it; this is a model-serve, not a system install, so it respects the no-apt rule.)

**D4. Build order: code-map + gap FIRST, then the gym.** You cannot write good adversarial scenarios for tools that do not exist yet, and the gap list is what turns "do more than we can imagine" into a concrete build queue.

**D5. The one-time code map is the ONLY thing that may run on the Claude Code session** (a one-shot fan-out, covered by the subscription, not a metered per-token key). Everything repeatable, the thousands of scenario runs and weekly loops, is 100% DGX. If you want even the code-map off Claude, say so and I route it to the local model too.

**D6. Optional Claude validation pass (default OFF):** before a real ship, we MAY run a small curated subset (a few hundred highest-value scenarios) against the actual Claude brain as a final confidence check. Bounded, known, small cost, your call each time. The core gym never needs it.

---

## 0. Governing constraints (decided)

1. **DGX is intermittent.** It is used for other work and is not always on. Therefore Sasa's **runtime** depends ONLY on always-available cloud (Claude generator, OpenAI verifier/embeddings). The DGX is for **batch** jobs: scenario generation, eval runs, analysis, and optional fine-tuning. It never sits in her live request path.
2. **This is not model-training to fix goals.** It is a closed-loop hardening pipeline (spec to eval to gap to improvement). Real gradient training is an optional LAST stage, distillation of verified-good behavior, not how we find or fix issues.
3. **Context-limit reality.** No single agent can read the whole codebase. The pipeline fans out: many agents each own a slice, results merge. This is the structural answer to "can't view the entire code."

---

## 1. The Vision: Sasa IS the portal

The north star: **anything a person can do in the web portal, Nur can do by telling Sasa in WhatsApp.** No screen required. Full agentic control, A-Z, including multi-step chains she composes herself. "Do more than we can imagine" = tool-complete coverage of the portal surface plus safe autonomy to chain those tools.

Two dimensions to maximize:
- **Coverage (can she do it?):** every portal operation has a Sasa tool. Gaps = the build list.
- **Reliability (does she do it right?):** never loops, never invents, never false-claims "done," never wrongly refuses. Measured, not asserted.

---

## 2. THE PRD: What Sasa Must Do (A-Z goal contract)

Organized by portal domain. Each capability is marked: ✅ has tool today · ◑ partial · ❌ missing (from the prior code audit). The ❌ and ◑ rows are the agentic build list.

### Donations & Donors
- Read totals, trends, lifetime value, newest/largest gift ✅
- Look up / search / dedupe donors ✅
- **Add/edit a donation by chat** ❌ (read-only today)
- **Segment donors** (lapsed, major, recurring) for a campaign ❌
- Draft + send (gated) a thank-you ✅

### Finance & Payments
- Money-in vs out summary ✅
- Log / correct / undo a payment ✅ (log only, staged)
- **Forecast / runway / cashflow projection** ❌
- **Flag overdue/unpaid obligations proactively** ◑
- Reconcile bank statements ◑ (read-only, hands naming to Nur)

### Grants
- List opportunities + applications ✅
- Enqueue grant-prep jobs ✅
- **Edit a grant record / update deadline by chat** ❌ (read-only)
- **Draft full grant package with grounded figures** ◑ (drafts, not verified)
- **Track submission status / follow-up sequence** ❌

### Tasks
- Create / complete / reopen / update / delete ✅
- Assign + ping assignee ✅
- **Recurring tasks ("every Monday")** ❌ (single-date only)
- **Bulk operations** ("close everything for the festival") ❌

### Calendar & Events
- Read unified calendar, conflicts, holidays ✅
- Create / move / delete events, sync to Google ✅
- **Recurring events** ❌
- **Schedule a meeting WITH a person** (find slot, invite) ◑

### Team / HR
- Roster, roles, contacts, pay (gated) ✅
- Add / update member ✅
- **Onboarding / offboarding flow** (multi-step) ❌
- **Payroll run reminder + reconciliation** ◑

### Beneficiaries / Cases
- Find, add, update (admin only, walled) ✅
- Intake pipeline (cases) ◑ (built, not deployed)
- **Case status workflow + follow-up scheduling** ◑
- **Auto-draft a case from a group report** ❌

### Documents / Library
- Search, file, auto-index ✅
- Read PDF/image/voice ✅ (no video)
- **Generate a branded document on request** ◑ (some paths, ungrounded)

### Campaigns
- List campaigns + progress ✅
- **Create / launch a campaign by chat** ❌
- **Multi-step donor-cultivation sequence (drip)** ❌

### Comms (Email + WhatsApp)
- Draft email (gated) ✅ · message a person ✅ · post to group ✅
- **Outbound multi-recipient blast (gated)** ◑
- **Social posting (IG/FB/LinkedIn)** ❌

### Inventory (Maisha)
- Add item ✅
- **Stock levels / low-stock alerts / usage** ❌

### Brain / Memory
- Remember durable facts, recall (hybrid RRF) ✅
- **Self-correct a wrong stored fact on contradiction** ◑
- **Entity graph (who relates to whom)** ❌

### Reporting
- Daily brief ◑
- **On-demand "give me the board report" (grounded, generated)** ❌
- **Proactive weekly digest to Nur** ◑

### Cross-cutting agentic powers (the "A-Z" multipliers)
- **Compose multi-tool chains** ("close the festival tasks, message the team it's done, and schedule the debrief") ❌ today she does one thing per turn well, chaining is shaky
- **Proactive initiative** (notice an overdue grant and raise it unprompted) ❌
- **Recurrence engine** (the single most-requested missing primitive) ❌
- **Bulk/batch operations** ❌
- **Undo/rollback any action she took** ◑

---

## 3. THE PIPELINE ("The Gym") — 6 stages

Runs as a multi-agent batch job on DGX when it's up. Produces artifacts, never touches runtime.

### Stage 1 — Exhaustive Code Map (fan-out)
Spawn N agents, each owning one module (lib, app/api, components, db, agents). Each returns a structured inventory: every tool, route, table, UI action, guardrail. Merge into ONE canonical "What Sasa Can Do Today" map. **This solves the single-context limit.**

### Stage 2 — Gap Analysis
Diff PRD (section 2) against the Stage 1 map. Output: ranked list of (a) missing capabilities, (b) partial ones, (c) reliability weaknesses. Each with the exact file that would change.

### Stage 3 — Scenario Engine (item 5, scaled)
A generator model produces the universe of inputs Nur could send, by systematic combination:
`entity × operation × phrasing-style × emotional-register × adversarial-trap × multi-step-chain`.
Includes the nasty ones: ambiguous refs, repeated asks (loop traps), screenshots with fake numbers (hallucination traps), "did you do it?" (false-done traps), contradictions, out-of-scope requests. Target: thousands of scenarios, each tagged with the correct expected behavior.

### Stage 4 — The Run (eval execution)
Execute every scenario against the bot in dry-run mode (the existing `evalSasa` makes one real model call, runs no DB writes, so it's safe to run at volume). Score each on: correct tool choice, no loop, no hallucination, no false-done, no wrong-refusal, correct PII wall. Output: **failure rate per category** = the foolproof number.

### Stage 5 — Improvement Generator
For each gap (Stage 2) and each failure (Stage 4), generate X candidate remedies: new tool spec, prompt edit, guardrail, or grounding fix. Rank by (impact × frequency ÷ effort). Output: a prioritized build queue with draft implementations.

### Stage 6 (real ML) — Distillation = the bridge to a self-hosted Sasa
Once Stages 3-4 produce clean, verified-good trajectories at volume, fine-tune the best open model (LoRA on a 70B) on those trajectories to bake in tool-choice reliability and compress the giant rule-prompt into weights. DGX batch job.

**This is NOT how we find issues, and it does NOT fix looping/hallucinating** (those are system + grounding problems; a fine-tuned looping model just loops more smoothly). Its purpose is different and specific:

- **If the brain stays Claude:** Stage 6 is optional.
- **If the goal is a fully self-hosted, zero-API, fully-private Sasa (the stated direction: DGX, no paid keys, privacy for children's data):** Stage 6 is the KEY ENABLER, not optional. A free open 72B usually needs this tool-calling boost to match Claude on a job this tool-heavy. Fine-tuning it on OUR own gym-generated data is how a free model reaches Claude-level reliability on OUR task, which is what lets us cut the cord from Claude.

**Why it is sequenced LAST (hard dependency, not preference):** fine-tuning needs data, and the gym (Stages 3-4) is the factory that produces it (verified-good trajectories + the full failure catalogue). And the bake-off (Step 0) tells us whether we even need it. So: gym first (hardens the system, makes the dataset, measures the gap to Claude), then fine-tune only if a gap remains, to close it and go fully self-hosted. Never before, because there is nothing good to train on yet.

---

## 3b. HOW YOU SEE IT (the report)

Every gym run produces a dated report, served as a link (sasa-gym.zanii.agency) plus a markdown digest. It leads with ONE headline, drill-down underneath (your one-headline rule):

```
┌─────────────────────────────────────────────────────────────┐
│                                                               │
│            SASA ROBUSTNESS SCORE                              │
│                                                               │
│                  94.2%                                        │
│              ▲ +6.1 since last run                            │
│         2,847 scenarios · 164 failures                        │
│                                                               │
│   Portal Coverage (A-Z):  71%  ███████░░░  42 of 59 caps     │
│                                                               │
├───────────────────────────────────────────────────────────┤
│  WHERE SHE BREAKS                          fails   trend     │
│  ● Multi-step chains                         71     ▼        │
│  ● Recurring requests                        48     ─        │
│  ● Ambiguous reference resolution            29     ▼        │
│  ● Hallucinated figure (UNFORGIVABLE)         9     ▼ →0     │
│  ● False-done claim (UNFORGIVABLE)            7     ▼ →0     │
│                                                               │
│  [drill into any row → real transcript of the failure]        │
├───────────────────────────────────────────────────────────┤
│  TOP IMPROVEMENTS (ranked by impact × frequency ÷ effort)     │
│  1. Add recurrence engine        → fixes 48 fails  · 2d       │
│  2. Multi-tool chaining in loop  → fixes 71 fails  · 3d       │
│  3. Tighten ref-resolution prompt→ fixes 29 fails  · 2h       │
│  [each expands to a draft implementation]                     │
└─────────────────────────────────────────────────────────────┘
```

Two numbers tell the whole story: **Robustness Score** (does she do it right?) and **Coverage** (can she do it at all?). Both trend over time so you watch her get stronger. Everything else is a drill-down. The two UNFORGIVABLES (hallucinated figure, false-done) get their own always-visible counters with a hard target of zero.

## 4. The loop & cadence
Each full pass: harden + extend. Run weekly (or on every meaningful code change). Each pass lowers the failure rate and burns down the A-Z gap list. The pipeline is the engine that makes her continuously more powerful, with proof.

## 5. Definition of "foolproof"
Not "feels good." A dashboard number: failure rate per category across the full scenario suite, trending to <1%, with zero tolerance on the two unforgivables (hallucinated figure, false-done claim).

---

## 6. Build order (proposed)
1. **PRD sign-off** (this doc) — align on the A-Z contract.
2. **Build Stage 1 + 2** (code map + gap analysis) as a multi-agent workflow — gives the real, complete picture of what she can/can't do, beyond one context.
3. **Build Stage 3 + 4** (scenario engine + run) — the foolproof measurement.
4. **Stage 5** improvement queue — start shipping capabilities A-Z.
5. **Stage 6** distillation — optional, later.
