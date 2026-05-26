# Overnight extraction + build log

Started 2026-05-27. Mandate: extract documents/sheets/statements from the Google Drive
(connected via the claude.ai Google Drive connector), structure them onto the platform,
build new sections where the data recurs and earns one, fill the Brain. Skip pictures/
videos. No fabricated numbers. KES and USD kept separate. Idempotent. Never auto-send
WhatsApp/email during extraction. Flag anything uncertain for Nur.

Default applied (Nur to confirm): historical months load as PAID (dated to their month);
the current month stays as obligations until marked paid.

Task spine: #50 finance history · #51 bank statements/Banking · #52 grants→pipeline+Brain ·
#53 databases→beneficiaries/Microfund/Sponsored Students · #54 team contracts → pay/Brain ·
#55 fill Brain from narrative docs · #56 durable in-app Drive watcher (cred dependency).

Blocked, waiting on Nur (logged, not guessed):
- Bot SEND: needs WhatsApp permanent token + app secret (Phone Number ID + WABA ID already set).
- Durable in-app Drive watcher: needs its own Google credential (service account / OAuth token),
  since the app cannot use the claude.ai connector. Bootstrap extraction does not depend on it.

---

## Progress

### #50 Finance history (in progress)
- Read historical monthly expense sheets from Drive: Nov 2025, Dec 2025, Jan 2026.
- Loaded each month's reconciled total into `payments` as PAID, dated to the 28th:
  Nov 2025 = 460,620 KES, Dec 2025 = 450,120 KES, Jan 2026 = 482,120 KES
  (batch `drive monthly history`, total 1,392,860 KES). This powers previous-months spend.
- DECISION/FLAG: the historical sheets are messy (revision columns, ambiguous alt totals,
  and old roster names no longer on the team, e.g. Mburu Paul, Sammy Wambui, Kevin Mburu,
  several interns). To avoid misattributing line items I recorded the reconciled MONTH TOTAL
  per month, not per-person lines. If you want full per-person history per month, say so and
  I will itemise (with each month's total validated against its sheet).
- STILL TO DO on #50: read Nisria 2026 Budget.xlsx → Budget-vs-Actuals card; read 202604 STP
  Expenses; build a "spend by month" view on /finance (this month vs previous months).
- Note: /finance was extended by another pass (salaries subsystem: team_payments,
  markSalaryPaid, computeSalaryReminders, Countdown). Will build the month view to fit it.

### #55 Fill the Brain (in progress, first batch)
- Confirmed write path: recall() always surfaces kind='org_fact' from agent_memory by kind
  (no embedding needed), so org facts ground every grant/report/reply immediately.
- Loaded 6 grounding org_fact entries (source_type 'drive-brain'): organization identity,
  team and structure (24 staff, departments), monthly finances (597k KES, due 28th, Nov/Dec/Jan
  history), STP + SANARA grant coverage, programs (Kwetu Haven, Education, Health, Food,
  Microfund, Sponsored Students, Maisha), banking and compliance (I&M + Stanbic, CBO, EIN).
- STILL TO DO on #55: deeper facts from narrative docs (TechOps System doc, Executive Summary,
  Concept Notes, business plans) once those are read in the program/grant passes.

### Resume point
Next: finish #50 (budget → Budget-vs-Actuals + 202604 STP sheet + per-month finance view),
then #51 bank statements, #52 grants, #53 beneficiary databases, #54 team contracts, deepen #55.
All data so far is committed to Supabase; new-section CODE builds will batch-deploy+commit.
