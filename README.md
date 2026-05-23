# Nisria · Tech Operations System

Digital operations backbone for **Nisria** and its sister brands **Maisha** and **AHADI** — a nonprofit run by **Nur M'nasria** with a Kenya-based delivery team. This repo turns the 26-task / 5-pillar operating plan into wired systems: data models, content engines, fundraising playbooks, and automations that offload Nur's manual workload.

> Source plan: `Nur + Nisria TechOps System.docx` (2026). Headline: **26 tasks · 5 pillars · 6 Nur-only · 20 delegatable · 16 automatable.**

---

## The three brands

| Brand | What it is | Primary channels |
|---|---|---|
| **Nisria** | Parent nonprofit / org brand | IG, FB, LinkedIn, YouTube, TikTok, Pinterest, (Reddit later) |
| **Maisha** | Sister brand | IG, FB, LinkedIn, TikTok, Pinterest |
| **AHADI** | Sister brand | IG, FB, Pinterest, TikTok |

---

## Tool stack (onboarded 2026-05-23)

| Tool | Pillar | Role | Account |
|---|---|---|---|
| **Supabase** | Data & Systems | Donor CRM, beneficiary profiles, inventory DB (the backbone) | `info@sinan.agency` |
| **Vercel** | Data & Systems | Hosting for donor dashboard / beneficiary back-end | `info@sinan.agency` |
| **Railway** | Data & Systems | Hosting for services / workers / automations | `sasa@nisria.co` |
| **Givebutter** | Fundraising | Donations, recurring giving, newsletter, campaigns, gamified giving | `info@sinan.agency` (display: Taona) |
| **Google Ad Grants** | Fundraising | $10k/mo free search ads → traffic + conversions | `tech@nisria.co` |
| **Meta Business** | Content | FB/IG pages + ads for all 3 brands | `info@sinan.agency` |
| **The Folklore** | Data & Systems | Inventory / product listings (seller account active) | Nisria seller |
| **TechSoup (US)** | (enabler) | Discounted/donated software | `info@sinan.agency` |
| **Goodstack** | (enabler) | Nonprofit discounts / verification | `info@sinan.agency` |
| **Anthropic (Claude)** | Automation | Drafting, content, agents | pending Harsh |

Credentials live in macOS Keychain via `~/.claude/ops/` (labels `bu-sinan-info-pass`, `bu-nisria-tech-pass`). Never commit secrets.

---

## The 5 pillars

1. **Content & Publishing (8)** — 2 websites (Squarespace), weekly blogs (Claude→Squarespace), weekly Nisria newsletter (Givebutter/Substack), daily social across 3 brands (Canva + Claude). → `content/`
2. **Fundraising & Donor Relations (10)** — Google Ad Grants, grant applications (Harsh's engine), weekly/CSR/influencer outreach, cause marketing, seasonal campaigns, donor DB, bulk email, gamified giving. → `fundraising/`
3. **Data & Systems (5, Urgent)** — organize all data (Drive), donor-facing beneficiary profiles, inventory system, upload inventory to The Folklore, shared yearly calendar. → `data/`
4. **Internal Communications (2)** — staff↔Nur (daily async), staff↔staff. → `comms/`
5. **Automation & Nur's Time (1, Urgent)** — automate as much of Nur's workload as possible. → `automation/`

---

## Phased roadmap

**Phase 0 — Foundations (this repo, now)**
Stand up the data model, folder taxonomy, content engine, fundraising playbooks, automation map, comms SOPs. No external publishing yet; everything is scaffolding ready to populate.

**Phase 1 — Data spine + donor capture (week 1–2)**
Deploy Supabase schema. Stand up beneficiary intake + donor capture. Organize Google Drive to taxonomy. Connect Givebutter → Supabase sync. Shared yearly calendar live.

**Phase 2 — Content + fundraising engines (week 2–4)**
Google Ad Grants account approved + structured. Editorial calendar in motion (Claude-drafted, human-reviewed). Newsletter live. First seasonal campaign scaffolded in Givebutter. Donor segmentation + bulk email.

**Phase 3 — Automation + scale (week 4+)**
Wire the 16 automatable tasks (n8n/Claude): blog/social drafting, donation receipts, donor sync, weekly Ad Grants report, inventory→Folklore, intake→profile. Nur's weekly manual load measured and cut.

---

## Owner / automation split (from source plan)

- **Nur-only (6):** strategy calls — cause marketing direction, seasonal campaign leadership, gamification strategy, yearly calendar ownership, comms with staff, deciding what to automate.
- **Delegatable (20):** execution — websites, blogs, social, outreach, donor DB, bulk email, inventory.
- **Automatable (16):** see `automation/automation-map.md`.

---

## Status board

**Onboarding (done):** tech@nisria.co activated · Meta/Facebook ×3 accepted · Railway logged in · TechSoup US · Google Ads (tech@nisria.co added)
**Onboarding (open):** Supabase / Vercel / Goodstack / TechSoup / Givebutter invite-accepts in `info@sinan.agency` (one-click); Anthropic (Harsh to add); TechSoup Kenya (Nur blocked)
**Phase 0 build:** in progress — see each pillar folder.

---

## Repo map

```
nisria-techops/
├── README.md                       ← you are here (master plan)
├── data/
│   ├── schema.sql                  ← Supabase: donors, donations, campaigns, beneficiaries, inventory, outreach, grants
│   ├── drive-taxonomy.md           ← Google Drive folder structure + naming + access (Urgent)
│   ├── beneficiary-intake.md       ← intake form + consent model
│   └── folklore-upload-spec.md     ← The Folklore listing format/process
├── content/
│   ├── editorial-system.md         ← social cadence matrix, content pillars, blog/newsletter pipeline
│   ├── brand-voice.md              ← voice/tone per brand (prelim)
│   └── social-calendar-template.csv← weekly planning grid
├── fundraising/
│   ├── google-ad-grants-playbook.md
│   ├── givebutter-setup.md
│   ├── donor-crm-and-pipeline.md
│   ├── grant-applications-workflow.md
│   └── outreach-sequences.md
├── automation/
│   └── automation-map.md           ← 16 automatable tasks → concrete automations, prioritized
└── comms/
    ├── internal-comms-playbook.md
    └── yearly-calendar-spec.md
```

*Prepared for Nur M'nasria · Nisria Tech Operations · assumptions marked "⚑ confirm with Nur" inline.*
