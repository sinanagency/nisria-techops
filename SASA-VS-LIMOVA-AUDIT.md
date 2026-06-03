# Sasa vs Limova.ai — Capability Audit & Build Plan

_Date: 2026-06-02 · Scope: command.nisria.co (Sasa) measured against limova.ai_

## TL;DR

Sasa is a **grounded operations brain** (donations, tasks, beneficiaries, calendar, grants, WhatsApp) — deeper and safer on Nisria's actual data than Limova will ever be. Limova is a **fleet of autonomous "doer" agents** (phone, social, SEO/CMS, prospecting, accounting, legal, recruiting) with a SmartPilot orchestrator that chains multi-step actions from one WhatsApp message.

The gap is **not intelligence, it's reach + autonomy + self-correction**. Three things to build, in order:
1. **Fix the loop/hallucinate leak first** (it's a verifier + cadence bug, not a control-flow bug). Table stakes.
2. **Give her "doer" reach** the nonprofit actually needs: social posting, content/CMS publishing, recurring items, multi-step campaigns.
3. **Skip** the Limova features that don't fit a nonprofit (LinkedIn sales prospecting, outbound cold-calling, Stripe checkout). Don't copy the sales-agency playbook into a charity.

---

## What Sasa CAN do today (verified in code)

**One brain, one tool registry** (`lib/smart-tools.ts` `SMART_TOOLS`), native Anthropic function-calling, hybrid RRF retrieval (vector + full-text) + an independent OpenAI verifier.

- **Reads:** donations, donors, finance summary, grants, tasks, inbox, team/roster (+pay, gated), beneficiaries (admin only), documents, learned facts, campaigns, group activity, calendar, conflicts.
- **Writes:** create/complete/reopen/update/delete tasks; record/update/delete payments (log only); add/update team, beneficiaries, inventory, contacts; remember facts; create/move/delete calendar events (mirrored to Google); send WhatsApp DM; queue group message; file documents; enqueue grant-prep; draft thank-you / email (always human-gated).
- **Integrations:** Supabase (R/W), WhatsApp Cloud API (R/W), Google Calendar (R/W via service account), Google Drive (R), Gmail SMTP (W), Anthropic (brain), OpenAI (verifier/transcribe/failover), I&M bank statements (read-only reconciliation).

---

## The looping / hallucinating problem — root cause

The in-turn loop is **already bounded** (`sasa.ts:421`, max 6 tool rounds, no recursion). The real leaks:

| Symptom | Root cause | File |
|---|---|---|
| **Cross-turn "please confirm / not done yet" ping-pong** | Hedge-breaker is **cadence-based**, only fires on the *3rd* consecutive hedge. Two-turn ping-pong escapes it. | `sasa.ts:126-130, 400` |
| **Invented figures / names in prose** | The verifier is **fail-open**: no/absent/rate-limited `OPENAI_API_KEY` → reply passes unchecked. Only completion claims have a regex backstop; free-text numbers don't. | `verifier.ts:15,51-52,75,85` |
| **Drafts (email, thank-you, grant docs) hallucinate** | These generation paths **never pass through the verifier** — grounded only by prompt. Contained by approval gate, but content can still be wrong. | `smart-tools.ts:1169`, `steward.ts`, `grant.ts` |

**Fixes (cheap, high-leverage):**
- Make verifier-unavailable a **soft-degrade flag**, not a silent pass (log it, optionally append a "unverified" marker on free-text figures).
- Move hedge-break to **content + 2-turn** detection (if this turn AND last turn both hedge on the same pending action → force a terminal decision or escalate to a human, don't hedge a third time).
- Route draft generation through the same per-claim grounding check before it hits the approvals queue.

---

## CAPABILITY GAPS — Sasa vs Limova

| Limova capability | Agent | Sasa today | Worth building for Nisria? |
|---|---|---|---|
| **Social media posting** (LI/IG/TikTok/FB), visuals, editorial calendar | John | ❌ Zanii connector is a stub | ✅ **YES** — fundraising/awareness is core to a nonprofit |
| **SEO content + auto-publish to CMS** (WordPress/Wix/Shopify) | Lou | ❌ none | ✅ **YES** — drives donor reach; she already drafts well |
| **Recurring/repeating tasks & events** ("every Monday") | Charly | ❌ single-date only (`sasa.ts:281`) | ✅ **YES** — payroll, reporting, check-ins are all recurring |
| **Autonomous multi-step campaigns / drip sequences** | Charly+ SmartPilot | ❌ single draft / single send only | ✅ **YES (scoped)** — donor cultivation, grant follow-up sequences |
| **Agent orchestration** (one agent supervises/dispatches others) | Charly | ⚠️ partial — has steward/grant/comms/conductor specialists but no chat-driven dispatch | ◑ **MAYBE** — useful once the fleet grows |
| **Voice / inbound + outbound telephony**, call qualification, 24/7 reception | Tom | ❌ WhatsApp text/template only; reads voice notes but can't call | ◑ **MAYBE** — Emir Voice stack could feed this later |
| **Accounting: forecasts, budgets, cashflow, unpaid-invoice analysis** | Manue | ◑ has finance_summary + bank reconciliation, no forecasting | ✅ **YES (light)** — runway/forecast is high-value for a charity |
| **Legal drafting + compliance (RGPD/contracts)** | Julia | ❌ none | ◑ **LOW** — grants/MOUs occasional, not core |
| **LinkedIn prospecting / outbound sales** | Elio | ❌ none | ❌ **NO** — not a nonprofit motion |
| **Recruitment: JD writing, CV screening, interview scheduling** | Rony | ❌ none | ◑ **LOW** — small team, infrequent hires |
| **Payment rails / Stripe checkout** | — | ❌ logs payments only, no money movement | ❌ **NO** — keep money out of the agent |
| **3,200+ generic integrations** (Make/Zapier-style) | platform | ❌ hand-wired integrations only | ◑ a webhook/Zapier bridge would cheaply unlock many |

---

## Recommended build order (drive)

**Phase 0 — Trust (do first, ~1 day):** ship the 3 loop/hallucinate fixes above. No new power matters if she still hedges and invents numbers.

**Phase 1 — Reach (the nonprofit "doer" gap):**
1. `schedule_recurring` — recurring tasks/events (cron-expr column + tick expansion). Unlocks payroll/report/check-in automation.
2. `post_social` — draft→approve→publish to IG/FB/LinkedIn (start with one channel; reuse the approvals-queue pattern, never auto-post).
3. `publish_content` — long-form draft → WordPress/CMS (Nisria/Maisha/AHADI sites). She already drafts; just add the publish leg.

**Phase 2 — Autonomy (scoped SmartPilot):**
4. `run_sequence` — multi-step campaign: donor cultivation / grant follow-up as an ordered, human-gated drip. This is Limova's actual moat; build it on the existing `jobs` queue + approvals, not a new engine.
5. Chat-driven **agent dispatch** — let Sasa hand a task to steward/grant/comms specialists from a message (orchestration without a new fleet).

**Phase 3 — Optional / later:**
6. Light **forecasting** card (runway from payments + donations trend).
7. **Voice** — only if Emir Voice TTS/ASR stack is wired in; otherwise skip.
8. **Webhook/Zapier bridge** — cheapest way to match Limova's integration breadth without hand-wiring each one.

**Explicitly NOT building:** LinkedIn sales prospecting, outbound cold-calling, Stripe payment rails. Wrong motion for a charity and they add risk surface.
