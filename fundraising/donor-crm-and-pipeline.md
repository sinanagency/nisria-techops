# Donor CRM, Segmentation & Pipeline (Pillar 2)

How donors are captured, segmented, stewarded, and grown. The CRM is the Supabase `donors` table (`data/schema.sql`) fed by Givebutter; this doc is the operating logic on top.

> Owner: Delegate, ongoing. Covers: Growing Donor Database, Bulk Email Sending, Weekly Outreach.

## Lifecycle stages (`donors.status`)

```
prospect → active → (recurring) → major
             ↘ lapsed (no gift in 12 mo) → re-engage
```

## Segmentation (use `donors.tags` + rollups)

| Segment | Rule | Stewardship |
|---|---|---|
| New donor | first gift < 30 days | Welcome series (3 emails) |
| Recurring | `is_recurring` gifts | Monthly impact note, never ask harder than thank |
| Lapsed | no gift 12+ mo | Win-back appeal 2×/yr |
| Major | lifetime_value ≥ ⚑ threshold | Personal touch from Nur, quarterly call/report |
| Corporate / CSR | `type = corporate` | Partnership track (see outreach) |
| One-time | single gift | Convert-to-monthly nudge |

## Bulk email cadence (weekly / campaign-based)

- **Weekly**: newsletter (all opted-in) — content, not just asks.
- **Monthly**: impact note to recurring + major donors.
- **Campaign**: seasonal appeal sends (segmented; suppress recent donors from re-asks).
- **Lifecycle (automated)**: welcome series, first-gift thank-you, recurring milestone, lapsed win-back.
- **Hygiene**: honor unsubscribes, keep bounce/complaint rates low (protects deliverability), never buy lists.

Tooling: Givebutter email (donor-linked) primary; Substack for public newsletter reach. ⚑ confirm primary with Nur.

## Weekly Outreach (the recurring task)

Each week the delegate:
1. Reviews `outreach` pipeline → moves stages, logs touches.
2. Sends N new first-touches (CSR/influencer/partner) — see `outreach-sequences.md`.
3. Follows up anyone at `contacted`/`replied` with no next action.
4. Logs everything in Supabase `outreach` (owner, last_touch_at, next_action).

## Reporting (what Nur sees)

Weekly one-pager (automatable): new donors, total raised this week/MTD, recurring count + MRR, top campaign, lapsed count, pipeline movement. Pull straight from Supabase.

## KPIs

- Total raised (MTD/YTD) · # active donors · # recurring + monthly recurring revenue · retention rate · avg gift · cost-to-raise (esp. with free Ad Grants traffic) · lapsed/win-back rate.

## Automation candidates

Givebutter→Supabase sync, welcome/thank-you/lapsed lifecycle emails, weekly donor report, segment list builds. See `automation/automation-map.md`.
