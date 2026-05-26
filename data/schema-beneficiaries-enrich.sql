-- ============================================================================
-- Nisria TechOps · Beneficiaries enrichment migration
-- Adds structured program/profile fields to the beneficiaries table and links
-- a photo to the Asset Library. RLS stays intact: PII is NEVER world-readable.
-- The only public path remains the consent-gated public_beneficiary_profiles
-- view, which exposes ONLY non-identifying, consented fields.
-- Run AFTER schema.sql + schema-spine.sql (assets table) + rls-policies.sql.
-- Idempotent: add-column-if-not-exists, recreate view, widen status check.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- New structured columns on beneficiaries (all behind RLS, staff-only)
-- ---------------------------------------------------------------------------
alter table beneficiaries add column if not exists program          text;   -- safe_house|education|rescue|nutrition|other
alter table beneficiaries add column if not exists date_of_birth     date;   -- PRIVATE (used to derive age)
alter table beneficiaries add column if not exists gender            text;   -- PRIVATE
alter table beneficiaries add column if not exists region            text;   -- broader area than free-text `location`; PRIVATE
alter table beneficiaries add column if not exists guardian_status   text;   -- e.g. orphan|single_parent|both_parents|extended_family; PRIVATE
alter table beneficiaries add column if not exists photo_asset_id    uuid;   -- FK to assets (private bucket); signed-URL only
alter table beneficiaries add column if not exists tags              text[] default '{}';
alter table beneficiaries add column if not exists consent_date      timestamptz; -- when consent_public was granted

-- program is enum-ish text. Constrain to the known set (allow null for un-triaged).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'beneficiaries_program_check'
  ) then
    alter table beneficiaries
      add constraint beneficiaries_program_check
      check (program is null or program in ('safe_house','education','rescue','nutrition','other'));
  end if;
end $$;

-- photo_asset_id -> assets(id). Keep it nullable; on asset delete, just null it.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'beneficiaries_photo_asset_fk'
  ) then
    alter table beneficiaries
      add constraint beneficiaries_photo_asset_fk
      foreign key (photo_asset_id) references assets(id) on delete set null;
  end if;
end $$;

-- Widen the status check to include the lifecycle states the UI uses
-- (transitioned, inactive) while keeping the originals so the existing view's
-- status='active' gate is unaffected.
alter table beneficiaries drop constraint if exists beneficiaries_status_check;
alter table beneficiaries
  add constraint beneficiaries_status_check
  check (status in ('active','graduated','transitioned','paused','exited','inactive'));

create index if not exists idx_beneficiaries_program on beneficiaries (program);

-- Auto-stamp consent_date when consent flips true (keeps audit honest even when
-- the UI forgets to set it). Clears it when consent is withdrawn.
create or replace function bene_consent_stamp()
returns trigger language plpgsql as $$
begin
  if new.consent_public is true and (old.consent_public is distinct from true) then
    new.consent_date := coalesce(new.consent_date, now());
  elsif new.consent_public is false then
    new.consent_date := null;
  end if;
  return new;
end $$;
drop trigger if exists trg_bene_consent on beneficiaries;
create trigger trg_bene_consent before update on beneficiaries
  for each row execute function bene_consent_stamp();

-- ---------------------------------------------------------------------------
-- Public, consent-gated profile view. SECURITY DEFINER (definer rights) so anon
-- can read consented rows WITHOUT any base-table policy. Exposes ONLY
-- non-identifying fields: display alias, program, sanitized story, public photo,
-- funding progress. NEVER full_name, location, region, guardian, dob, gender.
-- DROP first: CREATE OR REPLACE cannot reorder/insert columns into an existing
-- view, and we are adding `program` before `category`.
-- ---------------------------------------------------------------------------
drop view if exists public_beneficiary_profiles;
create view public_beneficiary_profiles as
select id,
       brand_id,
       coalesce(public_name, 'Anonymous') as name,   -- alias only, never full_name
       program,
       category,
       public_story,                                  -- sanitized story, staff-curated
       photo_url,                                     -- public photo only (set on consent)
       goal_amount,
       funded_amount,
       round(case when goal_amount > 0
                  then least(funded_amount / goal_amount, 1) * 100 else 0 end) as funded_pct
from beneficiaries
where consent_public = true and status = 'active';

-- Least privilege: dropping the view reset its ACL, and the public schema's
-- default grants hand PUBLIC every privilege. Revoke everything, then grant
-- ONLY select to anon + authenticated. (Writes through the view would hit the
-- base table's RLS, which has no anon policy, but we lock the door anyway.)
revoke all on public_beneficiary_profiles from public;
revoke all on public_beneficiary_profiles from anon;
revoke all on public_beneficiary_profiles from authenticated;
grant select on public_beneficiary_profiles to anon;
grant select on public_beneficiary_profiles to authenticated;

-- ⚑ VERIFY after applying:
--   - information_schema.columns shows the new beneficiaries columns
--   - anon can read public_beneficiary_profiles; NOTHING on beneficiaries base
--   - no PII column (full_name/location/region/guardian/dob/gender) in the view
