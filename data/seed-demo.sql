-- ============================================================================
-- Nisria TechOps · Demo seed data (SAFE / fictional)
-- Run AFTER schema.sql to make the widgets show something on first deploy.
-- All beneficiaries here are FICTIONAL with consent_public=true for demo only.
-- ⚑ DELETE before real data goes in:  truncate ... ; or delete where ref_code like 'DEMO-%';
-- ============================================================================

-- a live campaign for the meter widget
insert into campaigns (brand_id, name, type, starts_on, ends_on, goal_amount, raised_amount, status)
select id, 'Back to School 2026', 'seasonal', current_date, current_date + 60, 5000, 1850, 'live'
from brands where slug = 'nisria'
on conflict do nothing;

-- a couple of fictional, consented public profiles
insert into beneficiaries (brand_id, ref_code, full_name, location, category, status,
                           consent_public, public_name, public_story, photo_url, goal_amount, funded_amount)
select b.id, 'DEMO-001', 'Demo Child One', 'Nairobi County', 'education', 'active',
       true, 'Amani', 'Amani is back in class after a year out. School fees and a uniform were all it took. (Demo profile.)',
       null, 300, 210
from brands b where b.slug = 'nisria'
on conflict (ref_code) do nothing;

insert into beneficiaries (brand_id, ref_code, full_name, location, category, status,
                           consent_public, public_name, public_story, photo_url, goal_amount, funded_amount)
select b.id, 'DEMO-002', 'Demo Child Two', 'Kisumu County', 'food', 'active',
       true, 'Baraka', 'A month of school meals keeps Baraka learning instead of hungry. (Demo profile.)',
       null, 150, 60
from brands b where b.slug = 'maisha'
on conflict (ref_code) do nothing;

-- a demo donor + donation (exercises the rollup trigger)
with d as (
  insert into donors (full_name, email, source, type)
  values ('Demo Donor', 'demo.donor@example.com', 'givebutter', 'individual')
  on conflict do nothing
  returning id
)
insert into donations (donor_id, brand_id, amount, channel, status, external_id)
select d.id, b.id, 50, 'givebutter', 'succeeded', 'DEMO-TXN-001'
from d, brands b where b.slug = 'nisria'
on conflict (external_id) do nothing;
