# Givebutter Setup — Donations, Recurring, Campaigns, Gamified Giving (Pillar 2)

Givebutter is the fundraising hub: donation forms, recurring giving, campaign pages, donor data, and (with Substack as alt) the newsletter. Account: `info@sinan.agency`, display name **Taona**. Givebutter is free (tip-or-fee model), good for a nonprofit.

> Owner: Delegate executes, Nur leads seasonal strategy. Tools: Givebutter + Canva + custom widget (gamification).

## Foundation (one-time)

1. **Org profile**: logo, mission blurb, brand colors per brand (Givebutter supports campaign-level branding).
2. **Default donation form**: suggested amounts (e.g. $10/$25/$50/$100/custom), **recurring toggle on by default-prompted**, cover-the-fee option, fast Apple/Google Pay.
3. **Thank-you page URL** → register as a **conversion** in GA4/Ads (ties to Ad Grants).
4. **Payouts** → ⚑ confirm bank/settlement with Nur (Kenya vs US; Givebutter payout regions).
5. **Connect** to the donor DB: export or webhook → Supabase `donations`/`donors` (see automation map).

## Campaign types → map to `campaigns.type`

| Givebutter campaign | Use | Cadence |
|---|---|---|
| Always-on "Donate" | evergreen giving page | permanent |
| Seasonal | Ramadan / year-end / back-to-school appeals | 4–6×/yr (Nur leads) |
| Cause / specific | fund a specific beneficiary or program | as needed |
| Peer-to-peer | supporters fundraise for you | per campaign |
| Events | galas / drives | per event |

## Recurring giving (the retention engine)

- Prompt monthly giving on every form ("$25/month feeds a child for a week" — ⚑ real figure from Nur).
- Recurring donors → tag `recurring` in Supabase, segment for special stewardship.
- Goal: grow % of revenue that's recurring (predictable base).

## Gamified giving (the custom widget — "Gamifying Giving")

Setup once, maintain quarterly. Concrete options, cheapest → richest:

1. **Fundraising thermometer / progress bar** — Givebutter has native goal meters; embed on Squarespace.
2. **Milestone unlocks** — "At $5k we fund 10 school kits" — visualized as a progress ladder.
3. **Donor wall / badges** — recognize givers (names or aliases), tiers (Friend/Champion/Guardian).
4. **Custom widget** (dev) — a small embeddable React widget reading live `campaigns.raised_amount` from Supabase: animated meter + milestone ladder + recent-donations ticker. Hosted on Vercel, embedded via iframe on Squarespace.

> Build path for #4: tiny Next.js/React widget → reads Supabase public campaign view → deploy on Vercel → `<iframe>` into Squarespace. Scaffold lives under a future `widgets/` folder.

## Newsletter via Givebutter

- Use Givebutter's email to donors for appeals + the weekly newsletter (keeps audience + giving unified). Substack alt for public/SEO reach.
- Segment sends (see `donor-crm-and-pipeline.md`).

## Automation candidates

Givebutter donation → upsert donor + insert donation in Supabase → send branded receipt → if first gift, trigger welcome series → update campaign meter. See `automation/automation-map.md`.
