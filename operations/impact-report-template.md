# Impact Report Template (donor + grant reporting)

Reusable structure for monthly donor updates, quarterly donor reports, and grant reports. Numbers pull from Supabase (donations, beneficiaries, campaigns); keep figures consistent with the website and grant boilerplate. Owner: Delegate drafts (Claude), Nur signs off.

> Three depths from one template: **monthly** (1 page, email), **quarterly** (2–4 pages, PDF), **grant** (funder's format, scoped to their funded program).

## Structure

**1. Headline (the one number)**
> This {period}, your support reached ⚑ {N} children/families.

**2. By the numbers** (table, from Supabase)
| Metric | This period | YTD |
|---|---|---|
| Children/families supported | ⚑ | ⚑ |
| Raised | ⚑ | ⚑ |
| Recurring donors / MRR | ⚑ | ⚑ |
| Meals / school kits / [program units] | ⚑ | ⚑ |
| New beneficiaries intake | ⚑ | ⚑ |

**3. A story** (one consented beneficiary, before→after; photo if consented).

**4. Where the money went** (transparency — % program / M&E / admin; or specific line items for grant reports).

**5. What's next** (next period's focus / campaign / goal).

**6. Thank you + CTA** (donor reports: deepen giving; grant reports: continued partnership).

## Cadence & sources

- **Monthly** → recurring + major donors (email; auto-draft via automation A3 + content).
- **Quarterly** → all donors + board (PDF in Drive `04_REPORTS/Donor Reports/`).
- **Grant** → per funder deadline, scoped to their program, using `grant-boilerplate-template.md` impact blocks.

## Data hooks (Supabase queries to populate)

- Raised this period / YTD: `donations` sum by date range.
- Recurring + MRR: `donations` where `is_recurring`, distinct donors.
- New donors: `donors` where `first_gift_at` in range.
- Beneficiaries reached / new intake: `beneficiaries` counts by `intake_date`/status.
- Program units: ⚑ track as a metric (add a `program_metrics` table later if needed).

*Automatable: A3 (weekly/monthly) assembles the draft from these queries + the period's best content; human adds the story + signs off.*
