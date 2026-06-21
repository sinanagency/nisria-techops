-- Extend pending_actions kind + status CHECK constraints for the team-tier
-- task-completion note slot (KT #324, 2026-06-20).
--
-- FEATURE: a multi-turn team-tier completion now holds the thread across the
-- "what was the outcome?" ask by staging a pending_actions row:
--   kind   = 'complete_task_awaiting_note'
--   status = 'awaiting_note'
-- so the member's free-text outcome note flows back into complete_task as its
-- `reason` instead of being re-parsed cold (the live bug: the note
-- "...before any changes" hit parseTaskDependency's "X before Y" pattern and
-- mis-routed into link_task_dependency, leaking machine-talk; the task was never
-- closed).
--
-- WHY THIS MIGRATION IS LOAD-BEARING (KT #316 / #323 lesson): the live constraints
-- (set by 20260616_production_fixes.sql) are:
--   pending_actions_kind_check   = ['record_payment','bank_import',
--                                   'parsed_task_from_group','case_to_approve',
--                                   'task_cleanup']
--   pending_actions_status_check = ['awaiting_confirm','awaiting_review',
--                                   'committed','superseded','cancelled']
-- Neither lists the new values. Without this migration the staging INSERT is
-- rejected with Postgres 23514 (check_violation), the best-effort insert swallows
-- it, NO slot row is ever written, and the whole feature is DEAD in prod (the
-- worker handler never finds a slot, the note re-parses cold, exactly the bug we
-- set out to fix). Verify constraints are live BEFORE shipping the code.
--
-- Mirrors the 20260620_tasks_status_expired enum-extension pattern: DROP IF EXISTS
-- + re-ADD the FULL existing value set PLUS the new value. 'committed' /
-- 'superseded' (used by the fill + escape paths) are already permitted, so only
-- 'awaiting_note' (status) and 'complete_task_awaiting_note' (kind) are new.

BEGIN;

ALTER TABLE public.pending_actions DROP CONSTRAINT IF EXISTS pending_actions_kind_check;
ALTER TABLE public.pending_actions ADD CONSTRAINT pending_actions_kind_check
  CHECK (kind = ANY (ARRAY[
    'record_payment'::text,
    'bank_import'::text,
    'parsed_task_from_group'::text,
    'case_to_approve'::text,
    'task_cleanup'::text,
    'complete_task_awaiting_note'::text
  ]));

ALTER TABLE public.pending_actions DROP CONSTRAINT IF EXISTS pending_actions_status_check;
ALTER TABLE public.pending_actions ADD CONSTRAINT pending_actions_status_check
  CHECK (status = ANY (ARRAY[
    'awaiting_confirm'::text,
    'awaiting_review'::text,
    'committed'::text,
    'superseded'::text,
    'cancelled'::text,
    'awaiting_note'::text
  ]));

COMMENT ON CONSTRAINT pending_actions_kind_check ON public.pending_actions IS
  'Allowed pending_action kinds. complete_task_awaiting_note (2026-06-20, KT #324) = a staged team-tier task completion holding the thread for the outcome note.';
COMMENT ON CONSTRAINT pending_actions_status_check ON public.pending_actions IS
  'Allowed pending_action statuses. awaiting_note (2026-06-20, KT #324) = a completion slot waiting for the team member''s outcome note; distinct from awaiting_confirm so the payment confirm gate never grabs it.';

COMMIT;
