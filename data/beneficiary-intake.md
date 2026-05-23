# Beneficiary Intake & Consent Model (Pillar 3)

How a new beneficiary enters the system, gets a private case record, and — only with explicit consent — a donor-facing profile. Fields map 1:1 to `beneficiaries` in `data/schema.sql`.

## Flow

```
Kenya team meets beneficiary
   → fills Intake Form (Google Form or Tally → Supabase)
   → creates ref_code (NIS-2026-NNN), case folder in Drive 01_BENEFICIARIES/Case Files/<ref_code>
   → consent conversation + signed consent form (stored, linked)
   → Supabase row created (consent_public=false by default)
   → IF consent_public: web manager fills public_name / public_story / photo
   → appears in public_beneficiary_profiles view → donor-facing site
```

## Intake form fields

**Private (always collected):**
- Full name, date of birth / age, location (county/region)
- Household / guardian context
- Category: education | food | health | shelter | livelihood
- Needs description (case notes)
- Referred by / how reached
- Intake date, assessed by (staff name)

**Consent block (the gate):**
- "Do you consent to Nisria sharing your story with donors?" (yes/no)
- "Do you consent to your photo being used?" (yes/no)
- "Preferred display name or alias for public profile" (so real name need not be shown)
- Signature + date (guardian signature if a minor) → upload to `_Consent Forms/`

**Public layer (only if consent = yes):**
- public_name (alias OK), public_story (sanitized — no exact address, no surname unless cleared)
- photo_url (consented photo only)
- goal_amount (if a specific funding goal)

## Safeguarding rules (non-negotiable)

- Default `consent_public = false`. Nothing is public until the box is ticked **and** a signed form exists.
- Minors: guardian consent required; prefer alias + no identifying detail.
- Public story must be sanitized: no exact location beyond region, no school name + photo together, no financial PII.
- Right to withdraw: setting `consent_public=false` instantly removes them from the public view.

## Tooling

- **Form:** Google Form (free, in the Workspace) or Tally → webhook → Supabase insert. ⚑ Google Form is simplest for the Kenya team on mobile.
- **Storage:** consent PDFs in Drive `01_BENEFICIARIES/_Consent Forms/`, linked from the Supabase row.
- **Automation candidate:** form submission → create Supabase row + Drive folder (see `automation/automation-map.md`).
