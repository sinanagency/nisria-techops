-- 2026-06-21, KT #357. The send-on-confirm fix stages a pending_actions row of
-- kind 'send_message' when the honesty wall catches a "told them" claim with no
-- real send, so the operator's "yes" can complete the relay through the confirm
-- gate (instead of the old dead-end loop where "yes" re-offered with nothing
-- staged). The kind check constraint must allow it, or the insert throws and the
-- code silently falls back to the dead-end. Caught live on 2026-06-21 (the insert
-- returned 23514 pending_actions_kind_check before this migration).
--
-- status 'awaiting_confirm' / 'committed' / 'cancelled' already exist, so only the
-- kind list changes.

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
    'send_message'::text
  ]));

COMMENT ON CONSTRAINT pending_actions_kind_check ON public.pending_actions IS
  'Allowed pending_action kinds. send_message (2026-06-21, KT #357) = a staged relay the operator confirmed; the confirm gate completes it via message_person.';

COMMIT;
