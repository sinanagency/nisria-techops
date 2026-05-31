-- Calendar feature (2026-05-31)
-- Native manual events live here so the unified calendar works STANDALONE,
-- with no hard dependency on the Google Calendar share being done. Ops items
-- (tasks/payments/grants/content) are NOT copied here — the aggregator
-- (lib/calendar.ts) reads them in place. This table is only for events that
-- have no other home: meetings, team travel, site visits, holidays Sasa adds.
-- When the Google link is live (lib/gcal.ts), each row mirrors to GCal and
-- carries the gcal_event_id back so edits/deletes stay in sync both ways.

create table if not exists public.calendar_events (
  "id"           uuid default gen_random_uuid() not null,
  "title"        text not null,
  "starts_on"    date not null,
  "ends_on"      date,                          -- null = single day
  "start_time"   time,                          -- null = all-day event
  "end_time"     time,
  "all_day"      boolean default true not null,
  "location"     text,
  "notes"        text,
  "kind"         text default 'event' not null, -- event | meeting | travel | visit | reminder
  "brand"        text default 'nisria',         -- nisria | maisha | ahadi
  "attendee_ids" uuid[] default '{}'::uuid[],   -- team_members.id
  "gcal_event_id" text,                         -- mirror id once synced to Google
  "source"       text default 'manual' not null,-- manual | ai | gcal
  "created_by"   text default 'Nur',
  "created_at"   timestamp with time zone default now() not null,
  "updated_at"   timestamp with time zone default now() not null,
  constraint "calendar_events_pkey" primary key (id),
  constraint "calendar_events_kind_check" check (kind = any (array['event','meeting','travel','visit','reminder'])),
  constraint "calendar_events_brand_check" check (brand = any (array['nisria','maisha','ahadi']))
);

create index if not exists calendar_events_starts_idx on public.calendar_events using btree (starts_on);
create index if not exists calendar_events_gcal_idx on public.calendar_events using btree (gcal_event_id);

-- RLS: same posture as the rest of the app — the service-role admin client
-- bypasses RLS, and the whole app is auth-gated by middleware, so we enable
-- RLS with no public policy (no anon access), matching db/policies.sql intent.
alter table public.calendar_events enable row level security;
