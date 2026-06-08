# SPEC 002 — Finance Expenses + Upcoming Payments (revised)

**Status:** Draft v2 (ddjt — NO code yet, advisory pass complete)
**Asked by:** Taona, 2026-06-07
**Last revision:** 2026-06-07 (Taona refined direction, locked timezone + three-card hero)

---

## What Taona locked, what he asked, what he wants advice on

### LOCKED (from Taona's two messages)
- Timezone of the app = **Asia/Dubai (GMT+4)**.
- Finance is now about **understanding spend**, not capturing it.
- Three-card hero at top of /finance: **Donations this month / Money out this month / Upcoming payments**.
- Upcoming payments = **horizontally scrollable card stack** (only THIS card scrolls horizontally, not the others).
- "Upcoming" window = **next 7 days**.
- If a bank statement, invoice, or any financial document is ingested and its dates land in the current month → its rows populate the Money-Out view automatically.
- If a payment-task is scheduled and its due date lands in the 7-day window → it appears in Upcoming Payments alongside obligations.
- Start from **June 2026 forward**; older bank statements live in archive tabs below.

### NEEDS MY ADVICE (Taona's words: "be decisive but first advise me")
Below is my full read with concrete recommendations on every fork. He decides.

---

## The page shape after this work

```
   ┌────────────────────────────────────────────────────────────────┐
   │                       /finance                                  │
   ├────────────────────────────────────────────────────────────────┤
   │                                                                 │
   │   [Cash hero — KES + USD position]            already there     │
   │   [Treasury — A-to-Z summary per currency]    already there     │
   │                                                                 │
   │   ┌──────────────────┐ ┌──────────────────┐ ┌─────────────────┐ │
   │   │ Donations        │ │ Money out        │ │ Upcoming        │ │
   │   │ this month       │ │ this month       │ │ payments        │ │
   │   │ KES 142,300      │ │ KES 198,500      │ │ 3 in next 7 days│ │
   │   │ 34 gifts         │ │ 54 transactions  │ │ ← horizontal →  │ │
   │   │ goal: KES 220k   │ │ vs 165k last mth │ │  [card][card]…  │ │
   │   └──────────────────┘ └──────────────────┘ └─────────────────┘ │
   │   click → /donations    click → expense list   click → details   │
   │                                                                 │
   │   [EXPENSE LIST — date-grouped, queryable]                      │
   │     [Today] [Yesterday] [This week] [Last week] [This month]    │
   │     [Last month] [Custom]                                       │
   │     2026-06-07 Today          KES 12,400 out · 4 txns           │
   │       09:14 M-Pesa to John   KES 8,500   [salary][proof]        │
   │       …                                                          │
   │                                                                 │
   │   [ARCHIVE — TabbedPane]                                        │
   │     Recurring · Bank statements (per account) ·                 │
   │     Givebutter & Kenya · Manual entry · Forecast                │
   └────────────────────────────────────────────────────────────────┘
```

---

## My advisory pass (decide each item — I'm driving with a recommendation)

### A1. Should "Donations this month" lead on /finance when it already leads on /home?
- **The duplication risk:** /home already shows raised-this-month against goal. Adding it to /finance creates two homes for the same number.
- **The CFO argument (this wins for me):** /finance becomes the unified money operating room. In = donations, Out = expenses, Forward = upcoming. The CFO mental model is a single page where money flows live together. /home's "raised this month" stays as a top-of-funnel teaser that links INTO /finance for the full money view.
- **My recommendation: YES, put donations-this-month on /finance.** Both surfaces read from the SAME query (already centralised in lib/counts.ts + the donations query). They will never disagree because they share the source. The /home version becomes a deep-link teaser; the /finance version is the canonical CFO view.
- **What to demote on /home eventually:** the big teal "Raised this month $0 / goal" hero could shrink to a one-line "Raised: KES 142k of KES 220k goal → see Finance" link. Not in scope for this round; flag for Phase 4 polish.

### A2. What's IN each of the three cards?

**Card 1 — Donations this month**
- Headline figure: total raised this month (KES + USD split, never blended unless behind an FX toggle per Currency Law).
- Sub-line: # gifts, # of recurring vs one-off, # new donors this month.
- Mini progress bar against monthly goal.
- Tap → /donations filtered to this-month.

**Card 2 — Money out this month**
- Headline figure: total spent this month, KES side dominant (since most operating spend is KES). Optional USD line below.
- Sub-line: # transactions, breakdown by category top-3 (e.g. "Salary 62% · Program 22% · Admin 9%").
- Mini-trend: this month vs last month delta (▲ 18% or ▼ 12%).
- Tap → scrolls down to the expense list with this-month filter applied.

**Card 3 — Upcoming payments (horizontally scrollable)**
- Headline: # of payments in the next 7 days + the total amount.
- The horizontal stack: each upcoming payment as a mini-card showing payee, amount, days until due, urgency colour (red overdue / amber due-soon / teal scheduled).
- Tap a mini-card → opens its FocusSheet with mark-paid action.
- Tap the header → opens the full upcoming list (could be 0-30 items; if many, the horizontal scroll caps at ~10 visible cards + "View all 22 →" trailing card).

### A3. What counts as an "upcoming payment"?

The UNION of two sources:
- `payments` rows where `status IN ('scheduled', 'due')` AND `due_on BETWEEN today AND today+7`. Includes salaries-due, vendor obligations, M-Pesa scheduled, etc.
- `tasks` rows where the task has a financial dimension AND `due_on BETWEEN today AND today+7`. **My recommendation on the discriminator:** task category contains "payment" / "pay" / "invoice" / "rent" / "salary" — OR task has a `linked_payment_id`. (If your task model doesn't already carry this hint, the cleanest answer is to NOT include tasks in v1; payments table is the truth source. Confirm whether tasks should appear or not — see Open Q below.)

### A4. How does an incoming bank statement populate Money-Out?

The plumbing already exists:
- Bank statement PDFs ingest via the I&M / Stanbic parser → writes rows to `bank_transactions`.
- Invoices ingest via Filing → Studio extracts amounts; today those don't land in `bank_transactions`. Invoices today are documents in `documents` table without dollar amounts in a queryable column.

**My recommendation:** Money-Out card reads the UNION of `payments WHERE status=paid AND direction=out` + `bank_transactions WHERE direction=out`. Filtered to current-month (Dubai timezone). De-dup as in v1 spec.

For invoices: an invoice is a PRE-payment artifact (you OWE money, you haven't paid yet). It should NOT land in Money-Out (that's spend that already happened). It SHOULD land in Upcoming Payments IF and only if it carries a due_date AND amount AND has been classified as "owed." That requires either:
- An operator step where Sasa surfaces "I see an invoice for X due Y, want me to schedule it?" — creates a `payments` row with status='scheduled'.
- OR the studio extractor auto-creates the payment row, marked "auto-extracted, needs review."

**My recommendation: option 1 (Sasa surfaces, operator confirms).** Auto-creating money obligations from extracted documents is a fabricated-data risk. Doctrine Law 11 (honesty) says do not invent. The Sasa-confirmation step keeps a human on the hook for "is this real?"

### A5. What's the "this month" boundary in Asia/Dubai timezone?

- Today = Dubai-local today (00:00:00 to 23:59:59 in Asia/Dubai).
- This week = ISO week containing Dubai-today; Monday is week start.
- This month = 1st of Dubai-current-month at 00:00:00 to now.
- All bank_transactions and payments are stored as date or timestamptz. Convert at the query boundary, not at render.

Affects M-Pesa rows specifically: M-Pesa stmts are in Africa/Nairobi (GMT+3). A 23:30 Nairobi M-Pesa lands at 00:30 Dubai next day. **My recommendation:** keep the row's bank-local date as the canonical txn_date; only the query window uses Dubai TZ. So a 23:30 Nairobi M-Pesa on the 7th stays "the 7th" on the list, and falls inside Dubai's June 7 window. Slight cross-midnight drift, acceptable.

### A6. Three-card layout: equal width or weighted?

Three-card row is 3-col on desktop, stacks on mobile. **My recommendation: equal width, fixed gap = 16px.** The Upcoming Payments card needs visible internal horizontal scroll; equal width keeps it predictable. On mobile, stack vertical with Upcoming Payments retaining its internal horizontal scroll (this is the "iOS card stack" feel).

### A7. What about /home's "Raised this month" hero?

Don't touch in this round. Keep both surfaces; they share the query so they stay honest. Phase 4 polish revisits whether /home demotes its money hero.

---

## The 5 v1 open questions, with Taona's new answers folded in

| # | Question | v1 default | Taona answer (2026-06-07) |
|---|---|---|---|
| 1 | Timezone | Africa/Nairobi | **Asia/Dubai** ← locked |
| 2 | Auto-categorise bank rows | Uncategorised first, Sasa later | (not yet decided — my recommendation: Sasa auto-tag on extraction with a "verify" badge until operator confirms) |
| 3 | De-dup threshold | exact amount + ±1 day + currency | (not yet decided — confirm? my recommendation: keep this rule) |
| 4 | Refunds (inflow) in expense list | show as negative rows | (not yet decided — my recommendation: HIDE from Money Out card, show in a separate "Refunds & reversals" mini-strip under it; refunds are not spend) |
| 5 | Soak test | Nur asks "what did we spend today" 3× and gets right answer | (not yet decided — confirm or replace?) |

## NEW open questions (from this round)

| # | Question | My recommendation |
|---|---|---|
| 6 | Should tasks with a payment dimension appear in Upcoming Payments? | **NO for v1.** The payments table is the truth source for money obligations. If Nur or Sasa create a "remind me to pay X on Y," that should create a `payments` row directly (via record_payment smart-tool which already exists), not a tasks row. Tasks stay tasks; payments stay payments. Less data-routing surface, less inconsistency risk. Revisit if a workflow gap emerges. |
| 7 | Should invoices auto-create scheduled payments? | **NO for v1.** Sasa surfaces "I see an invoice for X due Y, want me to schedule it?"; operator says yes; THEN it becomes a payments row. Fabricated-money risk too high otherwise. |
| 8 | Upcoming Payments card — what if there are zero? | Show an empty-state mini-card: "All clear for the next 7 days." Same visual weight as a payment card so the layout doesn't collapse. |
| 9 | What if Upcoming Payments has 30+ items? | Cap horizontal scroll display at ~10 visible cards + a trailing "View all 22 →" card that opens a focused list. Don't force the operator through 30 swipes. |
| 10 | Currency mixing on the Money-Out card | KES headline dominant + USD subline. Never blend without an FX toggle. Per Currency Law. |

---

## Final shape, locked once Taona signs off

```
/finance page:
  1. Cash hero                     (unchanged)
  2. Treasury                      (unchanged)
  3. Three-card hero               (NEW)
       - Donations this month
       - Money out this month
       - Upcoming payments (horizontal scroll)
  4. Expense list                  (NEW — the queryable bank-statement-style list)
       - Time pills (today / yesterday / this week / last week / this month / last month / custom)
       - Date-grouped, day subtotals
       - Per-row category badge + proof chip
  5. Archive (TabbedPane)          (NEW WRAPPER around existing sections)
       - Recurring obligations
       - Bank statements (per account sub-tabs)
       - Givebutter & Kenya
       - Manual entry
       - Forecast
```

Target heights after build: **/finance ~1,400px desktop, ~1,800px mobile** (down from 6,576px / 10,823px today).

---

## Where the data comes from (no schema changes needed)

| Card | Source |
|---|---|
| Donations this month | `donations` where `status='succeeded'` and `donated_at` in Dubai this month; sum by currency. |
| Money out this month | UNION of `payments` (paid out) + `bank_transactions` (out), de-duped, filtered by Dubai this-month. Excludes Givebutter payouts. |
| Upcoming payments | `payments` where `status IN ('scheduled','due','overdue')` AND `due_on BETWEEN today AND today+7 days` (Dubai TZ). Tasks NOT included in v1. |
| Expense list | Same UNION as Money Out, ordered by date desc, grouped by Dubai-local day. |

---

## What I will build vs not (revised scope)

### Build (Phase 2 part 3, this round)
- `app/finance/page.tsx` revisions: mount the three-card hero, the expense list, and the archive wrapper.
- `lib/expenses.ts` — UNION + de-dup query helper.
- `lib/upcoming.ts` — upcoming payments query (next 7 days, Dubai TZ).
- `lib/period.ts` — Dubai-TZ period boundary helpers.
- `components/ExpenseCard.tsx` — the three-card hero + the expense list.
- `components/UpcomingPaymentsStrip.tsx` — the horizontal scroll card.

### NOT in this round
- /home raised-this-month hero demotion.
- Tasks→payments linking.
- Invoice auto-scheduling.
- M-Pesa SMS ingestion.
- The /donations and /campaigns surfaces themselves.
- Phase 3 (Settings TabbedPane, Legal TabbedPane) — those are queued after this.

---

## Carve-outs respected

- No change to `payments` schema.
- No change to `bank_transactions` schema.
- No change to the bank-statement extractor.
- No change to /tasks route, tasks API, services/, or group-bot/.
- No change to /donations route (the new card READS from the same query but doesn't reshape /donations).

---

**Decision Taona must make before I code:**

Read this revised spec, then answer in any short form:

1. Q2 — auto-categorise bank rows on extraction with a verify badge? **Y / N / Sasa decides per row**
2. Q3 — de-dup rule: exact amount + ±1 day + currency, drop bank, keep operator row? **confirm / change**
3. Q4 — refunds in Money Out card: hide them OR show as negative rows? **hide / show**
4. Q5 — soak test: "Nur asks what did we spend today 3× and gets right answer each time"? **confirm / replace**
5. Q6 — tasks with payment dimension in Upcoming Payments: **YES include / NO payments table only**
6. Q7 — invoice auto-create scheduled payments: **YES auto / NO Sasa-confirm**

Six short answers and I roll. Otherwise I default to my recommendations above and ship; you correct in flight.
