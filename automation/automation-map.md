# Automation Map — "Automate Nur's Time" (Pillar 5, Urgent)

The source plan flags **16 of 26 tasks as automatable**. This maps each to a concrete automation: trigger → steps → tools → the human approval gate. Built primarily on **n8n** (self-hostable on Railway, the onboarded host), **Claude** (drafting/reasoning), **Supabase** (data + triggers/webhooks), and the platform APIs.

> Principle: automate the **assembly and the busywork**, keep a **human gate** on anything that goes public, touches money, or touches a beneficiary. Nur decides what to automate; tech executes. Stack: n8n on Railway · Supabase · Givebutter · Google (Ads/GA4/Drive/Forms) · Meta · Claude.

## Priority tiers

**P0 — do first (highest leverage, lowest risk):**

| # | Automation | Trigger → Steps | Gate |
|---|---|---|---|
| A1 | **Givebutter → Supabase sync** | Givebutter webhook/poll → upsert `donors`, insert `donations` (dedupe on `external_id`) → update `campaigns.raised_amount` | none (data only) |
| A2 | **Donation receipt + first-gift welcome** | New `donations` row → branded receipt email; if donor's first gift → start 3-email welcome series | none (transactional) |
| A3 | **Weekly fundraising report to Nur** | Cron (Mon) → query Supabase (raised MTD/YTD, new/recurring donors, MRR, top campaign, lapsed) → Claude formats → email/WhatsApp Nur | none (internal) |
| A4 | **Beneficiary intake → record + folder** | Google Form submit → create `beneficiaries` row (consent_public=false) + Drive case folder by ref_code → link consent | human verifies before public |

**P1 — content engine (saves the most recurring hours):**

| # | Automation | Trigger → Steps | Gate |
|---|---|---|---|
| B1 | **Weekly blog drafts** | Cron (Mon) → topic from calendar + brand voice → Claude drafts Nisria + Maisha posts → save `_DRAFT` to Drive + notify reviewer | human edit + publish |
| B2 | **Social atomization** | Approved hero piece → Claude spins into 5–7 platform-native captions + hashtags + alt-text → drop into calendar/Drive | human review |
| B3 | **Newsletter assembly** | Cron (Thu) → pull week's best blog/social + a campaign ask → Claude assembles draft in Givebutter/Substack | human send |
| B4 | **Social scheduling hand-off** | Approved captions + Canva assets → push to Meta Business Suite scheduler (FB/IG); export sheet for other platforms | human approve queue |

**P1 — fundraising ops:**

| # | Automation | Trigger → Steps | Gate |
|---|---|---|---|
| C1 | **Weekly Ad Grants report** | Cron → Google Ads + GA4 API → CTR/conv/QS flags + suggested negatives → Claude digest to delegate | human actions changes |
| C2 | **Lapsed/lifecycle emails** | Daily check → donors crossing thresholds (lapsed 12mo, recurring milestone) → queue segmented email | human approves campaign sends |
| C3 | **Grant deadline reminders** | Daily → `grant_applications.deadline` near → remind owner; new grants from source → insert `researching` rows | human triages/drafts |
| C4 | **Outreach follow-up nudges** | Daily → `outreach.next_action_on` due / gone cold → list to delegate; Claude drafts personalized first lines | human sends |

**P2 — inventory & systems:**

| # | Automation | Trigger → Steps | Gate |
|---|---|---|---|
| D1 | **Inventory → Folklore listing prep** | `inventory` row in_stock + photos + price → Claude drafts listing copy → queue listing task → write back `folklore_url` | human publishes + price check |
| D2 | **Low-stock alerts** | `inventory.quantity` < threshold → notify | none |
| D3 | **Donor wall / campaign meter** | Public Supabase view → live widget (Vercel) embedded on Squarespace | none |

## What stays manual (the 6 Nur-only + judgment calls)

Cause-marketing direction · seasonal campaign leadership · gamification strategy · yearly calendar ownership · staff comms · final approval on anything public/financial/beneficiary-facing · grant narrative sign-off.

## Build order

1. **Stand up n8n on Railway** (the orchestrator) + connect Supabase, Givebutter, Google, Meta, Claude credentials.
2. Ship **A1–A4** (data spine + transactional + intake) — immediate, low-risk wins.
3. Ship **B1–B3** (content drafting) — biggest recurring time save.
4. Ship **C1–C4** (fundraising ops).
5. Ship **D1–D3** (inventory/widget).
6. Measure: track hours of Nur's manual load before/after each (the actual KPI for this pillar).

## Notes

- Prefer **webhooks** over polling where the platform supports it (Givebutter, Forms, Supabase triggers).
- Every Claude-drafting node writes to a **review queue**, never auto-publishes.
- Secrets in n8n credential store / Railway env, never in workflow JSON.
- ⚑ Confirm Givebutter webhook availability + Google API quotas during build.
