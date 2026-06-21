# DEPLOY TO MAIN — Maisha Inventory

> The single doc to locate every file and wire the sandbox into the live Nisria platform.
> **Status: sandbox hardened, 34/34 tests green, nothing live touched.** Do NOT deploy until the gate at the bottom is met.

---

## 0. What this is
The sandbox at `specs/004-maisha-inventory/sandbox/` is a working, in-process (PGlite) proof of the whole Maisha Inventory loop. Every adversarial finding in `../SKEPTIC-FINDINGS.md` bucket **A (sandbox logic bugs)** is now FIXED and tested. Buckets **B (integration)** and **C (live bugs)** are the work in this doc.

---

## 1. FIXED in the sandbox (was bucket A) — verified by test
| Fix | Where | Test |
|---|---|---|
| `recordSale` atomic; refuses non-sellable state; no false "done" | `src/tools.ts` recordSale | "sale on a non-sellable lifecycle state is refused, writes nothing" |
| Per-SALE idempotency → resale after restock works | recordSale `batch_tag …:sale:N` | "returns → restock → RESELL works" |
| Double-sell refused | recordSale sellable gate | "sale: …; double-sell REFUSED" |
| `consumeMaterials` refuses insufficient stock; no negative | tools.ts + `CHECK(quantity>=0)` | "consumeMaterials refuses…", "trap 3" |
| 6 missing handlers implemented (`upsert_*`, `correct_record`, `get_lifecycle`, `record_payment_link`) | tools.ts | "direct upserts", "correct_record", "get_lifecycle", "record_payment_link" |
| Guard meta-check now asserts a HANDLER exists, not just a flag | `src/guard.ts` verifyGuardRegistration(handlerNames) | "guard: meta-check catches…unimplemented" |
| Pending rows UNTYPED (`item_type=NULL`) until classified | tools.ts persistPendingImage | "pending rows are UNTYPED until classified" |
| All multi-write tools wrapped in one transaction | tools.ts (db.transaction) | atomicity tests |
| Orphan sweep (nudge→expire) | tools.ts sweepPending | "orphan sweep: …no unbounded rot" |
| Per-actor authorization on corrections | tools.ts correctRecord | "correct_record: per-actor authorization" |
| Customer token: CSPRNG, phone-bound, expiring, rate-limited, status-only DTO | tools.ts lookupOrderByToken | 3 customer-path tests |
| Injection defense on the extractor | `src/classify.ts` sanitizeExtraction | "injection defense…" |

Run it: `cd sandbox && npm install && npm test` (34 pass) · `npm run demo`.

---

## 2. FILE → LIVE TARGET map (where each piece goes)
| Sandbox file | Live target | Action |
|---|---|---|
| `schema.sql` | `platform/db/migrations/2026XXXX_maisha_inventory.sql` | rewrite as ALTER/CREATE against LIVE (see §3) |
| `src/tools.ts` | `platform/lib/smart-tools.ts` | each fn → a `runAction`/`runRead` branch; register in `SMART_TOOLS` |
| `src/guard.ts` | `platform/lib/agents/sasa.ts` | fold into the live guard Sets (see §4); keep `verifyGuardRegistration` as a unit test over LIVE Sets + handler names |
| `src/classify.ts` | `platform/lib/agents/` (new) + reuse `readMedia` | `sanitizeExtraction` MUST wrap the LLM/vision output before any tool input |
| `src/binder.ts` | `platform/app/api/group/ingest/route.ts` | the 3-mode binder (see §5) |
| `src/ingest.ts` | same ingest route | persist-pending + storeMedia + reply-anchor + SYSTEM gate (see §5) |
| `src/money.ts` | `platform/lib/supabase-admin.ts` | extend `money()` with AED; reuse `sumByCurrency` |
| `src/lifecycle.ts` | `platform/lib/agents/` (new) | pure module, ports as-is |
| `org_facts` table | `agent_memory(kind='org_fact')` | write rollups; extend `FINANCE_GROUNDING` (see §6) |

---

## 3. MIGRATION (the part the sandbox CANNOT prove — write fresh against LIVE)
Live is `uuid` PKs, RLS-on, non-empty `inventory`, FKs to `team_members`. The sandbox uses `text` ids and clean tables. So:
1. **`inventory` ALTERs** (not CREATE): `ADD COLUMN IF NOT EXISTS item_type text` (nullable) → **backfill** legacy rows (`UPDATE inventory SET item_type='end_product' WHERE item_type IS NULL` — DECIDE this default with Nur) → then `ADD CONSTRAINT … CHECK (item_type IS NULL OR item_type IN ('supply','textile','end_product'))`. Add `lifecycle_state` + its own check (NEVER overload `status`). Add `tracking_no text UNIQUE` (NULLs ok), `style,maker,size,cost_currency,price_currency,asset_ids uuid[],links jsonb,source,enriched`. Add `CHECK (quantity>=0)`. Wrap in `BEGIN/COMMIT`; use `NOT VALID` + later `VALIDATE` for the table-rewriting checks.
2. **`messages`**: `ADD COLUMN IF NOT EXISTS asset_id uuid` (formalize the column the DM worker already writes). Do NOT re-create.
3. **`tasks`**: `DROP CONSTRAINT tasks_source_check; ADD … CHECK (source IN ('manual','ai','inventory'))`. Spawned tasks must satisfy live shape (`assignee_id uuid → team_members`, not the sandbox's `assignee text`).
4. **`payments`**: `ADD COLUMN source text`, `ADD COLUMN batch_tag text` (+ partial unique index). Without this, `logExpense` INSERT fails live.
5. **New tables** (`inventory_materials`, `inventory_lifecycle_events`, `pending_enrichment`, `inventory_sales`): CREATE with `uuid` PKs/FKs (NOT the sandbox `text`), then **re-run the RLS enable-sweep** (`20260620_enable_rls_all_public.sql` pattern) + service-role policies.
6. **Dedup pre-scan** before adding any `UNIQUE` (batch_tag/tracking_no) or the ADD fails on existing dupes.
7. Preserve/retire orphaned live columns `location`, `photo_urls` (move `photo_urls → asset_ids`).
8. **`org_profile.fx_rates`**: implement (stamped rate+date) before any AED↔USD/KES blend.

---

## 4. SASA.TS REGISTRATION CHECKLIST (13 sites — miss one = silent honesty bug)
For each new tool add the NAME to ALL that apply:
1. `SMART_TOOLS` array (declare) — `smart-tools.ts`
2. `runRead`/`runAction` dispatch branch — `smart-tools.ts`
3. `COMPLETION_TOOLS` (every write) — `sasa.ts`
4. NEW `SHAPE_INVENTORY` regex + a `{name,regex,requiredTools}` entry in the `shapes` array + a new `INVENTORY_TOOLS` Set — `sasa.ts`
5. `AGENT_COMPLETION` verb list — add `shipped|delivered|sold|moved|consumed|enriched|restocked` (else fabricated "I shipped it" passes unchecked)
6. `TEAM_TOOL_NAMES` — add team-safe inventory tools; **NEVER** finance (`record_sale`/`log_expense`/`record_payment_link`)
7. `READ_TOOLS` — `query_inventory`/`inventory_summary`/`get_lifecycle`/`lookup_order_by_token`
8. `STAGING_TOOLS` — if `record_sale`/`record_payment_link` stage
9. `SEND_TOOLS` — only if a tool notifies a human this turn (inventory writes do NOT)
10. `stubTool` switch (eval dry-run) — add a case per tool
11. **`worker/route.ts` confirm-`kind` switch** — add real commit cases; **fix the `else` fallthrough first (bucket C / B1)**
12. `carriesMoney`/`FINANCE_GROUNDING` vocab — add `sale|margin|COGS|price|channel fee|expense|payout` so team grounding strips them
13. Port `verifyGuardRegistration(handlerNames)` as a LIVE unit test so CI catches a missing registration/handler.

Watch: SHAPE words collide with `SHAPE_MONEY` (a sale reply with a price → checked against PAYMENT_TOOLS → wrongly hedged). Test sale/shipment claim verification explicitly.

---

## 5. GROUP INGEST wiring (`app/api/group/ingest/route.ts`)
- **Persist-pending** in the media-drop branch: switch raw `storage.upload` → `storeMedia()` so a real `assets` row + `messages.asset_id` exist, then write the pending inventory row + `pending_enrichment`.
- **Reply bind (mode 1) is DEAD until the Baileys userbot ships the quoted message's wamid.** The route only gets `quoted_text`. Change the userbot to POST `reply_to_external_id`, then persist it on the message insert (mirror `webhook/route.ts`).
- **SYSTEM intent gate**: import the `SYSTEM` regex (currently read-side only in `groups/messages/route.ts`) and gate BEFORE any capture.
- **Job queue**: the group brain runs inline (`maxDuration=300`); a photo burst with per-message `storeMedia`+vision will pile up. Move the brain off the hot path onto a drained queue + per-sender coalescing + durable ambiguity slots, like the 1:1 path (`worker/route.ts`).
- **Loose-follow-up binder is newest-wins** — port `binder.ts` but add ordinal/adjacency disambiguation for catalog drops.

---

## 6. FINANCE integration
- **Cost pollution**: add `.neq("source","maisha_inventory")` AND `select` the `source` column in `lib/expenses.ts` `loadExpenses` and `Treasury.tsx` spend reducers, or Maisha cost inflates the NGO's donor-facing operating spend.
- **Revenue invisibility**: a live surface MUST read `inventory_sales` (nothing does today) or sales are off the books.
- **AED**: add AED as a first-class bucket in every per-currency split (`expenses.ts` `sumByCurrency`, `finance/page.tsx`, `Treasury.tsx`). NEVER coerce null currency `|| "KES"` — that re-opens the $14.85M blend. Refuse unknown currency (sandbox `sumByCurrency` already throws — match that).
- **FX**: implement `org_profile.fx_rates` with stamped rate+date; no hardcoded `129`; no AED blend without an AED rate.

---

## 7. BUCKET C — pre-existing LIVE bugs to triage separately (independent value)
1. **`worker/route.ts:485-513` silent-commit fallthrough** — the `else` marks a `pending_action` committed + replies "Done. Logged…" for any unknown kind, zero write. Fix fail-closed BEFORE staging any inventory action through it. (Also a latent honesty bug today.)
2. **`learnMemberPhone` identity hijack** (`group/ingest/route.ts:103-114`) — name-spoof auto-binds a stranger's phone to a roster member → team tier. Replace with admin-confirmed enrollment.
3. **`add_inventory_item` hardcodes actor "Nur"** — destroys per-actor accountability; thread the real caller.

---

## 8. DEPLOY GATE (do not connect until ALL true)
- [ ] Migration written against LIVE (uuid/RLS/FK/backfill), dry-run on a branch DB, reversible.
- [ ] `payments.source`+`batch_tag` added; `logExpense` curls clean.
- [ ] A live surface reads `inventory_sales`; finance queries filter `source`.
- [ ] AED bucketed everywhere; no `|| "KES"`; `fx_rates` stamped.
- [ ] All new tools registered at the 13 sites; `verifyGuardRegistration` LIVE test green.
- [ ] `worker/route.ts` confirm fallthrough fixed fail-closed.
- [ ] Group ingest: storeMedia+asset_id + reply-anchor (userbot change) + SYSTEM gate + queue.
- [ ] Backend curls clean BEFORE any portal UI. Tier-1 SOAK. KT entry `🟠 promise-only` until curl-verified live.

Sequence: migration → tools+guard registration → finance integration → group ingest → portal → soak. One driver on the repo (A3). Nothing live before the gate.
