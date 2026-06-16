-- PRODUCTION FIXES: pending_actions table, constraints, indexes, RLS
-- Applied: 2026-06-16

-- 1. pending_actions table (was created manually, never in migrations).
-- DO block ensures constraints are added even if table already exists.
CREATE TABLE IF NOT EXISTS public.pending_actions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  contact_id uuid,
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary text,
  status text NOT NULL DEFAULT 'awaiting_confirm'::text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  resolved_at timestamp with time zone,
  CONSTRAINT pending_actions_pkey PRIMARY KEY (id)
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pending_actions_kind_check') THEN
    ALTER TABLE public.pending_actions ADD CONSTRAINT pending_actions_kind_check CHECK (kind = ANY (ARRAY['record_payment', 'bank_import', 'parsed_task_from_group', 'case_to_approve', 'task_cleanup']));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pending_actions_status_check') THEN
    ALTER TABLE public.pending_actions ADD CONSTRAINT pending_actions_status_check CHECK (status = ANY (ARRAY['awaiting_confirm', 'awaiting_review', 'committed', 'superseded', 'cancelled']));
  END IF;
END $$;

-- 2. contacts unique constraint (prevents duplicate contacts by phone+channel)
CREATE UNIQUE INDEX IF NOT EXISTS contacts_phone_channel_idx ON public.contacts (phone, channel) WHERE phone IS NOT NULL;

-- 3. Add 'draft' to inventory status check constraint
ALTER TABLE public.inventory DROP CONSTRAINT IF EXISTS inventory_status_check;
ALTER TABLE public.inventory ADD CONSTRAINT inventory_status_check CHECK (status = ANY (ARRAY['in_stock'::text, 'low'::text, 'out'::text, 'archived'::text, 'draft'::text]));

-- 4. Enable RLS on groups table
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;

-- 5. pending_actions indexes (hot query paths)
CREATE INDEX IF NOT EXISTS idx_pending_actions_contact_status ON public.pending_actions (contact_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pending_actions_kind ON public.pending_actions (kind);
CREATE INDEX IF NOT EXISTS idx_pending_actions_payload_idempotency ON public.pending_actions USING gin (payload jsonb_path_ops);

-- 6. messages index for group history queries
CREATE INDEX IF NOT EXISTS idx_messages_account_channel_date ON public.messages (account, channel, created_at DESC) WHERE account IS NOT NULL AND channel IS NOT NULL;

-- 7. Index for FLAG_NUR dedup queries on events
CREATE INDEX IF NOT EXISTS idx_events_type ON public.events (type);
