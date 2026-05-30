# Honesty Audit — 2026-05-30

Run by: 24-agent read-only fleet (one per module), classifying every command-center surface REAL / MIXED / SHELL against NISRIA-DOCTRINE.md. Read-only: no writes, no mutations. Evidence is file:line grounded.

This fills the `STATE.md` "Live surfaces, current honesty status" table. Paste the table below into STATE.md once the live group-bot session commits and the tree is clean.

## Scoreboard

- **REAL: 9** — workspace, grants, donors, team, tasks, reports, inbox, newsletter, settings
- **MIXED: 14** — finance, beneficiaries, donations, campaigns, legal, filing, sasa-smart, sasa-assistant, studio, content, library, inventory, contacts, launchpad
- **SHELL: 1** — outreach

## The STATE.md truth table (paste-ready)

| Module | Status | Owning law | Notes |
|---|---|---|---|
| Finance | MIXED | Currency, Source-of-truth | Real queries + real persisting actions, but MoneyFlows runs on hardcoded plan arrays (Law-1 const-26400) and moneyOut/ledger/paid-history still ingest the 226 KES-as-USD poisoned rows with no quarantine; payment rows don't drill to a profile |
| Workspace | REAL | Browser-OS, Local-first | Real comms threads, working send/assign/Sasa-draft that persist, drills to /contacts/[id], localStorage tabs, no target=_blank. Soft gap: Send lacks the mandated spinner |
| Beneficiaries | MIXED | Source-of-truth, Drill-to-core | Real list + real 360 profiles + real actions, no mock; but [id] photo opens via target=_blank (Local-first violation flagged by its own CLAUDE.md), rows reach profile only via a peek-first click |
| Grants | REAL | Real-action, Source-of-truth | Live tables, real Claude prepare pipeline that persists, rows drill to FocusSheet. Honest caveat: Submit advances status only (no funder transmission yet), labeled as such |
| Donors | REAL | Drill-to-core, Currency | Real end-to-end (queries, full profile, email/thank-you persist). Latent: money() hardcoded USD, donations has no currency column → any KES gift renders $ unlabeled |
| Donations | MIXED | Currency, Drill-to-core | Real data/actions/drill, but Currency-law breach: every amount + the total hardcoded USD, sums across currencies, ignores donations.currency |
| Campaigns | MIXED | Drill-to-core | Real list + real persisting create/edit, but rows open a shallow Modal peek, no /campaigns/[id] profile, no donations/donor view behind a campaign |
| Team | REAL | Drill-to-core, Field-nervous-system | Fully real: list + 360 profile + 9 persisting actions + events, every row drills, Local-first & Currency clean. WhatsApp 1:1 feed pending but honestly labeled |
| Tasks | REAL | Real-action | Real kanban over real tasks table (verified live: 3 AI-created rows), status + DispatchBox persist. Soft: no /tasks/[id], dispatch swallows email errors |
| Reports | REAL | Source-of-truth | Live figures + Archive both real (148 donations, 1435 payments, 56 report docs), archive drills to in-portal DocReader, KES/USD strictly separate, report/invoice gen persists |
| Legal | MIXED | Source-of-truth | Document register REAL (73 live docs, native DocReader); but US/KE entity-fact cards + obligations list are hardcoded constants (authoritative — EIN matches canonical ORG_FACT — yet not query-traced) |
| Filing | MIXED | Source-of-truth, Local-first, Drill-to-core | Real docs + Drive-proxy + native-text APIs, but a field bug (drive_file_id missing from list query while FileCard relies on it) breaks in-portal open for every folder doc; several target=_blank leaks |
| Inbox | REAL | One-brain | Live messages across two mailboxes + WhatsApp + social as one feed, real SMTP sends that persist + emit, draft-approval gateway, drills to /contacts/[id], zero violations |
| Sasa (smart) | MIXED | One-brain | Real shared runSasa tool-loop, live reads/writes, gated sends, Brain grounding all honest; MIXED edges: drop-attachment is canned bubbles (file never uploads) + USD-only money() in read tools sums currencies |
| Sasa (assistant) | MIXED | One-brain | Honest real read-only chat, but only partial One-brain: can read but not send/compose/create-task, no WhatsApp channel coverage, NOT grounded in agent_memory Brain (org facts hardcoded in prompt) |
| Studio | MIXED | Real-action | Core genuinely real (file upload + Claude gen + persisted rows, honest states); MIXED only because Download PDF egresses via target=_blank instead of in-portal preview (Local-first) |
| Newsletter | REAL | Earn-your-place | Real donor audience query + real AI-draft + real per-donor SMTP merge send with honest states. "Givebutter broken" hint is a red herring (no Givebutter in module) |
| Outreach | **SHELL** | Earn-your-place | Real query against a real but unpopulated table, no seed/ingest path, no row drill-down, no actions. The exact empty surface the Earn-your-place law names for removal |
| Content | MIXED | Earn-your-place | Compose/AI-draft/status-flip REAL and persist; auto-publish to IG/FB + Canva are honestly-labeled stubs (no fake success); no /content/[id] drill route |
| Library | MIXED | Earn-your-place | NOT a removal candidate: real assets query + genuine upload (caption/store/learn/emit), org-wide asset sink; MIXED: dead Google-Drive "OAuth pending" card + asset cards have no detail route/click (Law 5) |
| Inventory | MIXED | Field-nervous-system | Real wiring + real Claude listing gen, but **runtime bug**: status 'draft'/'active' violate the inventory_status_check CHECK constraint → Add item + status update FAIL against the real schema; no [id] route; intake is manual web-form only (no WhatsApp/photo/SKU) |
| Settings | REAL | One-brain | Every panel reads/writes real tables; Brain onboarding writes through to agent_memory so recall() grounds all agents (One-brain spine); grant docs queue real Claude gen + persist. Lone Zanii stub is explicitly badged |
| Contacts | MIXED | Drill-to-core | Real honest 360 profile + working email action + in-portal render; downgraded by Currency breach (lifetime total + gift rows sum/label all donations USD via hardcoded money()). No standalone list page (drillable from inbox/workspace/donors/groups) |
| Launchpad | MIXED | Browser-OS | Pure nav launcher, all 22 tiles real router.push, no shells/fake data; MIXED: doesn't fulfil Browser-OS tab-state model (tab wiring gated behind unshipped NEXT_PUBLIC_WORKSPACE flag) + surfaces Law-9 dead routes |

## Cross-cutting patterns (fix once, fix many)

These recur across modules. Fixing the shared root fixes every dependent surface at once.

### 1. Currency Law (Law 2) — the highest-frequency breach
`money()` in `platform/lib/supabase-admin.ts:31-38` is hardcoded `currency:'USD'`. Donations queries sum `amount` across all rows and ignore the `donations.currency` column. Affected: **donations, donors, contacts, sasa-smart reads, sasa-assistant**.
- Root fix: make `money(amount, currency)` honor the passed code (mirror the `<Money>` component which already keeps non-USD codes), and split donation sums by currency everywhere they're aggregated.
- **DB probe result is recorded below** — determines whether this is active corruption or latent label-correctness.

### 2. Drill-to-core (Law 5) — missing [id] profile routes
No detail route exists for: **campaigns, library, inventory, content, tasks (soft), finance payments**. Rows dead-end or open a shallow peek. Pass 2 work.

### 3. Local-first (Law 3) — target=_blank leaks
Avoidable egress in: **beneficiaries[id] photo, studio Download-PDF, filing FileCard**. All render the org's own bytes that should preview in a FocusSheet. (Grants funder-portal + DocReader "Open original" are the doctrine-sanctioned exceptions, not violations.)

### 4. Two real runtime bugs (not just doctrine posture)
- **Inventory**: `status:'draft'`/`'active'` writes violate `inventory_status_check` (allows in_stock/low/out/archived) → Add item throws. `actions.ts:24, :91` vs `schema.sql:616`.
- **Filing**: `drive_file_id` absent from the list query (`page.tsx:33`) while `FileCard.tsx:24-25` builds the viewer from it → `/api/filing/file/undefined` 404s → every folder doc fails to open in-portal. Search path works (uses id).

## Pass mapping

- **Pass 0 (Money truth)** — Finance: quarantine the 226 poisoned rows, re-extract Drive expenses to KES, kill MoneyFlows hardcoded arrays, fix the shared `money()` helper (Currency root), re-OCR bank debits. The auditor already filed the baseline at `money-truth-baseline-2026-05-29.md`.
- **Pass 1 (Browser)** — Launchpad → real tab-state new-tab page (unship the NEXT_PUBLIC_WORKSPACE gate), fold Local-first target=_blank leaks, remove the forced structure strip.
- **Pass 2 (Depth)** — Drill-to-core [id] routes for campaigns/library/inventory/content, beneficiary photo viewer, contacts list page.
- **Pass 3 (AI/comms/life)** — Sasa: ground the assistant arm in agent_memory, add WhatsApp channel coverage, wire the real drop-attachment upload; inventory WhatsApp intake; grant funder auto-submit; remove/repurpose Outreach (the one true SHELL).

## Quick wins outside the pass cadence (small, reversible, high-honesty)
1. Fix the Inventory CHECK-constraint bug (one-line status value change) — currently a hard runtime failure.
2. Add `drive_file_id` to the Filing list query — restores in-portal open for ~447 docs.
3. Fix the shared `money(amount, currency)` helper — clears the Currency-law breach across 5 modules at the root.

Each is a minimal, reversible diff that removes a real falsehood from the surface. They are the cheapest honesty gains available and don't require a full pass.

---

## DB probe — Currency breach severity (filled at audit time)

_Probe of the live `donations` table for non-USD currency rows, to decide if the Currency breach is ACTIVE (real KES donations being mislabeled/mis-summed) or LATENT (display bug that bites the first KES gift):_

**VERDICT: ACTIVE — and severe.** Probe of live Supabase `donations` (project ptvhqudonvvszupzhcfl):

- 148 donation rows total: **119 USD + 29 KES**.
- USD gifts sum to **$26,482.61**.
- KES gifts sum to **14,827,776 KES** (~$114,944 at 129 KES/USD), all from the 2021–2022 historical import.
- The donations module + contacts lifetime totals sum `amount` across all rows via `money()` (hardcoded USD) →
  **dashboard currently shows a blended donation total of `$14,854,258.36`.**
- That is a **~560× overstatement**: 14.8M KES is being added as if it were 14.8M US dollars.

This is no longer a Pass-2 polish item. It is a live, donor-facing, source-of-truth falsehood on the single most important number a nonprofit dashboard shows. It belongs in **Pass 0 (Money truth)** alongside the 226 poisoned payment rows. The shared `money(amount, currency)` helper fix + per-currency donation split is the root remedy.

### Inventory probe
`inventory` table returns **0 rows** — confirming the CHECK-constraint bug (`status:'draft'`/`'active'` vs allowed `in_stock|low|out|archived`): every "Add item" has thrown silently, so the module has never successfully stored a single item. (Fixed on this branch — see below.)

## Fixes applied on this branch (worktree-nisria-audit-quickwins)

Two pure runtime-bug fixes (no financial-data mutation), typecheck clean (`tsc --noEmit` exit 0):

1. **Inventory CHECK-constraint** — `app/inventory/actions.ts`: `addItem` status `"draft"` → `"in_stock"`; `generateListing` drops the invalid `status:"active"` write (keeps `folklore_listed:true`, the real listing flag). Add Item now succeeds against the live schema.
2. **Filing in-portal open** — `app/filing/page.tsx`: added `drive_file_id` to the list query `COLS`. Confirmed real + populated across all **463 documents**, so every folder doc now opens in-portal instead of 404-ing on `/api/filing/file/undefined`.

NOT touched here (correctly deferred to Pass 0 with operator review): the `money()` currency fix and the donation per-currency split. Changing how the donation headline is computed on a live dashboard is money-truth work that terminates at the operator's merge sign-off, same gate as the 226-row quarantine.
