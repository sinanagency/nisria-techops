# Team Roles & Onboarding

Who owns what, and how a new team member gets productive fast. Keeps the system running without everything routing through Nur. Lives in Drive `09_OPERATIONS/Team/`.

## Roles (RACI-lite)

| Role | Owns | Tools | Access |
|---|---|---|---|
| **Nur (Founder)** | Strategy, brand/voice sign-off, cause-marketing + seasonal direction, grant approvals, calendar ownership, "what to automate" decisions | All (light touch) | Admin everywhere |
| **Taona / Tech (Sinan)** | Systems, Supabase, automations (n8n), widgets/Vercel, integrations, this repo | Supabase, Vercel, Railway, n8n, GitHub | Admin |
| **Web Manager** | Squarespace sites, beneficiary profiles publishing, embeds | Squarespace, Supabase (editor), widgets | Editor (no donor PII) |
| **Kenya Team** | Beneficiary intake, case files, inventory, field content/photos (with consent) | Google Form, Drive (assigned), WhatsApp | Editor on programs/inventory; restricted on PII |
| **VA / Delegate** | Social, blogs, newsletter, outreach, donor-DB upkeep, Ad Grants weekly check | Canva, Claude, Meta Business Suite, Givebutter, Google Ads | Contributor/Commenter |

## Decision rights

- **Public/financial/beneficiary-facing** → needs Nur (or her delegate per policy) sign-off.
- **Routine execution** (post, draft, outreach touch, listing) → delegate decides, logs it.
- **System changes** (schema, automations, access) → Tech, with Nur informed.

## New-member onboarding checklist

- [ ] Add to the right Google Workspace / Shared Drive groups (role-based access, see `data/drive-taxonomy.md`).
- [ ] Add to relevant WhatsApp groups; share the comms playbook (`comms/internal-comms-playbook.md`).
- [ ] Walk the SOPs they'll run (`operations/sops.md`).
- [ ] Grant tool access at the right level (table above) — least privilege; no donor PII unless required.
- [ ] Share brand voice (`content/brand-voice.md`) + this repo's README.
- [ ] First week: shadow one full weekly content cycle + one donor-data hygiene pass.

## Offboarding

- [ ] Revoke tool + Drive access. [ ] Rotate any shared credentials. [ ] Reassign owned SOPs. [ ] Confirm no data lives only on their personal devices/accounts.

## Safeguarding note

Anyone touching beneficiary data reads and follows the consent/safeguarding rules in `data/beneficiary-intake.md`. PII access is least-privilege and logged.
