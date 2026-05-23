# Google Drive Taxonomy — "Organise All Data" (Pillar 3, Urgent)

Single source of truth for beneficiaries, reports, finances, photos, documents. Shared Drive (not a personal My Drive) so ownership survives staff changes. Kenya team + web manager + Nur all work inside the same tree.

> Principle: **one home for everything, named so anyone finds it in 10 seconds, access by role not by person.** Drive holds files; structured records live in Supabase (`data/schema.sql`). Drive links are referenced from Supabase rows (e.g. `beneficiaries.photo_url`, consent forms).

## Top-level structure (Shared Drive: `Nisria Org`)

```
Nisria Org/
├── 00_ADMIN/                     # governance, registration, policies, this taxonomy
│   ├── Governance & Legal/       # registration certs, board, bylaws
│   ├── Policies/                 # data-protection, safeguarding, consent policy
│   └── Templates/                # letterhead, deck, doc templates
├── 01_BENEFICIARIES/             # ⚑ RESTRICTED — PII + safeguarding
│   ├── _Consent Forms/           # signed media/data consent (links to Supabase)
│   ├── Intake/                   # intake forms by year: 2026/...
│   ├── Case Files/               # per-beneficiary folder named by ref_code (NOT name)
│   └── Photos (consented)/       # only photos cleared for use
├── 02_PROGRAMS/                  # by brand & program
│   ├── Nisria/
│   ├── Maisha/
│   └── AHADI/
├── 03_FINANCE/                   # ⚑ RESTRICTED
│   ├── Donations/                # statements, Givebutter exports, M-Pesa
│   ├── Expenses & Receipts/      # by month: 2026-01/...
│   ├── Budgets/
│   └── Reports (financial)/      # quarterly, annual
├── 04_REPORTS & IMPACT/
│   ├── Monthly/                  # 2026-01_Monthly-Report ...
│   ├── Annual/
│   └── Donor Reports/            # what goes back to funders
├── 05_MEDIA & BRAND/             # the asset library (feeds Canva + social)
│   ├── Brand Kits/               # logos, fonts, colors per brand
│   ├── Photos/                   # by shoot: 2026-05_KenyaVisit/...
│   ├── Video/
│   └── Graphics (Canva exports)/
├── 06_FUNDRAISING/
│   ├── Campaigns/                # per campaign folder
│   ├── Grant Applications/       # per funder (mirrors Supabase grant_applications)
│   ├── Donor Comms/              # newsletters, appeal letters
│   └── CSR & Partnerships/
├── 07_CONTENT/
│   ├── Editorial Calendar/       # the live planning sheet
│   ├── Blog Drafts/              # Claude drafts → reviewed → published
│   └── Social Posts/             # by month, by brand
├── 08_INVENTORY & FOLKLORE/
│   ├── Product Photos/
│   ├── Listings/                 # listing copy + Folklore status
│   └── Stock Sheets/
└── 09_OPERATIONS/
    ├── SOPs/                     # how-to docs (incl. automations)
    ├── Calendar/                 # yearly calendar source
    └── Team/                     # roster, roles, onboarding
```

## Naming conventions

- **Dates first, ISO:** `2026-05-23_Description` so files sort chronologically.
- **Beneficiary folders by `ref_code`** (e.g. `NIS-2026-014`), never by name — protects PII and matches Supabase.
- **No spaces-as-meaning:** `Nisria_AnnualReport_2026.pdf` not `final final v3 (2).pdf`.
- **Status suffixes for drafts:** `_DRAFT`, `_REVIEW`, `_FINAL`.

## Access roles (Shared Drive permissions)

| Folder group | Nur / Taona (Admin) | Kenya team (Content/Contributor) | Web manager (Contributor) | VA (Commenter) |
|---|---|---|---|---|
| 00_ADMIN | full | view | view | view |
| 01_BENEFICIARIES (PII) | full | edit (assigned) | none | none |
| 03_FINANCE (PII) | full | view (assigned) | none | none |
| 02,04,05,06,07,08 | full | edit | edit | comment |
| 09_OPERATIONS | full | view | view | view |

> RESTRICTED folders (01, 03) hold PII — limit to named people, enable Drive's "viewers can't download" where possible, and keep consent forms linked to each beneficiary record.

## Retention & hygiene

- Quarterly: archive closed-campaign and prior-year working files into `_Archive/<year>/`.
- Consent forms retained per data-protection policy (⚑ confirm retention period with Nur / Kenya legal).
- Monthly review owned by Nur (it's the only Data task she keeps): spot-check structure, confirm new intakes filed + recorded in Supabase.

## Migration steps (do first)

1. Create the Shared Drive `Nisria Org` and the tree above (empty).
2. Set role permissions per the table.
3. Sweep existing files from WhatsApp / personal drives / emails into the right homes (batch by type).
4. For each beneficiary, create `ref_code` folder + insert the Supabase `beneficiaries` row, link the consent form.
5. Drop the editorial calendar + stock sheet into place; point automations at these paths.
