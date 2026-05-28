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
- Payments out KES (paid): **43556304 KES**
- Note: these are NOT summed across currencies. Per the Currency Law, a blended total requires market FX and is built in Pass 0.

## Spot check: 10 random USD donations
| amount | currency | donated_at | external_id | campaign |
| --- | --- | --- | --- | --- |
| 50.00 | USD | 2025-09-01 | SsQcHYpKp1BDzjqG | One of 500 |
| 100.00 | USD | 2026-02-01 | 6kPgLJn6TnxDkfZb | One of 500 |
| 2500.00 | USD | 2025-09-09 | xVAl2cicsmZnbY3t | One of 500 |
| 100.00 | USD | 2026-02-01 | WPGOKSl2IOKB8hEe | One of 500 |
| 46.50 | USD | 2025-09-27 | dlTpn36bywIZDGSm | One of 500 |
| 80.00 | USD | 2026-04-04 | 5t8jwZKdhDZwJyjl | One of 500 |
| 25.00 | USD | 2026-04-30 | QVYs448Iifg6flbL | One of 500 |
| 100.00 | USD | 2026-01-17 | vyJvjYezBJa4y0ti | One of 500 |
| 300.00 | USD | 2025-03-25 | SPME2EAE7FVFrH7a | One of 500 |
| 100.00 | USD | 2025-09-15 | nzkGjG9tD67CjpQL | One of 500 |

## Spot check: 10 random KES payments
| payee | amount | currency | paid_at | created_by | ref |
| --- | --- | --- | --- | --- | --- |
| Garbage Collection | None | KES | 2024-12-28 | drive monthly history | drive monthly history 2024-12 $#46 [QUARANTINED 2026-05-29 amount unparseable, re-extract from Drive] |
| Tahleel Dafalla | 30000 | KES | 2025-06-28 | drive monthly history | drive monthly history 2025-06 #6 |
| Mburu Paul | 35000 | KES | 2025-01-28 | drive monthly history | drive monthly history 2025-01 #1 |
| Mburu Paul | 35000 | KES | 2024-11-28 | drive monthly history | drive monthly history 2024-11 #1 |
| Veronica Masaka | 12000 | KES | None | 2026-05 monthly import | 2026-05 monthly import |
| Garbage Collection | 2000 | KES | 2024-12-28 | drive monthly history | drive monthly history 2024-12 #45 |
| Asande | 35000 | KES | 2023-06-28 | drive monthly history | drive monthly history 2023-06 #9 |
| Monicah Wanjira | 5000 | KES | 2023-11-28 | drive monthly history | drive monthly history 2023-11 #42 |
| John Njuguna | 5000 | KES | 2023-11-28 | drive monthly history | drive monthly history 2023-11 #13 |
| Cecilia Muthoni | 5000 | KES | 2024-12-28 | drive monthly history | drive monthly history 2024-12 #27 |

## Verdict

**PASS**

Next action: run Pass 0 (quarantine the 0 poisoned rows, re-extract the Drive
monthly expenses correctly into KES, re-OCR bank debits, log historical gifts at market
FX, then rebuild the Finance surface). Do not start until the operator confirms this
baseline matches their understanding.
