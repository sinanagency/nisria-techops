# Maisha Inventory — Sandbox

Isolated, in-process proof of the Sasa Maisha Inventory function. **Nothing here touches the live DB, live `sasa.ts`, or WhatsApp.** It runs Postgres (PGlite) in-process so the schema and constraints behave exactly like Supabase will.

## Run
```bash
npm install
npm test     # 20 tests — every flow + every trap
npm run demo # end-to-end narrative (silent-capture mode)
```

## What it proves (all green)
- **3 intake modes:** swipe-reply bind, caption-on-image, loose follow-up (same sender + recent pending image + window); 2 pending photos → asks once, never guesses.
- **Silent capture:** under listen-only the row + brain run; only the in-group reply is withheld. Chime-in is a flag flip.
- **Guarded lifecycle:** production→…→delivered + returned/restock; illegal jumps refused; double-ship idempotent (no dup event).
- **Inventory drives action:** a sale auto-spawns a ship-task to Nur (`source='inventory'`); low stock → procurement task.
- **Finance never blends currency:** USD/KES/**AED** stay separate; cross-currency only via stamped FX; per-collection P&L + COGS from consumed materials.
- **Honesty guard:** a meta-test fails the build if any write tool isn't registered (the live `update_inventory_item` bite, caught at test time); team tier never sees finance figures; customer path returns sanitized status only.
- **The three `_check` traps** reproduced and enforced: `status` rejects lifecycle words, `lifecycle_state` accepts them, `tasks.source='inventory'` allowed.

## Connect-later map (sandbox → live)
| Sandbox file | Live target | Migration action |
|---|---|---|
| `schema.sql` | Supabase `db/migrations/` | new tables CREATE as-is; `inventory`/`tasks`/`payments`/`messages` deltas → DROP-CONSTRAINT-then-ADD / ADD COLUMN IF NOT EXISTS **against live DB** (schema.sql dump is stale) |
| `src/tools.ts` | `platform/lib/smart-tools.ts` | each fn → a `runAction`/`runRead` branch; register name in `SMART_TOOLS` |
| `src/guard.ts` | `platform/lib/agents/sasa.ts` | fold INVENTORY_TOOLS into `COMPLETION_TOOLS`/`READ_TOOLS`/`TEAM_TOOL_NAMES`/`stubTool` + add `SHAPE_INVENTORY`; keep `verifyGuardRegistration` as a unit test |
| `src/ingest.ts` | `app/api/group/ingest/route.ts` | add persist-pending + `storeMedia`/`asset_id` + persist `reply_to_external_id` + SYSTEM intent gate in the media branch |
| `src/binder.ts` | same ingest route | the 3-mode binder |
| `src/money.ts` | `lib/supabase-admin.ts` | extend `money()` with AED bucket; reuse `sumByCurrency` discipline |
| `org_facts` table | `agent_memory(kind='org_fact')` | write rollups; add inventory-finance terms to `FINANCE_GROUNDING` so team grounding strips them |

External connectors (Shopify/Folklore/carriers) are intentionally NOT here — Phase 2, scaffolded dormant after this proves out.

## Notes
- `src/classify.ts` `parseFields` is a deterministic stand-in for the prod vision/LLM extraction (`readMedia`). It handles the common grammars; prod replaces it with the model, same downstream contract.
- IDs/clock are deterministic (`src/db.ts`) — the harness bans `Date.now()`/`Math.random()`; also keeps tests stable.
