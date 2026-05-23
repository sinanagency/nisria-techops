# Grant Applications Workflow (Pillar 2)

Weekly grant application engine combining "Harsh's engine" + Claude + the Granted MCP. Tracked in Supabase `grant_applications`. Owner: Nur + Delegate.

> ⚑ "Harsh's engine" and "Granted MCP" are referenced in the source plan — confirm with Nur/Harsh what each is (Harsh likely has a grant-sourcing/eligibility tool; Granted MCP = a grants database MCP server). Workflow below is tool-agnostic and slots them in.

## Weekly rhythm

```
DISCOVER  → Harsh's engine / Granted MCP surface matching grants (by cause, geo Kenya, size)
TRIAGE    → score fit (eligibility, amount, deadline, effort) → log in grant_applications (status=researching)
DRAFT     → Claude drafts narrative from a reusable "org boilerplate" + program specifics
REVIEW    → Nur reviews/approves (the part she keeps)
SUBMIT    → submit, set status=submitted, submitted_on, link
TRACK     → on decision: status=won/rejected, amount_awarded, decision_on
```

## Reusable assets (write once, reuse every app)

Keep in Drive `06_FUNDRAISING/Grant Applications/_Boilerplate/`:
- **Org boilerplate**: mission, history, registration, leadership, audited financials.
- **Program one-pagers**: each program (education/food/health/livelihood) with need, model, outcomes, budget.
- **Impact stats**: # beneficiaries, outcomes, testimonials (consent-gated).
- **Standard answers**: theory of change, M&E approach, sustainability, DEI, safeguarding.
- **Budget template**.

Claude assembles tailored applications from these + the specific funder's questions.

## Triage scoring (fast yes/no)

| Factor | Weight |
|---|---|
| Eligibility (geo Kenya, cause, org type) | gate — must pass |
| Amount vs effort | high |
| Deadline feasible | high |
| Restricted vs unrestricted funds | medium (unrestricted preferred) |
| Reporting burden | medium |

## Pipeline hygiene

- Every prospect logged in `grant_applications` with a `deadline` → sort by deadline, never miss one.
- Weekly: review submitted (chase decisions), advance drafting, add new discoveries.

## Automation candidates

Granted MCP / Harsh's engine → auto-insert researching rows; deadline reminders; Claude first-draft from boilerplate + funder questions. See `automation/automation-map.md`.
