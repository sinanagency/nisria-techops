-- ============================================================================
-- Maisha Inventory — SANDBOX schema == FUTURE Supabase migration
-- ----------------------------------------------------------------------------
-- This is Postgres (runs on PGlite in-process, applies 1:1 to live Supabase).
-- It reproduces the THREE silent-reject _check traps the audit found, so the
-- sandbox enforces exactly what prod will. When we connect: the new tables are
-- CREATE as-is; the `inventory`/`tasks`/`payments`/`messages` deltas become
-- DROP-CONSTRAINT-then-ADD / ADD COLUMN IF NOT EXISTS against the live tables.
-- Decisions baked in (vs current live):
--   * lifecycle gets its OWN column `lifecycle_state` (status stays stock-level)
--   * tasks_source_check gains 'inventory' (live is manual|ai only)
--   * payments gains `source` + `batch_tag` for tagged, idempotent reconcile
--   * end-product fields + item_type discriminator added to inventory
-- ============================================================================

-- ---------------------------------------------------------------------------
-- messages — minimal model of the WhatsApp message row (the ingest anchor).
-- Mirrors the columns the binder needs: external_id (unique), the swipe-reply
-- anchor reply_to_external_id, and asset_id (the storeMedia link the GROUP
-- path is currently missing — here it is first-class so binding is testable).
-- ---------------------------------------------------------------------------
CREATE TABLE messages (
  id                    TEXT PRIMARY KEY,
  external_id           TEXT UNIQUE NOT NULL,     -- WhatsApp wamid
  reply_to_external_id  TEXT,                     -- swipe/quoted-reply anchor
  asset_id              TEXT,                     -- storeMedia link (group path gap closed)
  group_name            TEXT NOT NULL,
  sender_phone          TEXT NOT NULL,
  sender_name           TEXT,
  sender_role           TEXT NOT NULL DEFAULT 'team',  -- admin|team|null(customer)
  body                  TEXT,
  has_image             BOOLEAN NOT NULL DEFAULT FALSE,
  media_path            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_reply_anchor ON messages(reply_to_external_id) WHERE reply_to_external_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- assets — the storeMedia target (idempotent on source_ref = wamid).
-- ---------------------------------------------------------------------------
CREATE TABLE assets (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL DEFAULT 'proof',
  storage_path TEXT NOT NULL,
  mime         TEXT,
  source       TEXT NOT NULL DEFAULT 'whatsapp',
  source_ref   TEXT UNIQUE,           -- wamid → idempotent re-ingest
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- inventory — the three types live in ONE table, discriminated by item_type.
-- TRAP 1 reproduced: inventory_status_check (stock-level vocab only).
-- lifecycle_state is a SEPARATE column with its OWN check (the design decision).
-- ---------------------------------------------------------------------------
CREATE TABLE inventory (
  id              TEXT PRIMARY KEY,
  item_type       TEXT,                          -- NULL until classified; supply | textile | end_product
  sku             TEXT,
  tracking_no     TEXT UNIQUE,                   -- end-product unique key
  name            TEXT NOT NULL,
  collection      TEXT,
  style           TEXT,
  category        TEXT,
  maker           TEXT,                          -- "who made it"
  size            TEXT,
  quantity        INTEGER NOT NULL DEFAULT 0,
  -- money fields carry currency (the currency-law; live unit_cost/price had none)
  unit_cost       NUMERIC(12,2),
  cost_currency   TEXT,
  unit_price      NUMERIC(12,2),
  price_currency  TEXT,
  status          TEXT NOT NULL DEFAULT 'in_stock',   -- STOCK level
  lifecycle_state TEXT,                               -- PRODUCTION→DELIVERY (end_product only)
  folklore_listed BOOLEAN NOT NULL DEFAULT FALSE,
  folklore_url    TEXT,
  asset_ids       TEXT[] NOT NULL DEFAULT '{}',
  links           JSONB NOT NULL DEFAULT '{}',        -- {tracking_url, listing_url, courier_url}
  source          TEXT NOT NULL DEFAULT 'maisha_inventory',
  enriched        BOOLEAN NOT NULL DEFAULT FALSE,     -- pending vs enriched
  created_by      TEXT,
  source_message_external_id TEXT,                     -- provenance
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- nullable until classified (no more 'fake end_product' pre-typing)
  CONSTRAINT inventory_item_type_check
    CHECK (item_type IS NULL OR item_type IN ('supply','textile','end_product')),
  -- stock can never go negative (consumeMaterials floor)
  CONSTRAINT inventory_quantity_nonneg CHECK (quantity >= 0),
  -- TRAP 1: live values + 'draft'. Lifecycle words are NOT allowed here.
  CONSTRAINT inventory_status_check
    CHECK (status IN ('in_stock','low','out','archived','draft')),
  -- the migrated lifecycle vocab, on its own column
  CONSTRAINT inventory_lifecycle_state_check
    CHECK (lifecycle_state IS NULL OR lifecycle_state IN
      ('production','in_stock','reserved','sold','shipped','in_transit','delivered','returned','restock'))
);
CREATE INDEX idx_inventory_type ON inventory(item_type);
CREATE INDEX idx_inventory_collection ON inventory(collection);
CREATE INDEX idx_inventory_lifecycle ON inventory(lifecycle_state) WHERE lifecycle_state IS NOT NULL;

-- ---------------------------------------------------------------------------
-- inventory_materials — end_product → consumed textiles/supplies (for COGS).
-- ---------------------------------------------------------------------------
CREATE TABLE inventory_materials (
  id                TEXT PRIMARY KEY,
  end_product_id    TEXT NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
  material_id       TEXT NOT NULL REFERENCES inventory(id),
  qty               NUMERIC(12,2) NOT NULL DEFAULT 1,
  unit_cost         NUMERIC(12,2),
  currency          TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- inventory_lifecycle_events — audit trail; idempotent double-ship guard.
-- ---------------------------------------------------------------------------
CREATE TABLE inventory_lifecycle_events (
  id             TEXT PRIMARY KEY,
  inventory_id   TEXT NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
  from_state     TEXT,
  to_state       TEXT NOT NULL,
  evidence       TEXT,
  source_message_external_id TEXT,
  created_by     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- pending_enrichment — orphan images waiting for context (swept by pg_cron live).
-- ---------------------------------------------------------------------------
CREATE TABLE pending_enrichment (
  id                    TEXT PRIMARY KEY,
  message_external_id   TEXT NOT NULL,
  inventory_id          TEXT REFERENCES inventory(id) ON DELETE SET NULL,
  asset_id              TEXT,
  sender_phone          TEXT,
  sender_name           TEXT,
  group_name            TEXT,
  status                TEXT NOT NULL DEFAULT 'pending',  -- pending|enriched|nudged
  nudged_at             TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pending_enrichment_status_check
    CHECK (status IN ('pending','enriched','nudged'))
);

-- ---------------------------------------------------------------------------
-- inventory_sales — REVENUE (greenfield; kept OUT of donations to not pollute
-- the nonprofit fundraising hero). Reconciles alongside payments.
-- ---------------------------------------------------------------------------
CREATE TABLE inventory_sales (
  id              TEXT PRIMARY KEY,
  inventory_id    TEXT NOT NULL REFERENCES inventory(id),
  tracking_no     TEXT,
  channel         TEXT NOT NULL,                 -- online|folklore|jensen_shopify|other
  customer        TEXT,
  customer_phone  TEXT,                          -- token is BOUND to this phone
  customer_token  TEXT,                          -- scoped status-check token (CSPRNG)
  token_expires_at TIMESTAMPTZ,                  -- tokens expire
  price           NUMERIC(12,2) NOT NULL,
  currency        TEXT NOT NULL,
  channel_fee     NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_status  TEXT NOT NULL DEFAULT 'sold',  -- sold|paid|settled
  payment_ref     TEXT,
  source          TEXT NOT NULL DEFAULT 'maisha_inventory',
  batch_tag       TEXT UNIQUE,                   -- idempotency
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT inventory_sales_channel_check
    CHECK (channel IN ('online','folklore','jensen_shopify','other')),
  CONSTRAINT inventory_sales_payment_status_check
    CHECK (payment_status IN ('sold','paid','settled'))
);

-- ---------------------------------------------------------------------------
-- payments — model of the LIVE reconcile target, + the two NEW columns the
-- audit flagged: source (tag) and batch_tag (idempotency). Cost outflows land
-- here tagged 'maisha_inventory' so they appear in expenses but can be filtered
-- out of the NGO operating view.
-- ---------------------------------------------------------------------------
CREATE TABLE payments (
  id              TEXT PRIMARY KEY,
  direction       TEXT NOT NULL DEFAULT 'out',
  payee           TEXT,
  purpose         TEXT,
  amount          NUMERIC(12,2) NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'USD',
  category        TEXT,                          -- + cogs|courier|packaging|procurement
  status          TEXT NOT NULL DEFAULT 'paid',
  screenshot_path TEXT,                          -- proof
  source          TEXT,                          -- NEW: 'maisha_inventory'
  batch_tag       TEXT UNIQUE,                   -- NEW: idempotency
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- tasks — model of the live tasks table. TRAP 2 reproduced + the decision:
-- tasks_source_check gains 'inventory' (live is manual|ai only).
-- ---------------------------------------------------------------------------
CREATE TABLE tasks (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  description   TEXT,
  assignee      TEXT,                            -- maker / Nur / etc (sandbox: text)
  status        TEXT NOT NULL DEFAULT 'todo',
  priority      TEXT NOT NULL DEFAULT 'medium',
  source        TEXT NOT NULL DEFAULT 'manual',
  source_kind   TEXT,                            -- make|ship|procurement|enrichment
  ref_inventory_id TEXT REFERENCES inventory(id) ON DELETE SET NULL,
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tasks_status_check
    CHECK (status IN ('todo','in_progress','in_review','done','blocked','abandoned','expired')),
  CONSTRAINT tasks_priority_check
    CHECK (priority IN ('low','medium','high')),
  -- TRAP 2 + decision: 'inventory' added (live migration must DROP/ADD this).
  CONSTRAINT tasks_source_check
    CHECK (source IN ('manual','ai','inventory'))
);

-- ---------------------------------------------------------------------------
-- org_facts — sandbox model of agent_memory(kind='org_fact'). Rollups written
-- here are what makes inventory answerable by Sasa on every turn. The is_finance
-- flag models the team-tier grounding strip (carriesMoney) so figures never leak.
-- ---------------------------------------------------------------------------
CREATE TABLE org_facts (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL DEFAULT 'org_fact',
  section     TEXT UNIQUE NOT NULL,              -- upsert key
  title       TEXT,
  content     TEXT NOT NULL,
  is_finance  BOOLEAN NOT NULL DEFAULT FALSE,    -- stripped from team grounding
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
