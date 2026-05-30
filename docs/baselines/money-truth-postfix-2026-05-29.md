# Money Truth Audit

Date: 2026-05-29
Run by: money-truth-auditor (scripts/money_truth_audit.py)
Database: Supabase project ptvhqudonvvszupzhcfl
Mode: read-only (no writes, no deletes, no mutations)

## Law 2 violations (Currency)

- KES rows as USD (donations, amount > 1,000,000): **0**
- KES rows as USD (payments, amount > 1,000,000): **0**
- Untagged currency (donations): **0**
- Untagged currency (payments): **0**

## Law 1 violations (Source-of-truth)

- Drive monthly history poisoned rows (created_by='drive monthly history', currency='USD'): **0**  _(target after Pass 0: 0)_
- Donations with no source (external_id null and channel != 'manual'): **0**
- Bank accounts missing debits: **none**

### Bank transactions by account
| account | credits | debits | first | last |
| --- | --- | --- | --- | --- |
| Absa 2043066008 · Nisria CBO (UWEZO KES) | 13 | 116 | 2021-10-01 | 2022-11-11 |
| LHSH · Absa Bank Kenya - 2031538133 | 44 | 155 | 2021-10-01 | 2022-11-11 |

### Extraction staging health
| status | confidence | n |
| --- | --- | --- |
| committed | high | 3 |

## The damage in one figure

- USD payments-out total as stored: **27652** (this is the poisoned, impossible number)
- USD payments-out total of only the sane rows (amount <= 1,000,000): **27651.66**
- The gap between those two is the corruption.

## The trustworthy side (for reference, not a clean total)

- Donations USD (succeeded): **$26482.61**
- Donations KES (succeeded): **14827776 KES**
- Payments out KES (paid): **24226463 KES**
- Note: these are NOT summed across currencies. Per the Currency Law, a blended total requires market FX and is built in Pass 0.

## Spot check: 10 random USD donations
| amount | currency | donated_at | external_id | campaign |
| --- | --- | --- | --- | --- |
| 116.00 | USD | 2025-03-12 | lxxnXR4bacDYeVDs | One of 500 |
| 100.00 | USD | 2025-09-01 | PbEJ8U9mcMsEIR78 | One of 500 |
| 100.00 | USD | 2025-12-17 | WjL9QTWFQ2yzgSSd | One of 500 |
| 100.00 | USD | 2026-02-01 | 6kPgLJn6TnxDkfZb | One of 500 |
| 100.00 | USD | 2025-11-01 | B53b406cTX4vCe56 | One of 500 |
| 115.00 | USD | 2025-06-15 | DlvCLHRUWElZ06dO | One of 500 |
| 1.00 | USD | 2025-07-14 | HpKSbrR5QMESYh80 | Help Us Rescue 100 Abandoned Children |
| 50.00 | USD | 2026-05-24 | IPSes661HZ0fI8Y5 | One of 500 |
| 100.00 | USD | 2026-03-08 | vjyevmbtBSuMc3XZ | One of 500 |
| 50.00 | USD | 2026-04-24 | WGmqjmuHn6T04SE2 | One of 500 |

## Spot check: 10 random KES payments
| payee | amount | currency | paid_at | created_by | ref |
| --- | --- | --- | --- | --- | --- |
| Julia Mwaniki | 15000 | KES | 2025-10-28 | drive sheet 2025-10 | drive sheet 202510 #7 |
| Grace | 20000 | KES | 2023-06-28 | drive sheet 2023-06 | drive sheet 202306 #3 |
| Supermarket | 40000 | KES | 2025-05-28 | drive sheet 2025-05 | drive sheet 202505 #30 |
| John Njuguna | 4850 | KES | 2023-08-28 | drive sheet 2023-08 | drive sheet 202308 #14 |
| Rick Wambui | 8000 | KES | 2025-08-28 | drive sheet 2025-08 | drive sheet 202508 #18 |
| Valentine Mwenja | 65000 | KES | 2024-07-28 | drive sheet 2024-07 | drive sheet 202407 #41 |
| Jackline Agutu | 5000 | KES | 2026-02-28 | drive sheet 2026-02 | drive sheet 202602 #16 |
| Mburu Paul | 12579 | KES | 2024-08-28 | drive sheet 2024-08 | drive sheet 202408 #2 |
| Cynthia Mwangi | 15000 | KES | 2025-09-28 | drive sheet 2025-09 | drive sheet 202509 #5 |
| John Wahome | 6000 | KES | 2023-04-28 | drive sheet 2023-04 | drive sheet 202304 #15 |

## Verdict

**PASS**

Next action: run Pass 0 (quarantine the 0 poisoned rows, re-extract the Drive
monthly expenses correctly into KES, re-OCR bank debits, log historical gifts at market
FX, then rebuild the Finance surface). Do not start until the operator confirms this
baseline matches their understanding.
