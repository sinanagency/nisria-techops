# Google Ad Grants Playbook (Pillar 2)

$10,000/month in free Google Search ads for eligible nonprofits. High leverage: it drives donors, volunteers, and beneficiaries to the site for free — but it has strict rules and dies if you ignore the maintenance. Account: `tech@nisria.co` (Nur added it to Google Ads).

> Owner: Delegate, weekly check. Tools: Google for Nonprofits → Google Ad Grants + GA4. Setup once → weekly follow-up.

## Eligibility & setup (one-time)

1. **Google for Nonprofits** account — requires nonprofit validation via **TechSoup / Goodstack** (which is exactly why those were onboarded). Get the validation token, enroll.
2. Enroll in **Google Ad Grants** (separate from a paid Ads account).
3. Website must: be owned by the nonprofit, have a clear mission, **HTTPS**, no excessive commercial ads.
4. Install **GA4** + link to Ads; define **conversions** (donation, newsletter signup, volunteer form, contact). Conversion tracking is mandatory under current rules.

## The compliance rules (break these → account paused)

- **$10k/mo cap; max CPC $2.00** (biddable higher only via Maximize Conversions / portfolio strategies with a target).
- **Min 5% CTR** maintained each month (2 months below 5% = temporary deactivation).
- **Min 2 active ad groups per campaign**, **min 2 ads per ad group**, **min 2 sitelink extensions**.
- **No single-word keywords**, no overly generic keywords, **quality score ≥ 3** (pause QS 1–2).
- **Geo-targeting** set, **conversion tracking** active, valid.
- **Account activity:** log in monthly, make real optimizations.

## Recommended account structure

```
Campaign: Donate / Give            → ad groups: "donate to kenya children", "sponsor a child kenya", ...
Campaign: Volunteer / Get Involved → ad groups: "volunteer nonprofit kenya", "ways to help children", ...
Campaign: Programs / Cause         → ad groups by program (education, food, health, livelihood)
Campaign: Brand                    → "nisria", "maisha", "ahadi" (protect brand terms)
Campaign: Shop / The Folklore      → "handmade kenya", "african artisan goods" (drives store)
```
Each ad group: 2–3 responsive search ads, tight keyword theme, ≥2 sitelinks, callouts, structured snippets.

## Conversions to track (GA4 → Ads)

- Donation completed (Givebutter thank-you URL or event)
- Recurring donation started
- Newsletter signup
- Volunteer / contact form submit
- The Folklore outbound click

## Weekly maintenance checklist (the "follow-up")

- [ ] CTR ≥ 5% account-wide? Pause/replace low-CTR ads & keywords.
- [ ] Any keyword quality score 1–2? Pause it.
- [ ] Search-terms report → add negatives, harvest new high-intent keywords.
- [ ] Conversions tracking firing? Spot-check.
- [ ] Budget pacing toward $10k? Raise bids / add keywords if underspending.
- [ ] 2 ads per ad group still active? Add a fresh RSA, pause the weakest.
- [ ] Log the week's changes in Drive `06_FUNDRAISING/` (also satisfies "account activity").

## Automation candidate

Weekly: pull Ads + GA4 report → Claude summarizes CTR/conversions/QS flags + suggested negatives → posts digest for the delegate to action. See `automation/automation-map.md`.

## First-30-days plan

Week 1: validate via TechSoup/Goodstack, enroll, install GA4 + conversions.
Week 2: build the 5 campaigns, keywords, RSAs, extensions.
Week 3: launch; daily light monitoring for CTR.
Week 4: first optimization pass; establish the weekly rhythm.
