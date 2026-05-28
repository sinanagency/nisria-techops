# Money Truth Audit

Date: 2026-05-29
Run by: money-truth-auditor (scripts/money_truth_audit.py)
Database: Supabase project ptvhqudonvvszupzhcfl
Mode: read-only (no writes, no deletes, no mutations)

## Law 2 violations (Currency)

- KES rows as USD (donations, amount > 1,000,000): **0**
- KES rows as USD (payments, amount > 1,000,000): **180**
- Untagged currency (donations): **0**
- Untagged currency (payments): **0**

## Law 1 violations (Source-of-truth)

- Drive monthly history poisoned rows (created_by='drive monthly history', currency='USD'): **226**  _(target after Pass 0: 0)_
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

- USD payments-out total as stored: **129686595276895169160429** (this is the poisoned, impossible number)
- USD payments-out total of only the sane rows (amount <= 1,000,000): **364546.30**
- The gap between those two is the corruption.

## The trustworthy side (for reference, not a clean total)

- Donations USD (succeeded): **$26482.61**
- Donations KES (succeeded): **14827776 KES**
- Payments out KES (paid): **43219409 KES**
- Note: these are NOT summed across currencies. Per the Currency Law, a blended total requires market FX and is built in Pass 0.

## Spot check: 10 random USD donations
| amount | currency | donated_at | external_id | campaign |
| --- | --- | --- | --- | --- |
| 1.00 | USD | 2025-05-14 | 6OiDGtBhJSPuFpxB | One of 500 |
| 100.00 | USD | 2025-09-27 | 6bhm2rjJKPHbXX0z | One of 500 |
| 62.50 | USD | 2026-01-29 | EFPHb1QysgZSOXfQ | One of 500 |
| 100.00 | USD | 2025-09-01 | pPvVA6ckXjx2zs4f | One of 500 |
| 100.00 | USD | 2025-12-01 | ynL31FAuPLu61qkv | One of 500 |
| 100.00 | USD | 2026-02-01 | WPGOKSl2IOKB8hEe | One of 500 |
| 10.00 | USD | 2025-09-01 | VRt8J7eAHZPOUnXX | One of 500 |
| 100.00 | USD | 2025-10-01 | mRhcyxpQHSq7WlwC | One of 500 |
| 200.00 | USD | 2025-09-01 | N9Hi8KEK3MvOLKQi | One of 500 |
| 50.00 | USD | 2025-09-04 | JnUR8nn6j8jlUz3Q | One of 500 |

## Spot check: 10 random KES payments
| payee | amount | currency | paid_at | created_by | ref |
| --- | --- | --- | --- | --- | --- |
| Mark Njambi | 5000 | KES | 2025-06-28 | drive monthly history | drive monthly history 2025-06 #16 |
| Eric | 5000 | KES | 2024-09-28 | drive monthly history | drive monthly history 2024-09 #34 |
| Water | 3500 | KES | 2026-04-28 | drive monthly history | drive monthly history 2026-04 #30 |
| Prints - Dubai | 50000 | KES | 2025-03-28 | drive monthly history | drive monthly history 2025-03 #48 |
| Total | 532100 | KES | 2025-05-28 | drive monthly history | drive monthly history 2025-05 #39 |
| Grace | 20000 | KES | 2023-04-28 | drive monthly history | drive monthly history 2023-04 #3 |
| Cynthia | 35000 | KES | 2023-03-28 | drive monthly history | drive monthly history 2023-03 #7 |
| Electricity | 7000 | KES | 2024-10-28 | drive monthly history | drive monthly history 2024-10 #38 |
| Gedion Maina | 400240 | KES | 2023-04-28 | drive monthly history | drive monthly history 2023-04 #35 |
| Maggie | 3500 | KES | 2024-08-28 | drive monthly history | drive monthly history 2024-08 #39 |

## Verdict

**FAIL with 406 total violations**

Next action: run Pass 0 (quarantine the 226 poisoned rows, re-extract the Drive
monthly expenses correctly into KES, re-OCR bank debits, log historical gifts at market
FX, then rebuild the Finance surface). Do not start until the operator confirms this
baseline matches their understanding.
