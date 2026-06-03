-- Recurring tasks: a simple recurrence rule. NULL = one-off.
-- Allowed: daily | weekdays | weekly | biweekly | monthly.
-- Model: on completion (or via the reminders cron) Sasa spawns the NEXT instance.
alter table public.tasks add column if not exists recurrence text;
comment on column public.tasks.recurrence is 'null=one-off; daily|weekdays|weekly|biweekly|monthly. Next instance spawns on completion.';
