# SPEC 002 — Finance Expenses This Month (the queryable spend view)

**Status:** Draft (ddjt — NO code yet)
**Asked by:** Taona, 2026-06-07
**Owner:** TBD

---

## The Ask, in Taona's words

> we need a list like a bank statement of ongoing expenses this month which is different from bank statemnts ... an ongoign expense list that even if a bank statement is sent it extracts and populates for that month, that expense list ... all the other old bank statements should all be filed in groups within finance tabs but what must be visible is the expensss card very improtant so that i can query what happened last week etc or today etc

Three things asked for at once:

1. **A foreground "Expenses this month" card** — visible by default, the most important thing on /finance.
2. **Time-window querying** — today, yesterday, this week, last week, this month, last month — without leaving the card.
3. **Auto-populate from incoming bank statements** — when a new I&M / Stanbic / M-Pesa statement is uploaded, the expense list incorporates the new rows for the matching month automatically. Old statements get archived behind tabs.

Start date: **June 2026 forward.** Pre-June bank statements stay in archive tabs; the headline expense list is current.

---

## Why this matters (the operator problem)

Today /finance ships 13 stacked sections (Treasury, Salaries, Reminders, Ledger, FinancePulse, MoneyFlows, BankingView, Paid history, ExpenseIntake, Add payment, Log M-Pesa, Log Payout, etc.). Nur cannot answer "what did we spend today?" by glancing at the page. She has to:

1. Open the Ledger collapsible → it lists 5,000 payments — read the dates manually.
2. Or open Banking → that's 2021-22 historical statements, not current.
3. Or scroll through Salaries + Reminders + MoneyFlows separately, mentally summing.

There is **no single surface that says: this is what flowed out of the org this week.** The audit named this as a Law-5 (drill-to-core) breach and assigned it to Phase 2 part 3 (Mercury layout). Taona's ask sharpens the target: don't rebuild the whole page Mercury-style yet — **first ship the expenses card**, then file the historical sources around it.

---

## What "expense" means here (definition, locked)

An **expense** is any actual outflow of money from the org, regardless of source channel. Specifically:

- A row in `payments` where `direction = 'out'` and `status = 'paid'` → expense, dated by `paid_at`.
- A row in `bank_transactions` where `direction = 'out'` → expense, dated by `txn_date`. (Includes M-Pesa, vendor wires, card transactions, etc.)
- A Givebutter payout from `payments` is **NOT** an expense (doctrine: it's a bridge, not spend). Filter out `category = 'payout' OR method = 'givebutter'`.
- A salary marked paid IS an expense (it's an outflow). Already lives as a `payments` row.

**De-dup rule:** when a `bank_transactions` row was already entered as a `payments` row (operator logged it manually, then the bank statement landed), keep the `payments` row (richer metadata: payee, purpose, category, screenshot) and drop the bank row. Match by amount + date (±1 day) + currency. If unsure → flag as "possible dup" badge but show both for the operator to merge.

**Scheduled / pending obligations are NOT expenses.** They live on the existing Reminders card. They become expenses the moment they're marked paid.

---

## The Expense Card surface (foreground)

Sits on /finance directly under the Treasury hero. Replaces the current top of the section stack (Salaries / Reminders move INTO this card as filter facets, not as their own cards).

### Headline (top of card, always visible)

```
   This week                Last 7 days                Today
   KES 142,300              KES 198,500                KES 12,400
   38 transactions          54                          4
                                          (current period highlighted)
```

One row of segmented stat cells. The active period is teal-filled. Clicking any period updates the list below. Default landing: **This week**.

### Time-filter pills (right under the headline)

```
[Today] [Yesterday] [This week] [Last week] [This month] [Last month] [Custom]
```

Pill row. Multiple-select disabled (one at a time, like Apple Wallet statements). URL-persisted via `?period=this_week` so a bookmark lands on the same view.

### The list itself (the body — bank-statement shape)

Date-grouped, newest-day first, day subtotal at the top of each group:

```
   2026-06-07  Today                                    KES 12,400 out · 4 txns
   ─────────────────────────────────────────────────────────────────────────
   09:14  M-Pesa to John Mwangi              KES 8,500    [salary]   [proof]
   10:22  Stanbic - Internet fee              KES   400   [admin]
   14:01  M-Pesa to Mama Ndegwa              KES 3,200    [program]
   16:38  I&M - DStv subscription             KES   300   [admin]    [recurring]

   2026-06-06  Yesterday                                KES 28,900 out · 9 txns
   ─────────────────────────────────────────────────────────────────────────
   ...
```

Each row carries:
- Time (HH:MM if known, else just date)
- Description / payee
- Amount (Money primitive, currency-tagged)
- Category badge (salary / program / admin / vendor / refund / etc.)
- Status chip (proof / recurring / dup-suspect)
- Source chip on hover (bank vs operator vs statement filename)

**Scroll-bounded with `<Card scroll>`** so the list never blows up the page (same primitive shipped in Phase 2 part 2).

### Filter row below the time pills (optional, secondary)

- Category: salary / program / admin / vendor / refund / other
- Currency: KES / USD / all
- Source: bank-extracted / operator-logged / both
- Search by payee or purpose

All optional. The point of the card is the time slice; the filters are refinement.

---

## How bank statements feed the expense card

The current `bank_transactions` table already receives rows from the I&M / Stanbic PDF parser (per `reference_nisria_bank_extraction.md`). When a new statement is uploaded:

1. Existing extractor writes rows to `bank_transactions` (this is already built and live).
2. Expense Card reads `bank_transactions` + `payments` together (a server-side UNION query, filtered by direction = out and date in the active period).
3. De-dup heuristic merges operator-logged + bank-extracted records when they refer to the same outflow.
4. Result renders in the date-grouped list above.

**No new ingest code required for v1.** The plumbing is there. The card is presentation + UNION query + de-dup logic.

For statements UPLOADED FOR DATES PRE-JUNE 2026: the rows still land in `bank_transactions` but the Expense Card's default period filter (this week / today / this month) won't show them. They surface only if Taona explicitly picks a Custom range that extends back, or in the archive tabs below.

---

## What sits below the Expense Card (the archive)

The current 13-section stack collapses into ONE component below the Expense Card: **Archive (TabbedPane)**.

Tabs in this order:

1. **Recurring obligations** — current Reminders card lives here. Salaries + due-soon together. Still actionable (Mark paid stays).
2. **Bank statements** — sub-grouped by account (I&M / Stanbic USD / Stanbic KES). Each account is its own scroll-bounded list. Old statements stay here, sorted newest-first. The current BankingView code mostly works; just needs the tabs around it.
3. **Givebutter & Kenya streams** — current MoneyFlows lives here (it's the USD-to-KES bridge, not spend).
4. **Manual entry** — the current ExpenseIntake / Add-payment / Log-M-Pesa / Log-Givebutter forms collapsed into one tab with a small form picker. Operator-facing capture.
5. **Forecast** — the current FinancePulse forecast bars, if kept.

The Treasury hero stays at the top untouched (it's the A-to-Z summary, working as-is).

---

## Page hierarchy, top to bottom, after this work

```
   [Cash hero — KSH/USD position, current month delta]      ← already there
   [Treasury — A-to-Z totals per currency]                   ← already there

   [Expense Card]                                            ← NEW, the focus
     headline trio (today / week / 7d)
     time pills
     date-grouped expense list (scroll-bounded)
     filter row

   [Archive (TabbedPane)]                                    ← NEW wrapper
     ├ Recurring obligations
     ├ Bank statements (sub-tabs per account)
     ├ Givebutter & Kenya
     ├ Manual entry
     └ Forecast
```

Total /finance height target after this: **~1,400px desktop** (down from 6,576px) and **~1,800px mobile** (down from 10,823px).

---

## Data model — what query the Expense Card runs

```sql
-- pseudo-SQL; real impl uses Supabase admin client
SELECT
  'payment' AS source, p.id, p.payee AS description, p.amount, p.currency,
  p.category, p.paid_at AS txn_date, p.screenshot_path AS proof, NULL AS bank_account
FROM payments p
WHERE p.direction = 'out'
  AND p.status = 'paid'
  AND p.paid_at BETWEEN :from AND :to
  AND COALESCE(p.category, '') NOT IN ('payout')
  AND COALESCE(p.method,   '') NOT IN ('givebutter')

UNION ALL

SELECT
  'bank' AS source, b.id, b.description, b.amount, b.currency,
  NULL AS category, b.txn_date, NULL AS proof, b.account
FROM bank_transactions b
WHERE b.direction = 'out'
  AND b.txn_date BETWEEN :from AND :to
  AND NOT EXISTS (
    -- de-dup: drop bank rows whose amount + date + currency already match a payment
    SELECT 1 FROM payments p2
    WHERE p2.direction = 'out'
      AND p2.amount = b.amount
      AND p2.currency = b.currency
      AND ABS(EXTRACT(EPOCH FROM (p2.paid_at - b.txn_date))) < 86400
  )

ORDER BY txn_date DESC;
```

Period boundaries:
- `today` → `[today 00:00, today 23:59]` in operator's timezone (Africa/Nairobi for Nur; Asia/Dubai for Taona)
- `yesterday` → `[today − 1, today − 1]`
- `this week` → `[Mon of current ISO week, today]`
- `last week` → `[Mon of last ISO week, Sun of last ISO week]`
- `this month` → `[1st of current month, today]`
- `last month` → previous calendar month
- `custom` → operator-picked range

---

## What I will build vs not (scope this round)

### Build (Phase 2.5)
- `app/finance/expenses/` server component renders Expense Card
- `lib/expenses.ts` server-side UNION + de-dup query
- The headline trio + time pills + grouped list + scroll-bounded card
- Mount on /finance directly under Treasury, ABOVE everything else

### NOT in this round
- The Archive (TabbedPane) wrapper around the other 13 sections. Existing sections stay in place; once the Expense Card is verified, a separate PR collapses them into the Archive.
- M-Pesa SMS ingest (separate workstream).
- The Mercury full three-pane sidebar (deferred until after Expense Card lands).
- Anything pre-June 2026 in default view.

This keeps the diff small enough to verify end-to-end without scope creep.

---

## Open questions for Taona

These need answers before I write code:

1. **Timezone for "today" / "this week"** — Nur's Africa/Nairobi, Taona's Asia/Dubai, or always UTC? My default proposal: **Africa/Nairobi** (the org's operating ground truth). Reject this and I'll change it.
2. **Categories** — should the bank-extracted rows show "uncategorised" until the operator tags them, OR should Sasa auto-categorise from the description (M-Pesa → check for "salary" / "school" / "rent" keywords)? My default: **uncategorised initially; Sasa auto-categorise as a Phase 3 enrichment.**
3. **De-dup confidence threshold** — exact amount + date (±1 day) + currency is the safest match. Drop, don't merge, on match. Confirm.
4. **Refunds in / chargebacks** — `bank_transactions.direction = 'in'` rows that are clearly refunds (negative spend). Show them as negative amount rows in the expense list, or filter out? My default: **show as negative rows** so the period total is correct.
5. **What's the trigger to mark this "done"?** — Possible: Nur opens the page, asks "what did we spend today?" three times in a row, gets the right answer each time. Confirm what the soak test is.

---

## How this connects to the audit

Phase 1 fixed the 4 lying counters + the em-dash leak. Phase 2 parts 1 + 2 fixed the bottomless scroll on five surfaces. This spec is **Phase 2 part 3 — Finance**, the last big-impact UI restructure before /approvals (now shipped) and the polish pass.

The audit named /finance for Mercury three-pane. Taona's expense-card ask refines that: the bank-style structure (date-grouped expense list with time filtering) is the right primitive; the three-pane comes later when the archive wrapper lands.

---

## Files this will touch when I build

- `platform/app/finance/page.tsx` — mount the new component, remove the duplicate "Reminders" stack OR move it into archive
- `platform/app/finance/expenses/` — new directory, expenses card route
- `platform/components/ExpenseCard.tsx` — new component
- `platform/lib/expenses.ts` — query + de-dup
- `platform/lib/dates.ts` — period boundary helpers (likely already partly exists)

Carve-outs respected: no change to `bank_transactions` schema, the I&M / Stanbic extractor, or the existing `payments` table.

---

**Next move:** Taona reviews this spec, answers the 5 open questions, then says rock. I build, verify, ship.
