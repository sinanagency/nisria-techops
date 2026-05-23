# Internal Communications Playbook (Pillar 4)

Keeps staff↔Nur and staff↔staff communication clear and async-friendly across a Dubai↔Kenya team, without burying Nur. Tools: WhatsApp + Email. Owner: Nur (staff↔Nur), team leads (staff↔staff).

> Goal: protect Nur's time (ties to Pillar 5). Default to **async + structured**; reserve live calls for decisions.

## Channels & what goes where

| Channel | Use | Not for |
|---|---|---|
| **WhatsApp group (per team)** | quick coordination, field updates, photos | decisions that need a record, long docs |
| **WhatsApp → Nur (direct)** | urgent only | routine status |
| **Email** | anything needing a record, external, approvals, reports | real-time chat |
| **Drive `09_OPERATIONS/`** | SOPs, the source of truth | ephemeral chat |
| **Weekly call (Zoom)** | decisions, blockers, alignment | status that could be a message |

## Cadences

- **Daily async standup (WhatsApp)**: each lead posts 3 lines — done / doing / blocked. Nur reads, doesn't have to reply.
- **Weekly digest to Nur (email, automatable)**: rolled-up status + the fundraising/Ad-Grants reports + decisions needed. One email, not ten pings.
- **Weekly team call (Zoom)**: 30 min, agenda from the digest, decisions logged in Drive.
- **Monthly review**: data hygiene (Drive + Supabase), KPI check.

## Rules that protect Nur's time

- **Batch, don't ping.** Non-urgent → the weekly digest, not a DM.
- **Decisions get a written record** (email or Drive doc), even if discussed on WhatsApp.
- **Templates for recurring updates** so they're fast to write and read.
- **One source of truth** (Drive `09_OPERATIONS/SOPs/`) — don't re-explain; link the SOP.

## Templates

**Daily standup (WhatsApp):**
> *Done:* … · *Doing:* … · *Blocked:* … (tag who can unblock)

**Decision request (email to Nur):**
> *Decision needed by {date}:* … · *Options:* A / B · *Recommendation:* … · *Impact if delayed:* …

## Automation candidate

Weekly digest assembly: pull standups + Supabase reports → Claude composes the single Nur email (Thu PM). See `automation/automation-map.md` (A3 + content of the week).
