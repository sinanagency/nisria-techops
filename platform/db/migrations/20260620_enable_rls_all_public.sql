-- Enable RLS on every public table (Supabase Security Advisor: "RLS Disabled in Public").
-- 2026-06-20.
--
-- SAFE FOR THE APP: the Nisria command-center connects ONLY via the server-side
-- service_role key (lib/supabase-admin.ts). service_role has BYPASSRLS, so turning
-- RLS on (with no policies = deny-all to anon/authenticated) does NOT affect the
-- bot or the dashboard. It CLOSES the hole where anyone holding the publishable
-- anon key could read/write every row (emails, contacts, whatsapp_messages,
-- invoices, donations, beneficiaries = PII).
--
-- Reversible per table: ALTER TABLE public.<t> DISABLE ROW LEVEL SECURITY;
-- Idempotent: only touches tables that still have RLS off.
--
-- NOTE: SECURITY DEFINER views (e.g. public_beneficiary_profiles) are NOT changed
-- here and keep working (they bypass RLS by design). If a SEPARATE public site reads
-- a BASE TABLE via the anon key, that table will need an explicit read policy — add
-- it before/after as a carve-out.

DO $$
DECLARE r RECORD; n INT := 0;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND rowsecurity = false
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', r.tablename);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'RLS enabled on % public tables.', n;
END $$;
