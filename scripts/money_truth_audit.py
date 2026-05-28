#!/usr/bin/env python3
"""
money-truth-auditor (read-only). Implements .claude/agents/money-truth-auditor.md.

Queries the LIVE Supabase database for Law 1 (Source-of-truth) and Law 2 (Currency)
violations in finance data and writes a baseline report. NEVER writes to any table.
Run at the start AND end of Pass 0; the Pass 0 proof template references its output.

Usage: python3 scripts/money_truth_audit.py
Writes: docs/baselines/money-truth-baseline-<YYYY-MM-DD>.md
"""
import json, subprocess, sys, os, datetime

REF = "ptvhqudonvvszupzhcfl"
API = f"https://api.supabase.com/v1/projects/{REF}/database/query"
TOKEN = subprocess.check_output(
    ["security", "find-generic-password", "-s", "bu-supabase-token", "-w"]
).decode().strip()


def q(sql):
    out = subprocess.check_output([
        "curl", "-s", "-X", "POST", API,
        "-H", f"Authorization: Bearer {TOKEN}",
        "-H", "Content-Type: application/json",
        "-H", "User-Agent: money-truth-auditor",
        "-d", json.dumps({"query": sql}),
    ]).decode()
    data = json.loads(out)
    if isinstance(data, dict) and data.get("error"):
        sys.exit(f"DB connection/query failure, stopping (no invented numbers): {data}")
    return data


def one(sql, key):
    r = q(sql)
    return r[0][key] if r else None


kes_as_usd_don = one("select count(*) c from donations where currency='USD' and amount>1000000;", "c")
kes_as_usd_pay = one("select count(*) c from payments where currency='USD' and amount>1000000;", "c")
untagged_don = one("select count(*) c from donations where currency is null or currency='';", "c")
untagged_pay = one("select count(*) c from payments where currency is null or currency='';", "c")
poisoned = one("select count(*) c from payments where created_by='drive monthly history' and currency='USD';", "c")
don_no_source = one("select count(*) c from donations where external_id is null and channel<>'manual';", "c")

bank = q("""select account,
  count(*) filter (where direction='in') as credits,
  count(*) filter (where direction='out') as debits,
  min(txn_date) as first, max(txn_date) as last
  from bank_transactions group by account order by account;""")

staging = q("select status, confidence, count(*) as n from extraction_staging group by status, confidence order by status, confidence;")

# how bad is the USD payment poisoning, in one number
usd_pay_total = one("select coalesce(round(sum(amount)::numeric,0),0) s from payments where direction='out' and currency='USD';", "s")
usd_pay_sane = one("select coalesce(round(sum(amount)::numeric,2),0) s from payments where direction='out' and currency='USD' and amount<=1000000;", "s")

# true KES picture (trustworthy side)
kes_pay_paid = one("select coalesce(round(sum(amount)::numeric,0),0) s from payments where direction='out' and currency='KES' and status='paid';", "s")
don_usd = one("select coalesce(round(sum(amount)::numeric,2),0) s from donations where currency='USD' and status='succeeded';", "s")
don_kes = one("select coalesce(round(sum(amount)::numeric,0),0) s from donations where currency='KES' and status='succeeded';", "s")

spot_don = q("""select d.amount, d.currency, d.donated_at::date as donated_at, d.external_id, c.name as campaign
  from donations d left join campaigns c on d.campaign_id=c.id
  where d.currency='USD' order by random() limit 10;""")
spot_pay = q("""select payee, amount, currency, paid_at::date as paid_at, created_by, ref
  from payments where currency='KES' order by random() limit 10;""")

missing_debits = [b["account"] for b in bank if int(b["debits"] or 0) == 0]
violations = sum(int(x or 0) for x in [kes_as_usd_don, kes_as_usd_pay, untagged_don, untagged_pay, poisoned]) + len(missing_debits)
verdict = "PASS" if violations == 0 else f"FAIL with {violations} total violations"
stamp = datetime.date.today().isoformat()


def tbl(rows, cols):
    if not rows:
        return "_none_\n"
    head = "| " + " | ".join(cols) + " |\n| " + " | ".join("---" for _ in cols) + " |\n"
    body = ""
    for r in rows:
        body += "| " + " | ".join(str(r.get(c, "")) for c in cols) + " |\n"
    return head + body


md = f"""# Money Truth Audit

Date: {stamp}
Run by: money-truth-auditor (scripts/money_truth_audit.py)
Database: Supabase project {REF}
Mode: read-only (no writes, no deletes, no mutations)

## Law 2 violations (Currency)

- KES rows as USD (donations, amount > 1,000,000): **{kes_as_usd_don}**
- KES rows as USD (payments, amount > 1,000,000): **{kes_as_usd_pay}**
- Untagged currency (donations): **{untagged_don}**
- Untagged currency (payments): **{untagged_pay}**

## Law 1 violations (Source-of-truth)

- Drive monthly history poisoned rows (created_by='drive monthly history', currency='USD'): **{poisoned}**  _(target after Pass 0: 0)_
- Donations with no source (external_id null and channel != 'manual'): **{don_no_source}**
- Bank accounts missing debits: **{', '.join(missing_debits) if missing_debits else 'none'}**

### Bank transactions by account
{tbl(bank, ['account','credits','debits','first','last'])}
### Extraction staging health
{tbl(staging, ['status','confidence','n'])}
## The damage in one figure

- USD payments-out total as stored: **{usd_pay_total}** (this is the poisoned, impossible number)
- USD payments-out total of only the sane rows (amount <= 1,000,000): **{usd_pay_sane}**
- The gap between those two is the corruption.

## The trustworthy side (for reference, not a clean total)

- Donations USD (succeeded): **${don_usd}**
- Donations KES (succeeded): **{don_kes} KES**
- Payments out KES (paid): **{kes_pay_paid} KES**
- Note: these are NOT summed across currencies. Per the Currency Law, a blended total requires market FX and is built in Pass 0.

## Spot check: 10 random USD donations
{tbl(spot_don, ['amount','currency','donated_at','external_id','campaign'])}
## Spot check: 10 random KES payments
{tbl(spot_pay, ['payee','amount','currency','paid_at','created_by','ref'])}
## Verdict

**{verdict}**

Next action: run Pass 0 (quarantine the {poisoned} poisoned rows, re-extract the Drive
monthly expenses correctly into KES, re-OCR bank debits, log historical gifts at market
FX, then rebuild the Finance surface). Do not start until the operator confirms this
baseline matches their understanding.
"""

os.makedirs("docs/baselines", exist_ok=True)
path = f"docs/baselines/money-truth-baseline-{stamp}.md"
with open(path, "w") as f:
    f.write(md)

print("MONEY TRUTH AUDIT")
print(f"  KES-as-USD donations:        {kes_as_usd_don}")
print(f"  KES-as-USD payments:         {kes_as_usd_pay}")
print(f"  Untagged donations:          {untagged_don}")
print(f"  Untagged payments:           {untagged_pay}")
print(f"  Poisoned drive-history rows: {poisoned}  (target after Pass 0: 0)")
print(f"  Donations with no source:    {don_no_source}")
print(f"  Bank accounts missing debits:{missing_debits}")
print(f"  USD payments total (stored): {usd_pay_total}")
print(f"  USD payments total (sane):   {usd_pay_sane}")
print(f"  VERDICT: {verdict}")
print(f"  wrote {path}")
