-- Time-of-day on task reminders + recurring calendar events.
alter table public.tasks add column if not exists due_time text;            -- HH:MM, optional time-of-day for the reminder
comment on column public.tasks.due_time is 'HH:MM time-of-day for a reminder; surfaced in the ping. (Minute-precise firing = a future sub-hourly cron.)';
alter table public.calendar_events add column if not exists recurrence text; -- daily|weekdays|weekly|biweekly|monthly; null=one-off
comment on column public.calendar_events.recurrence is 'null=one-off; daily|weekdays|weekly|biweekly|monthly. The daily tick materializes the next instance once the current one passes.';
