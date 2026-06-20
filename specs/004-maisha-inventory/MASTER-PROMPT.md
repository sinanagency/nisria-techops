# MASTER PROMPT — Sasa "Maisha Inventory" Function (v-final)

> Status: DESIGN / not built / not deployed. Build standalone, prove it, then deploy.
> This document is the single source of truth for the fan-out study agents and the eventual `/spec`.

---

## 0. One-line mission
A new capability on the **existing Sasa brain** that lives in the **Maisha • Inventory** WhatsApp group, silently captures photo-first / reply-or-follow-up-enriched messages into **one canonical store**, tracks **supplies, textiles, and end products from production → delivery**, runs a **currency-correct finance sub-ledger**, **turns inventory state into tasks for the team**, and surfaces everything in the **portal** under an **Inventory** section. It must **work from day one** when switched on, capture under silent (listen-only) mode immediately, and be able to **chime in** once Sasa is stable — all of it readable and actionable by Sasa because it is the same brain and the same store.

---

## 1. Non-negotiable architecture (grounded in how Sasa already works)

- **One brain, not a new bot.** Inventory is a set of **new smart-tools on `lib/agents/sasa.ts`** (`runSasa({history, command, operatorName, operatorRole})`), which already powers both in-app Smart Mode (`/api/smart`) and the WhatsApp worker. Do NOT fork a parallel bot or store. Ref: `sasa-one-brain-route-whatsapp-into-smart-agent`.
- **Group transport = Baileys userbot** (dedicated number, Railway, **single pinned replica**), ingest at `/api/group/ingest`, sends only via `/api/group/outbox`. Cloud API cannot do groups. Refs: `baileys-pairing-code-link-gotchas`, `railway-stateful-userbot-must-pin-single-replica`.
- **Silent mode = `GROUP_LISTEN_ONLY` chokepoint flag** (fails safe, default ON). **Ingest still stores every message and still captures intakes while replies are off — the brain keeps learning silently.** Therefore: ALL capture runs on ingest NOW; chime-in is a later one-flag flip, never a rebuild. Ref: `silence-multi-instance-bot-at-platform-chokepoint`.
- **Capture writes where Sasa reads.** Inventory rows in the canonical store + rolled-up facts into brain grounding / `agent_memory` / `org_profile`, so "how many in the Noor collection / what did we spend / who made the green abaya" answer straight from Sasa. Ref: `sasa-agent-must-load-brain-via-recall`.
- **Honesty-guard allowlist (the #1 repeat bite).** Every new state-change tool MUST be registered in `COMPLETION_TOOLS` + the dry-run `stubTool` switch + `READ_TOOLS` (reads) + `TEAM_TOOL_NAMES` (team-safe), or Sasa's deterministic guard rewrites a TRUE "logged/recorded/shipped" into "I haven't done that yet." `tsc`/build will NOT catch this. Ref: `sasa-new-action-tool-must-join-completion-allowlist`.
- **Reuse the media pipeline.** Photos/PDF → `readMedia` (Claude vision); voice → OpenAI transcribe (never DGX); **`storeMedia` → `messages.asset_id`** is the existing "save the image as proof" primitive. Refs: `whatsapp-payment-multiformat-intake`, `whatsapp-receipts-recoverable-from-job-payloads`, `voice-notes-openai-transcribe-never-dgx`.
- **The `inventory` table already exists.** It once had a `inventory_status_check` that silently rejected EVERY insert (0 rows). Grep `schema.sql` for `_check` constraints FIRST; current vocab `in_stock|low|out|archived`, `folklore_listed` already present. Lifecycle states need a migration, not a fresh table. Refs: `inventory-status-check-constraint-rejected-every-insert`, `per-module-readonly-honesty-audit-fanout`.
- **Role tiers reuse the existing model.** `admin` (Nur / `WHATSAPP_OPERATORS`) = all tools incl. finance; `team` (active `team_members.bot_access` phone) = inventory/tasks subset, **finance figures stripped from tools AND from brain grounding**; non-operator/customer = gated secondary path. Refs: `nisria-727-team-access-flag-not-operator-allowlist`, `access-control-self-serve-and-structural-privilege-ceiling`.
- **Ops reuse:** `pg_cron` + `pg_net` for sub-daily sweeps (Vercel Hobby cron = daily only); **timezone explicit `Asia/Dubai`** (Nur is UAE); **system-message filter** on group ingest; **proof discipline** (sold ≠ paid ≠ shipped ≠ delivered, each proof-backed). Refs: `supabase-pg-cron-pgnet-serverless-trigger`, `cron-timezone-must-be-explicit-not-ambient`, `whatsapp-group-export-system-message-filter`, `payment-paid-requires-proof-not-assertion`.

---

## 2. People & roles

- **Team members (primary feeders):** drop photos + add context; feed supplies/procurement, textiles, end products. Get inventory/task tools, no finance figures.
- **Nur (admin + fulfillment):** **Nur ships** to customers (online / Folklore / Jensen's Shopify / other). Full tools incl. finance. Money/decisions route to Nur.
- **Taona (operator/owner):** oversight; full visibility.
- **External customers (secondary, gated):** check shipping status only, via scoped order token.
- **Developer role (`dev:true`):** reroute + skip persistence + `[DEV]` prefix per fleet doctrine.

---

## 3. Intake — three binding modes (capture EVERYTHING)

Images arrive first, often thin/no caption. **Persist each image on arrival as a pending/un-enriched record** (anchor = `external_id` + stored `asset_id`). Context then arrives in one of three ways — all must be handled:

1. **Quoted/swipe-reply** → bind via `messages.reply_to_external_id` (existing anchor). Enrich, never duplicate.
2. **Caption on the image** → parse inline.
3. **Loose follow-up message (NOT a reply)** → team often posts the photo, then types details as a brand-new message. Bind by **same-sender + most-recent-pending-image + time-window**; when two people post at once or it's ambiguous, **ask once / confirm**, never guess.

Cross-cutting:
- **Fan-out/fan-in:** one→one (enrich); one reply describing a set ("these three are Noor") → apply across the referenced set with confirmation; a state-change message ("shipped today") → drive a transition, not a new record.
- **Context-before-image / never-replied image** → hold in `pending_enrichment`, sweep + nag (pg_cron).
- **Idempotent:** re-quote / corrected follow-up updates the same record (last-writer-wins + audit trail). No duplicate rows.
- **Vision-parse is the fallback** when no human context ever lands.
- **Multi-format:** text / image / PDF / voice all normalize to text via the existing pipeline before hitting a smart-tool.

---

## 4. The three inventory types

1. **Supplies / procurement** — stock level, cost, supplier, PO/source. Team-fed.
2. **Textiles** — material, quantity, cost, source; feeds production.
3. **End products** — finished goods. Fields: **Tracking#** (unique key) · Name · Collection · Style · Who made it (maker) · Material used (links to consumed Textiles/Supplies) · Size · **all images** (asset_ids) · **all links** (tracking / listing / courier).

---

## 5. Lifecycle state machine (guarded)

`production → in-stock → reserved/sold → shipped → in-transit → delivered`, plus branch **`returned/restock`**. Illegal jumps refused + explained. Every transition driven by a message/event, persisted, reflected in portal, idempotent (double-ship = no-op). **Distinct states: sold ≠ paid ≠ settled ≠ shipped ≠ delivered**, each proof-backed.

---

## 6. Inventory drives ACTION (not a passive ledger)

State changes spawn **tasks to the right people**, reusing Sasa's existing task-delegation + TASK_FRAG honesty walls:
- New end-product request → **assign making to a maker** ("Aisha: make 2× Noor abaya, size M").
- Sale recorded → **shipping task to Nur** ("ship TRK-0192 to <customer>, courier <x>").
- Low stock on a supply/textile → **procurement task** ("restock thread, below threshold").
- Orphan image past N hours → **enrichment nudge** to the poster.
- Returned item → **restock/inspect task**.
Tasks, reminders, and inventory facts are **repopulatable** — the store can rebuild brain grounding and re-emit outstanding tasks so the system is self-healing and works from day one.

---

## 7. Finance component (bot-native, currency-correct, reconciled)

- **Everything captured from WhatsApp** (receipt photo, "paid 320 for thread", "sold for 850 on Folklore") → real finance rows via the existing `record_payment`-style pipeline. Portal is review; bot is entry.
- **Multi-currency from day one (AED/USD/KES):** every money field = amount + currency; reuse currency-aware `money(amount, currency)`; **NEVER sum across currencies** (the $14.85M overstatement was exactly this). Converted totals only with a stamped FX rate + date. Refs: `nisria-1485m-donation-overstatement-was-latent-and-fixed`, `currency-helper-must-carry-currency`.
- **Reconcile into the existing Nisria Finance module** (same Supabase), tagged `source: maisha_inventory`, `created_by` + batch-tag idempotency (no double-count).
- **Captures/computes:** COGS (supplies + textiles + production + shipping) → unit cost; revenue (price − channel fees) → net; **margin per product**; **per-collection P&L**; expenses (procurement, courier, packaging, overhead); **outstanding** (sold-not-paid, shipped-not-settled).
- **Finance honesty walls:** no fabricated numbers (missing = `unknown` / null, ask once or flag Nur, never infer); no fake zeros; monthly answers **per-currency** with uncounted/unpaid items named; revenue recognized only when persisted as paid (proof-backed). Refs: `payment-paid-requires-proof-not-assertion`, `fuzzy-payee-match-must-gate-first-name`.

---

## 8. External integrations (Phase 2 — designed-in, dormant)

Adapter interfaces + schema fields + tools exist from day one, carry **no live credentials**, stay dormant until Phase 1 stands alone. **No retrofit; just a switch flipped later.**
- **Jensen's Shopify** — orders/paid/fulfillment webhooks → map order→product by SKU/tracking# → auto-create sale + fees + payout rows. First connector when switched on.
- **Folklore** — adapter (API today / CSV-or-email-parse fallback). `folklore_listed` already exists in schema.
- **Shipping carriers** — tracking webhooks/polling → auto-advance lifecycle + save tracking link.
- **Hard parts pre-designed:** dedup/identity match (tracking#/SKU/order-id via `dedupe_check`); **source precedence** (carrier wins shipping status, Shopify wins paid/amount, human-in-WhatsApp wins product attribution); idempotent webhook ingestion on external id; source currency → multi-currency rule; **bot as notifier** (inbound event → WhatsApp push); webhook secrets/retries/backfill + reconciliation sweep.

---

## 9. Customer comms (secondary, gated)

Read-only status via scoped **order token**. Wrong/missing/foreign token → refuse, no leak. Cancel/change-address → out of scope, escalate to Nur, never mutate. Spam → deflect, no side-effects. Output filter strips internal `sasa`/Nisria fields.

---

## 10. Portal — Inventory section (folders)

**Product Catalogue** (all end products; filter by collection/style/maker/size/state; cards show images + links + lifecycle) · **Collections** (folder per collection) · **Supplies / Procurement** · **Textiles** · **Production board** · **Deliveries** (in-transit + delivered, tracking links) · **Finance** (per-currency expense & revenue, COGS, margin/product, per-collection P&L, outstanding, reconciliation view into Nisria Finance) · **Tasks** (inventory-spawned, who/what/state) · **Pending enrichment** (orphan images) · **Channels/Integrations** (Phase 2: sync health, last-synced, unmatched orders, conflicts). Reuse `FocusSheet` for drill-in, not a custom overlay. Ref: `reuse-focussheet-overlay-not-custom`.

---

## 11. Tool Catalog (build in advance; register each in the honesty guard)

> For each write tool: add NAME to `COMPLETION_TOOLS` + `stubTool` switch (+ `READ_TOOLS` if read, + `TEAM_TOOL_NAMES` if team-safe). Match real function names in `sasa.ts` — fan-out agents reconcile invented names below against what exists.

**Intake/binding:** `persist_pending_image` · `bind_reply_to_anchor` · `bind_followup_to_pending` · `parse_caption` · `vision_extract` (reuse `readMedia`) · `resolve_target_set` · `enqueue_pending_enrichment` · `sweep_pending`
**Classification:** `classify_item` (supply|textile|end_product) · `dedupe_check` (tracking# + perceptual hash; first-name-gated fuzzy)
**Inventory writes:** `upsert_supply` · `upsert_textile` · `upsert_end_product` · `adjust_stock` · `consume_materials` · `correct_record` (audited)
**Assets:** `store_image` (reuse `storeMedia`/`asset_id`) · `save_link(type,url)` · `attach_asset`
**Lifecycle:** `transition_state` (guarded) · `get_lifecycle`
**Action/tasks:** `assign_make_task(maker, product, qty)` · `assign_ship_task(tracking#, customer, courier)` · `raise_procurement_task(item)` · `nudge_enrichment(poster, image)`
**Fulfillment:** `record_sale(channel, customer, price, currency)` · `record_shipment(courier, tracking_url, destination)` · `update_shipping_status`
**Finance:** `log_expense` · `compute_cost` · `compute_margin` · `collection_pnl` · `record_payment(ref, amount, currency, status)` · `money(amount, currency)` · `fx_convert(amount, from, to, rate, date)` · `channel_fee(channel, amount)` · `outstanding_report` · `reconcile_against_statement`
**External (Phase 2, dormant):** `ingest_shopify_order` · `ingest_folklore_order` · `ingest_carrier_event` · `match_external_to_product(key)` · `resolve_source_conflict(field, sources)` · `backfill_source(since)`
**Customer (gated, read-only):** `lookup_order_by_token` · `customer_status_reply`
**Read/portal:** `query_inventory` · `inventory_summary` · `catalogue_view` · `deliveries_view` · `low_stock_report`
**Integrity/honesty:** `assert_persisted` · `refuse_on_ambiguity` · `audit_log` · `emit_receipt`

---

## 12. Question & Scenario Taxonomy (anticipated)

- **Intake:** "Logged?" / no-context photo / 6 photos + one reply / photo then separate message / reply to wrong image / corrected follow-up / "this one's sold" no tracking# / "same as last but blue, size M" / supply receipt mistaken for product / voice note or forwarded screenshot (unsupported-input handling).
- **Lifecycle:** bulk "mark shipped" / "cancel that sale" / "it came back" / illegal transition / double-ship.
- **Team queries:** counts by collection / low stock / "who made the green abaya" / monthly spend (per-currency) / margin on a piece / what's in production / "where's order X" (internal full view).
- **Customer (adversarial-aware):** valid token → status; bad/foreign token → refuse; cancel/change → escalate; spam → deflect.
- **Honesty traps:** "you logged all 10 right?" when 7 persisted → honest count; "just say it's shipped" → refuse; passive-completion phrasing → don't infer.

---

## 13. Failure modes anticipated now (the main-Sasa lesson)

Orphan images (sweep + nag) · context-before-image (buffer then bind) · loose-follow-up mis-association when 2 people post at once (confirm) · tracking# typos/collisions (first-name-gated fuzzy + confirm, never silent overwrite) · partial writes (transactional/compensating, never half-true) · `_check` constraint silently rejecting inserts (grep schema first) · honesty-guard rewriting true confirmations (allowlist) · multi-tenant leak on customer path (output filter) · group noise misread as intake (intent gate before any write) · unit/currency/size ambiguity (normalize + confirm) · authority by sender identity · **currency mixing (hard wall)** · **duplicate order from two sources (dedup + precedence)**.

---

## 14. Trust UX

**Receipt echo** after every write (under chime-in: "✅ Logged: Noor / abaya / size M / maker Aisha / TRK-0192 · 2 photos · 1 link") · **edit window** (follow-up within N min edits; later → `correct_record` audited) · **bulk import** (20-photo drop = batch + progress reply) · **provenance** (every record + asset stores source message id + sender).

---

## 15. Build discipline & phasing

- **Phase 1 — team-internal, ships first:** schema migration (reconcile existing `inventory` table + check constraints) → asset storage → ingest capture (silent-mode safe) → 3-mode binder → vision fallback → classifier → lifecycle state machine → task spawns → finance rollups (multi-currency) → portal read API + folders → tests. External adapters scaffolded but dormant. **Backend curls clean before any portal UI.**
- **Phase 2 — external sources:** flip dormant connectors on, one at a time (Shopify first).
- Tier-1 (multi-tenant, money-adjacent): SPEC → ADR → SCHEMA → EVAL → CODE → SOAK. No "done" without curl proof or click-through.
- **Do not deploy.** Tag KT entry `🟠 promise-only` until Phase 1 standalone is proven and Taona greenlights prod.

---

## 16. Next step — fan-out study (run after this doc is locked)

Spawn parallel agents over `~/Code/nisria-techops` to produce a build-ready merge plan:
1. **sasa.ts auditor** — real tool registry, the honesty-guard sets (`COMPLETION_TOOLS`/`READ_TOOLS`/`TEAM_TOOL_NAMES`/`stubTool`), role tiers, brain grounding/recall. Map invented tool names → real ones.
2. **schema auditor** — `inventory` table shape, `_check` constraints, finance/payments tables, assets/`asset_id`, tasks table, `org_profile`/`agent_memory`.
3. **group ingest auditor** — `/api/group/ingest` + `/outbox`, `GROUP_LISTEN_ONLY`, `reply_to_external_id`, media storage path, system-message filter.
4. **finance/reconciliation auditor** — `money()`, currency handling, `record_payment`, Nisria Finance module link points.
5. **portal auditor** — existing Inventory surface, `FocusSheet`, nav, what folders already exist vs missing.
6. **synthesizer** — merge findings into: what exists / what's missing / migration list / tool-registration checklist / build order, with file:line evidence.
