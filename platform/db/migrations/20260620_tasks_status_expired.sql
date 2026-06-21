-- Add 'expired' to tasks_status_check (integration-verification, 2026-06-20).
--
-- INCIDENT: the date-passed expiry cron (app/api/cron/expire-tasks/route.ts, KT
-- #316) does `UPDATE tasks SET status = 'expired'`, but the live CHECK constraint
-- tasks_status_check (last set by 20260607_task_v1_additions.sql) only permitted
-- ['todo','in_progress','in_review','done','blocked','abandoned']. So EVERY expiry
-- write was rejected with Postgres 23514 (check_violation), the cron swallowed the
-- error (fire-and-forget UPDATE, no error check), and:
--   - 0 of 147 prod task rows ever reached status='expired'
--   - 10+ overdue tasks (due 2026-06-16/17) stayed on the active board for days
--   - list_tasks(status='expired') / "what lapsed on <date>" returned nothing
--   - the agent_memory "lapsed" record WAS still written, so memory and the task
--     row disagreed (source-of-truth split, Law 1).
--
-- Verified live before this migration:
--   PATCH /tasks {status:"expired"} -> 400 {"code":"23514", message:
--   "new row for relation \"tasks\" violates check constraint tasks_status_check"}
--
-- The companion fixes (complete_task excludes expired, list_tasks status='expired'
-- filter, reminders excludes expired) were all inert because no row could ever BE
-- expired. This migration makes the status reachable so those walls become live.
--
-- Mirrors the 20260607 enum-extension pattern (DROP IF EXISTS + re-ADD), keeping
-- the full existing value set and only ADDING 'expired'.

BEGIN;

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_status_check
  CHECK (status = ANY (ARRAY[
    'todo'::text,
    'in_progress'::text,
    'in_review'::text,
    'done'::text,
    'blocked'::text,
    'abandoned'::text,
    'expired'::text
  ]));

COMMENT ON CONSTRAINT tasks_status_check ON public.tasks IS
  'Allowed task lifecycle states. expired (2026-06-20) = date passed, auto-filed off the active board by the expire-tasks cron, NOT done. See KT #316.';

COMMIT;
