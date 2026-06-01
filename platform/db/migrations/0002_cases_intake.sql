-- Cases / intake pipeline. A "case" is a potential beneficiary not yet accepted.
-- Modeled as a beneficiary in a pre-acceptance stage so the entire hardened PII
-- apparatus (RLS, private photos, consent gate, 360 profile, brain grounding) is
-- reused. intake_stage NULL = an accepted beneficiary (every existing row).
-- A case carries status='inactive' so all "active beneficiary" counts auto-exclude
-- it; approval flips intake_stage->NULL and status->'active'.
ALTER TABLE public.beneficiaries
  ADD COLUMN IF NOT EXISTS intake_stage text,
  ADD COLUMN IF NOT EXISTS referred_by  text,
  ADD COLUMN IF NOT EXISTS case_channel text,
  ADD COLUMN IF NOT EXISTS triage_notes text;

ALTER TABLE public.beneficiaries
  DROP CONSTRAINT IF EXISTS beneficiaries_intake_stage_check;
ALTER TABLE public.beneficiaries
  ADD CONSTRAINT beneficiaries_intake_stage_check
  CHECK (intake_stage IS NULL OR intake_stage = ANY (ARRAY['prospect','under_review','pending_funds','declined']));

CREATE INDEX IF NOT EXISTS idx_beneficiaries_intake_stage ON public.beneficiaries (intake_stage);
