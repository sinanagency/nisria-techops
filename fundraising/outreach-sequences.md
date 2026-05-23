# Outreach Sequences — CSR, Influencer, Partnerships (Pillar 2)

Templates and cadences for the outreach tasks (Weekly Outreach, CSR Outreach, Influencer Outreach, Cause Marketing). Logged in Supabase `outreach`. Tools: LinkedIn, Gmail, Instagram DM, Claude.

> Personalize every first line — no mass-blast. Quality > volume. Each sequence = research → touch 1 → follow-ups → log.

## CSR / Corporate (LinkedIn + Gmail, monthly campaigns)

Target: companies with CSR budgets, local/regional presence, values aligned with the cause.

**Touch 1 (LinkedIn or email):**
> Hi {name}, I lead partnerships at Nisria — we {one-line mission} for children in Kenya. I noticed {company}'s CSR focus on {their cause}. We have a {specific program} where a {amount} partnership funds {concrete outcome}, with full impact reporting your team can share internally. Open to a 15-min call next week?

**Follow-up 2 (day +4):** value-add — share an impact one-pager / recent outcome.
**Follow-up 3 (day +10):** soft close — "should I close the loop or is there interest?"
Log stage in `outreach`. Won → create donor (`type=corporate`) + campaign.

## Influencer (Instagram DM / email, ongoing batches)

Target: creators whose audience overlaps (Kenya, diaspora, parenting, social-good, African fashion for The Folklore).

**Touch 1 (DM):**
> Hi {name}, love your work on {topic}. I'm with Nisria — we {mission}. We'd love to {collab idea: a story takeover / share a beneficiary milestone / feature The Folklore pieces}. No ask for money — just amplifying real impact to your audience. Could I send a short brief?

Tiered asks: story share → reel collab → ambassador. Track in `outreach` (type=influencer).

## Partnerships / Other NGOs (email)

Mutual-benefit framing: shared programs, referrals, co-applications for grants.

## Cause Marketing (Nur-led, weekly)

This is Nur's strategic lane: tie a product/brand to the cause (e.g. % of a Folklore collection funds X, a sponsor matches gifts). Delegate executes the assets (Claude + Canva + Email); Nur sets direction.

## Weekly outreach operating loop

1. Build/refresh target list (10–20 prospects) for the active sequence.
2. Send first touches (personalized first line — Claude assists the body, human writes the hook).
3. Advance everyone with a pending next_action.
4. Log all touches in `outreach`; set next_action + date.
5. Won → hand to donor pipeline / partnership track.

## Automation candidates

Draft personalized first lines from a prospect's LinkedIn/site (Claude), follow-up reminders from `outreach.next_action_on`, weekly "who's gone cold" list. See `automation/automation-map.md`.
