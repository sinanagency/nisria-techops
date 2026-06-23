-- 2026-06-23, KT #374 (class C2: model-fires-a-high-side-effect-without-authorization).
-- The convergence fix for C2 is "stage-then-confirm for irreversible writes": on the
-- WhatsApp surface, a HIGH/irreversible tool the MODEL proposes (log_payout, delete_*,
-- mark_payment_paid, approve/decline_case, transfer_drive_file, send_file_to_person, ...)
-- is NOT fired on the model's judgment. Instead it stages a pending_actions row and asks
-- the operator "reply yes", and the confirm gate executes it through the real tool with a
-- VERIFIED result (mirrors record_payment / send_message, which already work this way).
--
-- ONE GENERIC KIND 'confirm_action' (not one kind per tool): the staged row carries
--   payload = { tool: '<smart-tool name>', args: { ... }, preview: '<human line>' }
-- so the confirm gate dispatches by payload.tool. This means we NEVER need another
-- migration to gate the next irreversible tool — extensible by code alone. Safe to run
-- AHEAD of the C2 code: until the code stages a 'confirm_action' row, this constraint
-- change is inert (no behaviour change).
--
-- Without this, the staging insert throws 23514 pending_actions_kind_check and the code
-- silently falls back to firing the action ungated (the exact C2 failure mode). Status
-- values 'awaiting_confirm' / 'committed' / 'cancelled' already exist; only the kind list
-- grows. Idempotent: DROP IF EXISTS + re-add. Re-running is harmless.

BEGIN;

ALTER TABLE public.pending_actions DROP CONSTRAINT IF EXISTS pending_actions_kind_check;
ALTER TABLE public.pending_actions ADD CONSTRAINT pending_actions_kind_check
  CHECK (kind = ANY (ARRAY[
    'record_payment'::text,
    'bank_import'::text,
    'parsed_task_from_group'::text,
    'case_to_approve'::text,
    'task_cleanup'::text,
    'complete_task_awaiting_note'::text,
    'send_message'::text,
    'confirm_action'::text
  ]));

COMMENT ON CONSTRAINT pending_actions_kind_check ON public.pending_actions IS
  'Allowed pending_action kinds. confirm_action (2026-06-23, KT #374, class C2) = a staged irreversible HIGH-side-effect tool the operator must confirm with "yes"; payload carries {tool,args,preview} and the confirm gate dispatches on payload.tool. One generic kind so gating a new tool never needs a migration.';

COMMIT;
