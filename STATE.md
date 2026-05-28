# State

Current state of the Nisria Command Center. This is a live snapshot, not a journal. The journal (the old OVERNIGHT-LOG with 19 RUN GO entries) is in /docs/archive/.

When state changes, this file changes. When a pass finishes, this file reflects the new floor.

---

## Where we are right now

Foundation landed. The handoff in HOW-WE-BUILD.md has run through Step 5: superseded docs archived to /docs/archive/, legacy SQL archived to /docs/archive/legacy-sql/, schema consolidated from the live database into /platform/db/schema.sql and /platform/db/policies.sql, the money-truth baseline produced at /docs/baselines/money-truth-baseline-2026-05-29.md, and the Pass 0 worktree created at ../nisria-pass-0 on branch pass-0-money-truth. The platform itself has not been touched by Pass 0 yet.

Baseline verdict: FAIL with 406 currency and source-of-truth violations. 226 payments carry created_by='drive monthly history' tagged USD when they are Kenyan KES expenses; 180 of those also hold impossible amounts (the USD payments-out total reads as 1.3e23). Banking is two reconciled Absa accounts (Nisria CBO and LHSH) holding both credits and debits, but only for Oct 2021 to Nov 2022.

Next action: the operator confirms the baseline, then says go on Pass 0.

## Passes

- Pass 0 (Money truth): NOT STARTED (baseline filed, worktree armed, awaiting operator go)
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
| Finance | MIXED | Currency, Source-of-truth | 226 payments mislabeled USD (should be KES), USD payments-out total poisoned to 1.3e23; KES sums look sane; see docs/baselines/money-truth-baseline-2026-05-29.md |
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
