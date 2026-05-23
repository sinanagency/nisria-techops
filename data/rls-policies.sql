-- ============================================================================
-- Nisria TechOps · Row Level Security policies
-- Run AFTER schema.sql. Default-deny is already on (RLS enabled in schema).
-- Roles: admin (Nur/Taona), editor (Kenya team / web manager), anon (public).
-- Beneficiary PII must NEVER be world-readable; public sees only the
-- consent-gated view. Donor PII is staff-only.
-- ⚑ Adjust role detection to your Supabase auth setup (JWT claim or a profiles
--    table mapping auth.uid() → role). Below assumes a claim `role` in the JWT
--    app_metadata, surfaced via auth.jwt().
-- ============================================================================

-- helper: current role from JWT (admin | editor | anon)
create or replace function app_role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true)::jsonb #>> '{app_metadata,role}', ''), 'anon');
$$;

-- ---- DONORS (staff only; PII) ---------------------------------------------
drop policy if exists donors_admin_all on donors;
create policy donors_admin_all on donors
  for all using (app_role() = 'admin') with check (app_role() = 'admin');
drop policy if exists donors_editor_read on donors;
create policy donors_editor_read on donors
  for select using (app_role() in ('admin','editor'));
-- (no anon access at all)

-- ---- DONATIONS (staff only) -----------------------------------------------
drop policy if exists donations_admin_all on donations;
create policy donations_admin_all on donations
  for all using (app_role() = 'admin') with check (app_role() = 'admin');
drop policy if exists donations_editor_read on donations;
create policy donations_editor_read on donations
  for select using (app_role() in ('admin','editor'));

-- ---- CAMPAIGNS (staff write; public reads safe fields via a view) ---------
drop policy if exists campaigns_staff_all on campaigns;
create policy campaigns_staff_all on campaigns
  for all using (app_role() in ('admin','editor')) with check (app_role() in ('admin','editor'));
-- public read of non-sensitive campaign fields for the meter widget:
drop policy if exists campaigns_anon_read on campaigns;
create policy campaigns_anon_read on campaigns
  for select using (status in ('live','closed'));   -- exposes name/goal/raised only; restrict columns via the widget query/grants

-- ---- BENEFICIARIES (PII; NEVER anon on base table) ------------------------
drop policy if exists beneficiaries_admin_all on beneficiaries;
create policy beneficiaries_admin_all on beneficiaries
  for all using (app_role() = 'admin') with check (app_role() = 'admin');
drop policy if exists beneficiaries_editor_rw on beneficiaries;
create policy beneficiaries_editor_rw on beneficiaries
  for all using (app_role() in ('admin','editor')) with check (app_role() in ('admin','editor'));
-- NO anon policy on this table. Public access ONLY through the view below.

-- public_beneficiary_profiles: make it a SECURITY DEFINER view so anon can read
-- the consent-gated rows WITHOUT any base-table policy. (Postgres 15+: views run
-- with definer rights unless security_invoker=on, which we deliberately leave off.)
-- Grant select on the view to the anon role:
grant select on public_beneficiary_profiles to anon;

-- ---- INVENTORY (staff write; public read of listed items, optional) -------
drop policy if exists inventory_staff_all on inventory;
create policy inventory_staff_all on inventory
  for all using (app_role() in ('admin','editor')) with check (app_role() in ('admin','editor'));

-- ---- OUTREACH + GRANTS (staff only) ---------------------------------------
drop policy if exists outreach_staff_all on outreach;
create policy outreach_staff_all on outreach
  for all using (app_role() in ('admin','editor')) with check (app_role() in ('admin','editor'));
drop policy if exists grants_staff_all on grant_applications;
create policy grants_staff_all on grant_applications
  for all using (app_role() in ('admin','editor')) with check (app_role() in ('admin','editor'));

-- ---- column-level safety for the public campaign read ---------------------
-- Belt & suspenders: revoke broad anon column access, grant only safe ones.
revoke all on campaigns from anon;
grant select (id, name, goal_amount, raised_amount, status) on campaigns to anon;

-- ⚑ TEST after applying:
--   - anon (no JWT): can read public_beneficiary_profiles + safe campaign cols; NOTHING on donors/beneficiaries base/donations.
--   - editor JWT: read/write programs data, NO donor PII select beyond policy.
--   - admin JWT: full.
