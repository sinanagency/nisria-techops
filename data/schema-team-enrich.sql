-- ============================================================================
-- Nisria TechOps · Team enrichment migration (PHASE 1 — Team module)
-- Turns team_members from a thin name/role/email/phone strip into an HR-lite
-- record: member_type, responsibilities, pay, engagement/tenure, status,
-- location, notes, photo, tags. Adds a team_payments ledger for pay history.
-- The eventual entry channel is the WhatsApp bot; this schema is the target it
-- will populate. For now, manual entry + the same server actions feed it.
--
-- Run AFTER schema.sql + schema-v2.sql (team_members, tasks) + schema-spine.sql
-- (assets). Idempotent: add-column-if-not-exists, guarded constraints, widened
-- status check. RLS stays consistent with the rest: tables have RLS enabled and
-- the admin app reaches them ONLY via the service-role key server-side. No anon
-- policy = no anon access to team PII.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- New structured columns on team_members (all behind RLS, staff-only)
-- ---------------------------------------------------------------------------
alter table team_members add column if not exists member_type      text;     -- staff|tailor|volunteer|contractor
alter table team_members add column if not exists responsibilities text;     -- what they own / do
alter table team_members add column if not exists pay_amount        numeric;  -- amount per pay_type
alter table team_members add column if not exists pay_type          text;     -- monthly|piece|stipend|hourly|none
alter table team_members add column if not exists pay_currency      text default 'USD';
alter table team_members add column if not exists engagement_start  date;     -- start of engagement (drives tenure)
alter table team_members add column if not exists engagement_type   text;     -- free text: full-time, part-time, seasonal, etc.
alter table team_members add column if not exists location          text;
alter table team_members add column if not exists notes             text;
alter table team_members add column if not exists photo_asset_id    uuid;     -- FK to assets (private bucket); signed-URL only
alter table team_members add column if not exists tags              text[] default '{}';

-- member_type is enum-ish text. Constrain to the known set (allow null = untyped).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'team_members_member_type_check') then
    alter table team_members
      add constraint team_members_member_type_check
      check (member_type is null or member_type in ('staff','tailor','volunteer','contractor'));
  end if;
end $$;

-- pay_type enum-ish. Allow null = not yet recorded.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'team_members_pay_type_check') then
    alter table team_members
      add constraint team_members_pay_type_check
      check (pay_type is null or pay_type in ('monthly','piece','stipend','hourly','none'));
  end if;
end $$;

-- photo_asset_id -> assets(id). Nullable; on asset delete, just null it.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'team_members_photo_asset_fk') then
    alter table team_members
      add constraint team_members_photo_asset_fk
      foreign key (photo_asset_id) references assets(id) on delete set null;
  end if;
end $$;

-- Widen the status check to the lifecycle the spec/UI use. The old constraint
-- was ('active','inactive'); the module uses ('active','paused','exited') and
-- the add flow may stage 'invited' before activation. Keep 'inactive' for any
-- legacy rows. Safe: team_members currently has 0 rows.
alter table team_members drop constraint if exists team_members_status_check;
alter table team_members
  add constraint team_members_status_check
  check (status in ('active','paused','exited','invited','inactive'));

create index if not exists idx_team_members_type   on team_members (member_type);
create index if not exists idx_team_members_status on team_members (status);

-- ---------------------------------------------------------------------------
-- tasks already has assignee_id uuid -> team_members(id) (from schema-v2). No
-- new member-link column needed. Confirm at apply time via information_schema.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- TEAM_PAYMENTS — per-member pay ledger (salary runs, piece-rate payouts,
-- stipends). Kept SEPARATE from the org-wide `payments` table (which is a free
-- -text-payee expense ledger of 67 rows) so a member's pay history is a clean,
-- queryable timeline keyed by team_member_id.
-- ---------------------------------------------------------------------------
create table if not exists team_payments (
  id              uuid primary key default gen_random_uuid(),
  team_member_id  uuid not null references team_members(id) on delete cascade,
  amount          numeric not null,
  currency        text not null default 'USD',
  pay_period      text,                         -- free text: "May 2026", "Week 21", "Order #142"
  paid_at         timestamptz,                  -- null = scheduled/unpaid
  status          text not null default 'paid'
                    check (status in ('paid','pending','scheduled','failed')),
  note            text,
  created_by      text default 'Nur',
  created_at      timestamptz not null default now()
);
create index if not exists idx_team_payments_member on team_payments (team_member_id);
create index if not exists idx_team_payments_paid_at on team_payments (paid_at);

-- RLS consistent with the rest: enabled, admin app uses service key server-side.
-- No anon policy => no anon access to team pay PII.
alter table team_payments enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'team_payments' and policyname = 'team_payments_admin_all') then
    create policy team_payments_admin_all on team_payments
      for all using (app_role() = 'admin') with check (app_role() = 'admin');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'team_payments' and policyname = 'team_payments_editor_read') then
    create policy team_payments_editor_read on team_payments
      for select using (app_role() in ('admin','editor'));
  end if;
end $$;

-- ⚑ VERIFY after applying:
--   - information_schema.columns shows the new team_members columns + team_payments
--   - tasks.assignee_id exists (member link)
--   - team_members_status_check / member_type_check / pay_type_check present
--   - team_payments has RLS enabled, no anon policy
