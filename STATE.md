# State

Current state of the Nisria Command Center. This is a live snapshot, not a journal. The journal (the old OVERNIGHT-LOG with 19 RUN GO entries) is in /docs/archive/.

When state changes, this file changes. When a pass finishes, this file reflects the new floor.

---

## Where we are right now

**2026-05-30 — UNIFIED AND SHIPPED.** Five parallel tracks (login+Sasa tour, money-truth/Treasury, groups chat reader + voice, attachments pipeline, the audit bug-fixes) are merged into one `main` (`e30a3e5`) and deployed once to command.nisria.co. Prod was stale at `80260ed` (nothing from the prior 24h was live); it now serves everything. The donations currency bug is fixed: `money()` carries currency, `/donations` shows per-currency totals, no more blended `$14.85M`. Loading states (shared `<SubmitButton>`) added to all finance forms + the group composer. The Outreach shell is removed. Full audit on the operator's Desktop: NISRIA-AUDIT-2026-05-30.md. Open polish: local-first photo/PDF in-portal previews, Railway bot single-replica pin, FX-rate sourcing, money-headline reconciliation. Governance rule learned: one repo + one Vercel + one Railway = exactly one driver.

Foundation landed. The handoff in HOW-WE-BUILD.md has run through Step 5: superseded docs archived to /docs/archive/, legacy SQL archived to /docs/archive/legacy-sql/, schema consolidated from the live database into /platform/db/schema.sql and /platform/db/policies.sql, the money-truth baseline produced at /docs/baselines/money-truth-baseline-2026-05-29.md, and the Pass 0 worktree created at ../nisria-pass-0 on branch pass-0-money-truth. The platform itself has not been touched by Pass 0 yet.

Baseline verdict: FAIL with 406 currency and source-of-truth violations. 226 payments carry created_by='drive monthly history' tagged USD when they are Kenyan KES expenses; 180 of those also hold impossible amounts (the USD payments-out total reads as 1.3e23). Banking is two reconciled Absa accounts (Nisria CBO and LHSH) holding both credits and debits, but only for Oct 2021 to Nov 2022.

Pass 0 underway on branch pass-0-money-truth. Done so far: (1) the 226 currency-corrupted payments resolved (46 mislabeled rows corrected USD to KES, 180 unparseable rows quarantined reversibly, snapshot at docs/baselines/pass-0-quarantine-snapshot-2026-05-29.json); re-audit reads PASS, USD payments-out total dropped from 1.3e23 to the real 27,651.66. Proof: docs/baselines/money-truth-postfix-2026-05-29.md. (2) Finance pulse rebuilt to show all 38 sequential months (2023-03 to 2026-04) with an inline Ask-Sasa box. (3) Treasury A-to-Z summary built and leads the Finance page: money in and out per currency, blended USD-equivalent with FX visible (129 KES/USD), USD-held and last reconciled bank balance, and an honesty note that a live cash-on-hand needs complete income records and recent statements. It refuses to print a misleading KES net.

(4) FINAL FIX: the whole 'drive monthly history' backfill was found to be fabricated and inflated. Root cause: it misread PayBill/Account/Till numbers from the sheets' "Payment Details" column as amounts, and templated 34 months that have no source sheet (tell: months identical to the shilling, e.g. 2024-04 = 2024-05 = 1,265,836). Only 2026 Feb-May trace to real monthly sheets, and the audited 2024 statement confirms ~3.7M/yr, not the backfill's ~16M. Action: snapshotted all 1,624 backfill rows (docs/baselines/pass-0-backfill-snapshot-2026-05-29.json), purged them, and re-extracted the 4 real sheets correctly via scripts/reextract_expenses.mjs (read the Amount column, reconcile each month to its stated Total, tag funding source). 124 clean rows loaded: Feb 415,120 / Mar 513,471 / Apr 489,000 / May 597,000 KES, every month balances to the sheet. Removed a stale duplicate recurring import (32 rows) so the monthly run reads 597,000 once. Donations, Givebutter payouts, and bank_transactions untouched. Audit: PASS.

The authoritative anchors now: 2026 real months above; 2024 audited (income 3,709,880 / expenditure 3,704,250 / surplus 5,630 / year-end reserves 513,830 KES, banker Stanbic). Full Drive finance inventory is 117 files.

UPDATE (COMPLETE): the full monthly sheet set was found (53 sheets; 2023-2025 named "YYYYMM - nisria Expenses", 2026 "[NS] ... Monthly Expenses"). The parser was hardened for all three layouts: read the KES amount only from the labeled KES column (account numbers can no longer be parsed as money), detect the total row whether labeled or an unlabeled trailing all-empty row, and trust the itemized line items where a sheet's own stated total is stale (rows added after the total was last computed). The peripheral, inconsistently-recorded USD agency column is intentionally not loaded. Result: ALL 39 months load (2023-03 to 2026-05), 1,402 rows, 24,226,463 KES. Per year: 2023 (10 mo) 7,273,765; 2024 (12) 8,291,609; 2025 (12) 6,164,378; 2026 (5) 2,496,711. Recurring monthly run reads 597,000 once. 9 months (2023-10 to 2024-06) had stale stated totals and were loaded from line items (flagged). Audit: PASS. Duplicate months (2024-04 = 2024-05) exist in the source sheets themselves.

Pass 0 remaining (cosmetic/UI only, the data is now complete and honest): surface the 2024 audited annual figures as a Treasury anchor (the monthly sheets are all-programs scope; the audited CBO is narrower), Givebutter its own tab, donor currency in its own unit, then deploy + screenshot-verify.

## Passes

- Pass 0 (Money truth): IN PROGRESS (currency fixed, backfill purged + re-extracted from real sheets, pulse + treasury built; 2024 audited anchor, Givebutter tab, donor currency, deploy pending)
- Pass 1 (Browser shell): NOT STARTED
- Pass 2 (Depth, full profiles): NOT STARTED
- Pass 3 (AI, comms, life): NOT STARTED

## Live surfaces, current honesty status

To be filled in by Claude Code when it runs the money-truth-auditor and the drill-to-core-checker for the first time. Each module gets one of three statuses:

- REAL: data verified, drills work, actions execute, no shells
- MIXED: some real, some shell, audit details listed
- SHELL: rendered but not honest, must be hidden or rebuilt

| Module | Status | Owning law | Notes |
|---|---|---|---|
| Finance | MIXED | Currency, Source-of-truth | Currency corruption resolved (audit PASS, postfix proof); pulse shows all 38 months. Still pending: treasury summary, real-spend ledger, Givebutter tab, 180-row re-extraction |
| Workspace | TBD | Browser-OS, Local-first | Awaiting Pass 1 |
| Beneficiaries | TBD | Source-of-truth, Drill-to-core | 93 imported, photos partial |
| Grants | TBD | Real-action, Source-of-truth | Active band live, submission not real |
| Donors | TBD | Drill-to-core, Currency | Givebutter synced, KES separation unverified |
| Donations | TBD | Currency, Drill-to-core | Linked to donor profile |
| Campaigns | TBD | Drill-to-core | Has list, profile depth unknown |
| Team | TBD | Drill-to-core, Field-nervous-system | 22 members, WhatsApp feed pending |
| Tasks | TBD | Real-action | Empty state inline ask works |
| Reports | TBD | Source-of-truth | Archive tab live |
| Legal | TBD | Source-of-truth | Entity facts and obligations |
| Filing/Sources | TBD | Source-of-truth | 447 docs filed, hidden source links |
| Inbox | TBD | One-brain | Two accounts synced |
| Sasa | TBD | One-brain | Grounded in Brain, attachments partial |
| Studio | TBD | Real-action | Drafts work, branded output works |
| Newsletter | TBD | Earn-your-place | Givebutter campaigns broken |
| Outreach | TBD | Earn-your-place | Likely SHELL, candidate for removal |
| Content | TBD | Earn-your-place | Likely SHELL, candidate for removal |
| Library | TBD | Earn-your-place | Likely SHELL, candidate for removal |
| Inventory | TBD | Field-nervous-system | AI intake pending |
| Settings | TBD | One-brain | Brain onboarding and grant readiness live |

Claude Code populates this table as part of the handoff. The Honesty Audit is not a separate phase, it is the act of filling this table truthfully.

## Blocked on the operator

- WhatsApp permanent token plus app secret for the bot to send (Phone Number ID and WABA ID already set)
- Facebook business verification (keeps failing, blocks WhatsApp full rollout and FB auto-post)
- Givebutter API key for live payout sync (currently manual)
- Vercel Pro plus project migration to Nisria's own Vercel account (currently on Sinan's Hobby)
- Embedder provider key for semantic recall (current recall is full-text only)

## Data Nur owes

These cannot be fabricated. Fields exist and are gated. Need real input:
- Beneficiary photos for the ~78 records not yet attached
- Beneficiary ID documents
- Beneficiary detailed stories beyond the Kwetu outcome extract
- LHSH bank statement as CSV or text (the scan reconciliation has one synthetic balancing entry)

## What got built before the doctrine

Before the foundation pass: 463 documents filed and openable in-app (Filing), 93 beneficiaries imported, 38 months of finance backfill (1,624 line items), 5 finance insights computed, Brain seeded with 13 org_facts, Banking view live for the Nisria Absa account with 129 reconciled transactions, LHSH with 199 rows and one synthetic balancing entry, Launchpad, Spotlight searching document content, swipe between Command Center / Launchpad / Workspace, Mission Control, Workspace portal with chat plus assign plus open-as-tab, Reports Archive, Legal module.

This work is real and stays. But it has not been audited against the doctrine. The handoff's money-truth-auditor and drill-to-core-checker will reveal which parts are REAL and which are MIXED or SHELL.

## What is not yet built

Everything in Pass 1 (browser shell rework). Most of Pass 2 (full profiles for campaigns, donors, contacts, team). All of Pass 3 (omniscient Sasa with attachments, WhatsApp bot personality, real grant submission, populated Givebutter campaigns, uniform filter, loading-to-done feedback everywhere).

## How to update this file

When a pass finishes and proof is signed off: the operator or Claude Code edits this file. The pass status flips to DONE with a link to its proof template output. The affected modules' rows update. Blocked items resolve as they resolve. Data Nur owes shrinks as she provides it.

This file is the truth of where the platform stands. It is short on purpose.
