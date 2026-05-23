# RUNBOOK — Phase 1 Execution (do-this-next, in order)

Turns the Phase 0 scaffolding into live systems. Each step names the owner, the file, and "done when". Work top-down; many are parallelizable across Nur / Kenya team / web manager / VA.

## 0. Finish onboarding (close the loop)

- [ ] Accept the 5 invites in `info@sinan.agency`: Supabase, Vercel, Goodstack, TechSoup, Givebutter (rename → Taona). *Note: automated pass hit per-platform blocks (Supabase Google-auth, Vercel expired link, Goodstack disabled button) — finish these manually.* **Done when:** all 5 show active.
- [ ] Anthropic: Harsh adds the seat. **Done when:** Console access confirmed.
- [ ] Confirm `tech@nisria.co` 2FA with an org-owned method (not just Nur's +1 727). **Done when:** recovery set.

## 1. Data spine (Urgent)

- [ ] Run `data/schema.sql` in Supabase SQL editor. **Done when:** tables + `public_beneficiary_profiles` view exist.
- [ ] Define Supabase auth roles + RLS policies (admin / editor / anon-read-view). **Done when:** anon can read only the public view.
- [ ] Create the `Nisria Org` Shared Drive per `data/drive-taxonomy.md`; set role permissions. **Done when:** tree + access live.
- [ ] Build the beneficiary intake Google Form per `data/beneficiary-intake.md`. **Done when:** a test submission creates a record.
- [ ] Migrate existing files (WhatsApp/personal) into the taxonomy. **Done when:** nothing important lives only in chat.

## 2. Fundraising engine

- [ ] Google for Nonprofits validation via TechSoup/Goodstack → enroll Ad Grants. **Done when:** Ad Grants account active.
- [ ] GA4 + conversions installed and firing. **Done when:** a test donation registers a conversion.
- [ ] Build the 5 Ad Grants campaigns from `fundraising/ad-grants-starter-campaigns.md`. **Done when:** live, CTR monitored.
- [ ] Givebutter: org profile, default donation form (recurring prompt), thank-you URL = conversion, per `fundraising/givebutter-setup.md`. **Done when:** a $1 test gift completes end-to-end.
- [ ] Load email templates (`fundraising/email-templates.md`) into Givebutter; set up welcome series. **Done when:** test donor gets receipt + welcome.
- [ ] Seed `grant_applications` with current prospects (Harsh's engine / Granted MCP). **Done when:** pipeline has deadlines.

## 3. Content engine

- [ ] Confirm brand missions/voice with Nur → finalize `content/brand-voice.md`. **Done when:** signed off.
- [ ] Build Canva template set per brand. **Done when:** 6 templates/brand exist.
- [ ] Stand up the editorial calendar (from `content/social-calendar-template.csv`) in Drive `07_CONTENT/`. **Done when:** week 1 planned.
- [ ] First weekly cycle: 2 blogs (Claude→review→Squarespace), week of social, newsletter. **Done when:** all published/sent.

## 4. Internal comms + calendar

- [ ] Set up WhatsApp groups + daily standup format (`comms/internal-comms-playbook.md`). **Done when:** team posting daily.
- [ ] Create the 4 shared Google Calendars + load annual anchors (`comms/yearly-calendar-spec.md`). **Done when:** campaigns/deadlines visible.

## 5. Automation (after data spine + Givebutter live)

- [ ] Stand up **n8n on Railway** + connect credentials. **Done when:** a hello-world workflow runs.
- [ ] Ship P0: A1 Givebutter→Supabase sync, A2 receipt+welcome, A3 weekly report, A4 intake→record (`automation/automation-map.md`). **Done when:** a real donation flows end-to-end automatically.
- [ ] Ship P1 (content drafting), then P2 (inventory/widget).

## 6. Inventory + store

- [ ] Populate `inventory` (Supabase) + stock sheet in Drive. **Done when:** current stock recorded.
- [ ] First Folklore listing batch per `data/folklore-upload-spec.md`. **Done when:** products live, `folklore_url` written back.

---

## Owners cheat-sheet

- **Nur:** brand/voice sign-off, cause-marketing + seasonal direction, grant approvals, calendar ownership, decide what to automate.
- **Web manager:** Supabase deploy + RLS, Squarespace, beneficiary profiles, widgets/Vercel, n8n.
- **Kenya team:** intake, case files, inventory, field content/photos (with consent).
- **VA / Delegate:** social, blogs, newsletter, outreach, donor DB upkeep, Ad Grants weekly check.

## Definition of "Phase 1 done"

A real donation: arrives in Givebutter → syncs to Supabase → fires a receipt + welcome → updates a campaign meter → shows in Nur's weekly report — with zero manual steps. And a beneficiary intake form → private record + Drive folder, surfacing publicly only on consent.
