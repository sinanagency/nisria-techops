#!/usr/bin/env python3
"""
Pass 0 · money truth · quarantine the 'drive monthly history' currency corruption.

Per HOW-WE-BUILD Pass 0 and the Source-of-truth + Currency + Honesty laws.

The drive-monthly-history backfill mis-tagged 226 Kenyan expense rows as USD.
  - 46 have sane amounts (105 to 50,000): pure currency mislabel. Fix: USD -> KES.
  - 180 have impossible amounts (parse debris, up to 5e21): unrecoverable from code.
    The true amounts live only in the Drive source sheets. Fix: quarantine reversibly
    (currency -> KES, amount -> NULL, status -> 'void', ref flagged) so they stop
    poisoning every total, pending a clean re-extraction from Drive.

Reversible: the full original 226 rows are snapshotted to docs/baselines/ before any write.
Read the snapshot to restore. NEVER fabricates an amount.
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
        "-H", "User-Agent: pass0-quarantine",
        "-d", json.dumps({"query": sql}),
    ]).decode()
    data = json.loads(out)
    if isinstance(data, dict) and data.get("error"):
        sys.exit(f"DB error, aborting (no partial writes assumed): {data}")
    return data


stamp = datetime.date.today().isoformat()

# 1. SNAPSHOT all 226 rows before any write (reversibility)
snap = q("""
select id, payee, purpose, amount::text as amount, currency, status,
       paid_at::text as paid_at, due_on::text as due_on, ref, created_by, category
from payments
where created_by = 'drive monthly history' and currency = 'USD'
order by paid_at, ref;
""")
os.makedirs("docs/baselines", exist_ok=True)
snap_path = f"docs/baselines/pass-0-quarantine-snapshot-{stamp}.json"
with open(snap_path, "w") as f:
    json.dump(snap, f, indent=2)
print(f"snapshot: {len(snap)} rows saved to {snap_path}")

if not snap:
    print("nothing to quarantine (already clean). exiting.")
    sys.exit(0)

# 2. QUARANTINE the 180 garbage-amount rows (reversible, flagged)
garbage = q("""
update payments
set currency = 'KES',
    amount = null,
    status = 'void',
    ref = coalesce(ref, '') || ' [QUARANTINED """ + stamp + """ amount unparseable, re-extract from Drive]'
where created_by = 'drive monthly history' and currency = 'USD' and amount > 1000000
returning id;
""")
print(f"quarantined (garbage amounts, voided + flagged): {len(garbage)}")

# 3. CORRECT the 46 sane rows: currency mislabel only, amounts retained
sane = q("""
update payments
set currency = 'KES'
where created_by = 'drive monthly history' and currency = 'USD' and amount <= 1000000
returning id;
""")
print(f"corrected (USD -> KES, amount kept): {len(sane)}")

# 4. VERIFY: zero drive-history USD rows remain; USD payments total no longer poisoned
remain = q("select count(*) c from payments where created_by='drive monthly history' and currency='USD';")[0]["c"]
usd_total = q("select coalesce(round(sum(amount)::numeric,2),0) s from payments where direction='out' and currency='USD';")[0]["s"]
voided = q("select count(*) c from payments where status='void';")[0]["c"]
print(f"remaining drive-history USD rows: {remain}  (target 0)")
print(f"USD payments-out total now: {usd_total}  (was 1.3e23)")
print(f"total voided/quarantined rows: {voided}")
print("done.")
