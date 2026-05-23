-- ============================================================================
-- Nisria TechOps · Supabase / Postgres schema (the data spine)
-- Covers: brands, donor CRM, donations, campaigns, beneficiaries + public
-- profiles, inventory + Folklore, outreach pipeline, grant applications.
-- Run in Supabase SQL editor. Idempotent-ish (IF NOT EXISTS where possible).
-- ⚑ Review field choices with Nur before populating real beneficiary data.
-- ============================================================================

create extension if not exists "pgcrypto";   -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- updated_at trigger helper
-- ---------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- BRANDS  (Nisria, Maisha, AHADI)
-- ---------------------------------------------------------------------------
create table if not exists brands (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,            -- 'nisria' | 'maisha' | 'ahadi'
  name        text not null,
  created_at  timestamptz not null default now()
);
insert into brands (slug, name) values
  ('nisria','Nisria'), ('maisha','Maisha'), ('ahadi','AHADI')
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- DONORS  (CRM core)
-- ---------------------------------------------------------------------------
create table if not exists donors (
  id            uuid primary key default gen_random_uuid(),
  full_name     text not null,
  email         text,
  phone         text,
  type          text not null default 'individual'   -- individual|corporate|foundation|government
                  check (type in ('individual','corporate','foundation','government')),
  country       text,
  source        text,                                -- ad_grant|givebutter|event|referral|csr|influencer|manual
  status        text not null default 'prospect'     -- prospect|active|lapsed|major
                  check (status in ('prospect','active','lapsed','major')),
  first_gift_at timestamptz,
  last_gift_at  timestamptz,
  lifetime_value numeric(12,2) not null default 0,
  tags          text[] default '{}',
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_donors_email  on donors (lower(email));
create index if not exists idx_donors_status on donors (status);
create trigger trg_donors_updated before update on donors
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- CAMPAIGNS  (seasonal, CSR, cause-marketing, grant pushes)
-- ---------------------------------------------------------------------------
create table if not exists campaigns (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid references brands(id),
  name          text not null,
  type          text default 'seasonal'              -- seasonal|csr|cause|grant|always_on
                  check (type in ('seasonal','csr','cause','grant','always_on')),
  starts_on     date,
  ends_on       date,
  goal_amount   numeric(12,2),
  raised_amount numeric(12,2) not null default 0,
  givebutter_id text,
  status        text not null default 'planned'      -- planned|live|closed
                  check (status in ('planned','live','closed')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_campaigns_updated before update on campaigns
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- DONATIONS  (one row per gift; sync target for Givebutter)
-- ---------------------------------------------------------------------------
create table if not exists donations (
  id            uuid primary key default gen_random_uuid(),
  donor_id      uuid references donors(id) on delete set null,
  brand_id      uuid references brands(id),
  campaign_id   uuid references campaigns(id),
  amount        numeric(12,2) not null,
  currency      text not null default 'USD',
  channel       text default 'givebutter',           -- givebutter|stripe|mpesa|bank|cash|in_kind
  is_recurring  boolean not null default false,
  external_id   text,                                -- Givebutter txn id (dedupe key)
  status        text not null default 'succeeded'    -- succeeded|pending|refunded|failed
                  check (status in ('succeeded','pending','refunded','failed')),
  donated_at    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create unique index if not exists uq_donations_external on donations (external_id) where external_id is not null;
create index if not exists idx_donations_donor on donations (donor_id);
create index if not exists idx_donations_campaign on donations (campaign_id);

-- keep donor rollups fresh on insert
create or replace function bump_donor_rollup()
returns trigger language plpgsql as $$
begin
  update donors d set
    lifetime_value = coalesce(d.lifetime_value,0) + new.amount,
    last_gift_at   = greatest(coalesce(d.last_gift_at, new.donated_at), new.donated_at),
    first_gift_at  = least(coalesce(d.first_gift_at, new.donated_at), new.donated_at),
    status         = case when d.status = 'prospect' then 'active' else d.status end
  where d.id = new.donor_id;
  return new;
end $$;
create trigger trg_donation_rollup after insert on donations
  for each row when (new.donor_id is not null and new.status = 'succeeded')
  execute function bump_donor_rollup();

-- ---------------------------------------------------------------------------
-- BENEFICIARIES  (private record) + public donor-facing profile fields
-- ⚑ Consent is mandatory before any field is shown publicly.
-- ---------------------------------------------------------------------------
create table if not exists beneficiaries (
  id              uuid primary key default gen_random_uuid(),
  brand_id        uuid references brands(id),
  ref_code        text unique,                       -- internal code, not PII
  full_name       text not null,                     -- PRIVATE
  location        text,                              -- e.g. county/region in Kenya
  category        text,                              -- education|food|health|shelter|livelihood
  intake_date     date default current_date,
  story_private   text,                              -- full case notes (PRIVATE)
  needs           text,
  status          text not null default 'active'     -- active|graduated|paused|exited
                    check (status in ('active','graduated','paused','exited')),
  -- public/profile layer
  consent_public  boolean not null default false,    -- explicit consent to show donors
  public_name     text,                              -- display name or alias for donors
  public_story    text,                              -- sanitized story
  photo_url       text,                              -- only if consent_public
  goal_amount     numeric(12,2),
  funded_amount   numeric(12,2) not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_beneficiaries_status on beneficiaries (status);
create trigger trg_beneficiaries_updated before update on beneficiaries
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- INVENTORY  (+ The Folklore listing state)
-- ---------------------------------------------------------------------------
create table if not exists inventory (
  id              uuid primary key default gen_random_uuid(),
  sku             text unique,
  name            text not null,
  collection      text,
  category        text,
  quantity        integer not null default 0,
  unit_cost       numeric(12,2),
  unit_price      numeric(12,2),
  location        text,
  status          text not null default 'in_stock'   -- in_stock|low|out|archived
                    check (status in ('in_stock','low','out','archived')),
  folklore_listed boolean not null default false,
  folklore_url    text,
  photo_urls      text[] default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_inventory_updated before update on inventory
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- OUTREACH PIPELINE  (CSR / influencer / partnership prospects)
-- ---------------------------------------------------------------------------
create table if not exists outreach (
  id            uuid primary key default gen_random_uuid(),
  org_name      text not null,
  contact_name  text,
  contact_email text,
  channel       text,                                -- linkedin|email|ig_dm|event
  type          text default 'csr'                   -- csr|influencer|partner|grant
                  check (type in ('csr','influencer','partner','grant')),
  stage         text not null default 'identified'   -- identified|contacted|replied|meeting|won|lost
                  check (stage in ('identified','contacted','replied','meeting','won','lost')),
  owner         text,
  last_touch_at timestamptz,
  next_action   text,
  next_action_on date,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_outreach_stage on outreach (stage);
create trigger trg_outreach_updated before update on outreach
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- GRANT APPLICATIONS  (Harsh's engine + Claude + Granted MCP)
-- ---------------------------------------------------------------------------
create table if not exists grant_applications (
  id              uuid primary key default gen_random_uuid(),
  funder          text not null,
  program         text,
  amount_requested numeric(12,2),
  currency        text default 'USD',
  deadline        date,
  status          text not null default 'researching' -- researching|drafting|submitted|won|rejected
                    check (status in ('researching','drafting','submitted','won','rejected')),
  submitted_on    date,
  decision_on     date,
  amount_awarded  numeric(12,2),
  link            text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_grants_status on grant_applications (status);
create index if not exists idx_grants_deadline on grant_applications (deadline);
create trigger trg_grants_updated before update on grant_applications
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY  (enable on every table; policies added with auth design)
-- Default deny. Beneficiaries especially must NOT be world-readable.
-- A public read view exposes ONLY consented beneficiary profile fields.
-- ---------------------------------------------------------------------------
alter table donors             enable row level security;
alter table donations          enable row level security;
alter table campaigns          enable row level security;
alter table beneficiaries      enable row level security;
alter table inventory          enable row level security;
alter table outreach           enable row level security;
alter table grant_applications enable row level security;

-- Public, consent-gated beneficiary profiles for the donor-facing site.
create or replace view public_beneficiary_profiles as
select id, brand_id, coalesce(public_name, 'Anonymous') as name,
       category, public_story, photo_url, goal_amount, funded_amount,
       round(case when goal_amount > 0
                  then least(funded_amount / goal_amount, 1) * 100 else 0 end) as funded_pct
from beneficiaries
where consent_public = true and status = 'active';

-- ⚑ Next: define Supabase auth roles (admin = Nur/Taona, editor = Kenya team /
--    web manager, anon = public read of the view only) and write policies:
--    e.g. "admin all", "editor read/write except donors PII", "anon: none on
--    base tables; read on public_beneficiary_profiles via security_invoker view".
