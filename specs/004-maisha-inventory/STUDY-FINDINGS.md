# Maisha Inventory — Fan-Out Study Findings & Merge Plan

> Synthesized from 5 read-only audits (sasa brain, schema, group ingest, finance, portal) over `~/Code/nisria-techops/platform`. All claims carry file:line in the source audits. Companion to `MASTER-PROMPT.md`.
> **Headline: schema.sql is STALE — migrate against the LIVE DB with DROP/ADD. Three silent-reject `_check` traps + several live bugs must be cleared for this to work at all.**

---

## A. What already EXISTS (reuse, do not rebuild)

**Brain & tools**
- One-brain Sasa: `SMART_TOOLS` array (`lib/smart-tools.ts:343`), dispatch `runSmartTool` → `runRead`/`runAction`. Copy template: `update_inventory_item` (`smart-tools.ts:2794-2812`).
- Inventory tools already live: `list_inventory` (read, `:362`), `add_inventory_item` (`:387`), `update_inventory_item` (`:461`) — all Maisha-branded. Emit `inventory.item_added` / `inventory.updated`.
- `record_payment` full pipeline: multi-format intake (`readMedia` vision, `transcribeAudio` OpenAI, `storeMedia`→`asset_id`), staging via `pending_actions` (confirm-before-write over WhatsApp), dedup (payee+amount+currency+day), KES/USD split, proof threading. (`smart-tools.ts:390/3009`, `whatsapp/worker/route.ts:208-306`.)
- `money(amount, currency)` formatter (`supabase-admin.ts:33`) + `<Money>` component — pure, never blends. `sumBy(rows, ccy)` per-currency pattern at `smart-tools.ts:531`.
- Brain: `org_profile` (keyed by `section`, upsert), `agent_memory` (`kind='org_fact'` always loaded by `recall()`). Rollups become answerable with zero new wiring — write `org_fact` rows.

**Group transport (the silent-capture spine — CONFIRMED works day one)**
- `GROUP_LISTEN_ONLY` (`group/ingest/route.ts:30`, default ON/safe) is consulted ONLY at the end (`:526-530`). Message store (`:273-284`), task/payment pre-parsers (`:304-450`), and `runSasa` (`:478`) all run BEFORE suppression. Capture is fully upstream of silence. FLAG_NUR escalations still fire under listen-only.
- Sender identity resolved pre-brain: `operatorOf` (`whatsapp.ts:297`) → admin (Nur/operators) / team (`team_members.bot_access`) / null. Reuse as-is for tiers.
- Group brain runs INLINE in the ingest request (no separate worker), `maxDuration=300`. Heavy vision/multi-write must stay under the ceiling.

**Portal**
- `/inventory` exists, persists to real `inventory` rows (`app/inventory/page.tsx`). `FocusSheet` drill-in + `useTabs().openSheet({siblings})` is the canonical overlay. Inventory already registered in `Launchpad.tsx:74` + `tabs-context.tsx:61`.
- Finance UI templates to copy: per-currency `<Money currency>` cards, proof tri-state badge (`finance/page.tsx:497-505`), reconciliation block (`:649-678`).

---

## B. Live BUGS & silent-reject TRAPS (clear these or it doesn't work)

1. **`inventory_status_check` trap (DO FIRST).** Live = `in_stock|low|out|archived|draft` (5 values, `migrations/20260616_production_fixes.sql:31`); schema.sql shows only 4 (stale). Lifecycle states (`production|reserved|sold|shipped|in_transit|delivered|returned|restock`) are NONE of these → any insert/transition silently throws. **Recommend a dedicated `lifecycle_state` column with its own check; leave `status` for stock-level.**
2. **`tasks_source_check` = `manual|ai` only** (`schema.sql:840`). Inventory-spawned tasks must use `source:'ai'` OR migrate to add `'inventory'`. (`tasks_status_check` now includes `expired`.)
3. **`update_inventory_item` is UNREGISTERED in the honesty guard** — missing from `COMPLETION_TOOLS`, `stubTool` switch, `TEAM_TOOL_NAMES` (`sasa.ts`). A true "marked out of stock" claim gets rewritten to a hedge today, and team members can't call it. This is the §11 bite already live — fix as the reference case. (`add_inventory_item` IS registered, `sasa.ts:144`.)
4. **Group ingest stores NO `reply_to_external_id`** — only injects `quoted_text` as a string (`ingest/route.ts:471`). The 1:1 path persists the anchor (`webhook/route.ts:135`). Blocks deterministic swipe-reply binding (mode 1). Fix: userbot must ship the quoted msg's `external_id`; persist it on the message insert (`:273-284`).
5. **Group ingest does NOT use `storeMedia`/`asset_id`** — raw `storage.upload` + `media_path` only (`ingest/route.ts:210-246`). The 1:1 path uses `storeMedia`→`messages.asset_id` (`worker/route.ts:218`). Inventory images need the 1:1 primitive on the group path, else `asset_id` FK has nothing to point at.
6. **System-message filter is read-side only** (`groups/messages/route.ts:16`) — NOT on ingest. Import the `SYSTEM` regex as an intent gate before any inventory write so "security code changed" is never an intake.
7. **`payments` has no `source`/batch column** (`schema.sql:751-772`). Need `source:'maisha_inventory'` + idempotency batch key; `ref:AI-WA-${Date.now()}` is not idempotent.
8. **Revenue/sales is GREENFIELD** — no money-in tool exists except payouts. `record_sale` is new. Recommend a separate `inventory_sales`/`inventory_finance` table (reusing `donations` pollutes the fundraising hero).
9. **COGS/margin/fees GREENFIELD** — only `inventory.unit_cost`/`unit_price` columns exist, with NO currency column (multi-currency landmine). Expense category whitelist (`smart-tools.ts:3015`) lacks `cogs|courier|packaging|procurement`.
10. **AED is not modeled anywhere** — finance branches only USD/KES. Nur is UAE → adding AED means every per-currency split needs a 3rd bucket or AED rows silently drop from totals. FX rate is a hardcoded `129` constant (`Treasury.tsx:16`), no `org_profile.fx_rates`. `fx_convert` must stamp rate+date through a shared source.
11. **Finance grounding leak to team tier** — inventory finance facts written as `org_fact` are visible to any role unless their vocabulary is matched by `FINANCE_GROUNDING` (`sasa.ts:69`) / `MONEY_FIGURE` (`:75`). Add inventory-finance terms (margin, COGS, P&L, payout) or team members see figures in grounding.
12. **Portal `/inventory` is a flat `Shell` page using legacy `money()` (USD-assumed)** — must restructure to folder-routed, `FocusSheet` drill-ins, `<Money currency>`. No role gate on inventory/finance routes; the portal's `founder|builder` (`lib/auth.ts:13`) does NOT map onto the master-prompt admin/team/customer tiers — needs a deliberate bridge via `lib/profile.ts` `team_members.bot_access`. Two live UI bugs in passing: em-dash/hyphen listing-title mismatch (`page.tsx:22` vs `actions.ts:80`, listings never render inline) + USD-assumed money.
13. **schema.sql is STALE** vs live on: inventory status (`draft` missing), `messages.asset_id`, `tasks.task_type`/`due_time`. Always migrate against the live DB.

---

## C. Invented → real tool map (master prompt §11)

| §11 name | Status | Real / note |
|---|---|---|
| `vision_extract` | EXISTS as `readMedia` (Claude vision, pre-brain) — reuse, don't register |
| `query_inventory` | PARTIAL → `list_inventory`; add lifecycle/collection filter args |
| `record_payment` | EXISTS — reuse for cost outflows |
| `log_expense` | PARTIAL → `record_payment`/`log_payout`; add expense categories |
| `record_sale` / `record_shipment` / `transition_state` / `classify_item` / `dedupe_check` / `upsert_end_product` | NEW |
| `assign_make_task`/`assign_ship_task`/`raise_procurement_task` | NEW, compose on `create_task` (source:'ai') |
| `store_image` | EXISTS as `storeMedia` — wire onto group path |

Honesty-guard registration per NEW write tool (the checklist): `COMPLETION_TOOLS` + `stubTool` switch + `READ_TOOLS` (if read) + `TEAM_TOOL_NAMES` (if team-safe) + add an `INVENTORY_TOOLS` Set + `SHAPE_INVENTORY` regex + a `shapes:` entry (`sasa.ts:204`) for precise claim verification. Emit a stable `detail.<id>` for plural-claim counting.

---

## D. Build order (Phase 1, team-internal, no deploy)

0. **Migrations FIRST, against live DB (DROP/ADD pattern), in this order:**
   - `inventory`: add `lifecycle_state` (+ check), `item_type` (+ check supply|textile|end_product), `tracking_no UNIQUE`, `style`, `maker`/`maker_id`, `size`, `cost_currency`/`price_currency`, `asset_ids uuid[]`, `links jsonb`.
   - `messages`: formalize `asset_id` (`ADD COLUMN IF NOT EXISTS`, ends schema/manifest drift).
   - `tasks`: decide `source:'ai'` vs add `'inventory'` to `tasks_source_check`.
   - `payments`: add `source`, `batch_tag`.
   - New tables: `pending_enrichment`, `inventory_materials` (end_product→consumed textiles/supplies), `inventory_lifecycle_events` (audit), `inventory_sales` (revenue, keeps donations clean).
1. **Fix live bug:** register `update_inventory_item` in all guard sets (reference case for the pattern).
2. **Group ingest wiring:** swap raw upload → `storeMedia`+`asset_id`; persist `reply_to_external_id`; add `SYSTEM`-regex intent gate; add "persist pending un-enriched inventory row on image arrival" in the media-drop branch (`:210-246`).
3. **New smart-tools** (each fully guard-registered): `upsert_end_product`, `classify_item`, `transition_state`, `dedupe_check`, `consume_materials`, `record_sale`, `record_shipment`, `assign_make_task`/`assign_ship_task`/`raise_procurement_task`, `query_inventory`/`inventory_summary`, finance (`log_expense` via categories, `compute_cost`, `compute_margin`, `collection_pnl`).
4. **3 binding modes:** quoted-reply (via `external_id`), caption-on-image, loose follow-up (sender + most-recent-pending-image + time-window, confirm on ambiguity).
5. **Finance:** cost outflows → `payments` tagged `source:maisha_inventory` (+ batch idempotency); revenue → `inventory_sales`; **AED bucket added to every per-currency split**; FX stamped (rate+date); never `reduce(+amount)` across mixed currency.
6. **Brain rollups:** `org_fact` rows for catalogue/spend; extend `FINANCE_GROUNDING` so team tier strips inventory figures.
7. **Portal:** restructure `/inventory` to folder-routed section (Catalogue/Collections/Supplies/Textiles/Production/Deliveries/Finance/Tasks/Pending/Integrations), `FocusSheet` drill-ins, `<Money currency>`, explicit role gate bridging founder/builder→admin/team; fix the 2 live UI bugs.
8. **Tests + curl clean. No deploy** (KT `🟠 promise-only`).

Phase 2: external connectors (Shopify first) — scaffolded dormant, flipped on later.

---

## E. Two knowledge-tree rules this confirms (enforce at build)
- **Currency-mixing wall** (the $14.85M blend): never `reduce(+amount)` across >1 currency; per-currency buckets only; cross-currency only as stamped-FX estimate. Now extended to **AED as a first-class third bucket**.
- **Honesty-guard allowlist**: every state-change tool must be registered in all guard sets — `tsc` won't catch the omission; `update_inventory_item` is the live proof.
