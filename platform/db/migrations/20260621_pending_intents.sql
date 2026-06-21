-- Pending Intents: durable subscription to a future EXTERNAL event (KT #206542, 2026-06-21).
--
-- THE DEFECT: Sasa promised future-contingent actions ("the moment Malek texts in
-- I'll message him", "send me the photo and I'll attach it", "I'll tell you when
-- Taona replies") but persisted no trigger. The promise lived only in chat
-- narration and was forgotten once history scrolled past. The bot could defer on
-- the CLOCK (crons) and on the operator's OWN next "yes" (pending_actions confirm
-- gate), but never on "when person X does Y".
--
-- THE PRIMITIVE: one row = one subscription. "When an event of trigger_type
-- matching trigger_key occurs, run action_type(payload)." The inbound worker
-- dispatches matching rows through typed, separately-guarded handlers. A new
-- scenario is a new trigger_type + handler on THIS table, not new plumbing.
--
-- Phase 1 ships exactly one trigger_type: 'window_open' / action 'send_text' (the
-- deferred relay). The table is general so Phase 2 (cross-surface photo join) and
-- Phase 3 (owner reply-back) add rows, not columns.
--
-- WHY A NEW TABLE (not a pending_actions kind): pending_actions is the operator
-- CONFIRM queue, keyed on the operator's contact_id and drained by the operator's
-- "yes" within 20 minutes. A pending_intent is keyed on a THIRD party's wa_id and
-- fires on that party's future action, over hours. Different key, trigger, and
-- lifecycle. Overloading the confirm gate would mis-key and mis-trigger it.
--
-- DARK UNTIL RUN: all reads/writes in code are best-effort; absent this table the
-- bot behaves exactly as before. Safe to deploy the code before running this.
--
-- Service-role only (RLS on, no policies = deny-all to anon). Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS public.pending_intents (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- WHAT FIRES IT
  trigger_type         text NOT NULL,           -- 'window_open' (Phase 1); later: 'next_media','reply_on_thread',...
  trigger_key          text NOT NULL,           -- match key: for window_open = recipient wa_id (phoneKey form)
  -- WHAT IT DOES
  action_type          text NOT NULL,           -- 'send_text' (Phase 1)
  payload              jsonb NOT NULL,           -- action params, e.g. { "body": "...", "to_name": "Malek" }
  -- LIFECYCLE
  status               text NOT NULL DEFAULT 'pending',
  attempts             int  NOT NULL DEFAULT 0,
  last_error           text,
  -- ISOLATION: only 'live' rows fire on a live inbound; a test/dev/maintenance row
  -- can never fire at a real user (guardrail 5).
  origin               text NOT NULL DEFAULT 'live',
  -- PROVENANCE: who asked, so we can confirm back when it lands.
  requester_wa_id      text,
  requester_contact_id uuid,
  to_name              text,
  reason               text,
  trace_id             text,
  -- IDEMPOTENCY: one live row per (trigger_key, action, content, requester).
  dedup_key            text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz NOT NULL,     -- created_at + 48h (guardrail 3)
  fired_at             timestamptz,
  resolved_at          timestamptz,
  CONSTRAINT pending_intents_status_check
    CHECK (status = ANY (ARRAY['pending'::text,'firing'::text,'done'::text,'expired'::text,'failed'::text,'cancelled'::text])),
  CONSTRAINT pending_intents_origin_check
    CHECK (origin = ANY (ARRAY['live'::text,'dev'::text,'maintenance'::text,'harness'::text]))
);

-- FLUSH (hot path): "live pending intents of this type for this key, oldest first".
CREATE INDEX IF NOT EXISTS pending_intents_flush_idx
  ON public.pending_intents (trigger_type, trigger_key, created_at)
  WHERE status = 'pending';

-- DEDUP: at most one LIVE pending row per dedup_key. Partial so a sent/expired row
-- never blocks a legitimately new subscription later.
CREATE UNIQUE INDEX IF NOT EXISTS pending_intents_dedup_uniq
  ON public.pending_intents (dedup_key)
  WHERE status = 'pending';

-- SWEEP: expiry scan.
CREATE INDEX IF NOT EXISTS pending_intents_expiry_idx
  ON public.pending_intents (expires_at)
  WHERE status = 'pending';

ALTER TABLE public.pending_intents ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.pending_intents IS
  'Durable subscription to a future external event (KT #206542, 2026-06-21). One row = "when an event of trigger_type matching trigger_key happens, run action_type(payload)". Dispatched by the inbound worker through typed guarded handlers. Phase 1: trigger_type=window_open / action=send_text (deferred relay). Service-role only.';
COMMENT ON COLUMN public.pending_intents.origin IS
  'live|dev|maintenance|harness. Only live rows fire on a live inbound, so a test message can never fire at a real user. KT #206542 guardrail 5.';
COMMENT ON CONSTRAINT pending_intents_status_check ON public.pending_intents IS
  'pending=waiting for trigger; firing=claimed by a dispatcher (atomic, no double-fire); done=fired; expired=trigger never arrived in time; failed=handler errored past attempt cap; cancelled=superseded. KT #206542.';

COMMIT;
