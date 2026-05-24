#!/usr/bin/env python3
"""
sync_givebutter.py — pull Givebutter (campaigns, transactions, recurring plans)
into the Nisria Supabase brain so the Command Center shows real data.

Keys from macOS Keychain: bu-givebutter-key, bu-supabase-token.
SQL runs via the Supabase Management API (curl, which bypasses the CF block on urllib).
Idempotent: campaigns upsert by name, donations dedupe on Givebutter txn id.
"""
import json, subprocess, sys

REF = "ptvhqudonvvszupzhcfl"
SB_URL = f"https://api.supabase.com/v1/projects/{REF}/database/query"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"

def kc(label):
    return subprocess.run(["security", "find-generic-password", "-l", label, "-w"],
                          capture_output=True, text=True).stdout.strip()

GB = kc("bu-givebutter-key")
SB = kc("bu-supabase-token")

def sql(q):
    payload = json.dumps({"query": q})
    p = subprocess.run(["curl", "-s", "-X", "POST", SB_URL,
        "-H", f"Authorization: Bearer {SB}", "-H", "Content-Type: application/json",
        "-A", UA, "--data", "@-"], input=payload, capture_output=True, text=True)
    try:
        return json.loads(p.stdout)
    except Exception:
        print("SQL ERR:", p.stdout[:300]); return None

def gb_all(path):
    out, page = [], 1
    while True:
        p = subprocess.run(["curl", "-s", "-H", f"Authorization: Bearer {GB}", "-H", "Accept: application/json",
                            f"https://api.givebutter.com/v1/{path}?page={page}&per_page=100"], capture_output=True, text=True)
        d = json.loads(p.stdout)
        out += d.get("data", [])
        meta = d.get("meta", {})
        if page >= meta.get("last_page", 1) or not d.get("data"):
            break
        page += 1
    return out

E = lambda s: "NULL" if s is None or s == "" else "'" + str(s).replace("'", "''") + "'"
N = lambda x: "NULL" if x in (None, "") else str(float(x))

def main():
    brand = sql("select id from brands where slug='nisria';")[0]["id"]
    # clear demo fundraising rows so only real data shows
    sql("delete from donations where external_id like 'DEMO%'; delete from donors where email='demo.donor@example.com'; delete from beneficiaries where ref_code like 'DEMO%'; delete from campaigns where name='Back to School 2026';")

    camps = gb_all("campaigns")
    txns = gb_all("transactions")
    plans = gb_all("plans")
    plan_emails = {(p.get("email") or "").lower() for p in plans if p.get("status") == "active"}
    print(f"Givebutter: {len(camps)} campaigns, {len(txns)} transactions, {len(plans)} plans")

    # campaigns upsert by name
    for c in camps:
        title = c.get("title"); status = "live" if c.get("status") == "active" else "planned"
        sql(f"""update campaigns set goal_amount={N(c.get('goal'))}, raised_amount={N(c.get('raised'))}, status='{status}', givebutter_id={E(c.get('id'))} where name={E(title)};
        insert into campaigns (brand_id,name,goal_amount,raised_amount,status,givebutter_id)
        select '{brand}',{E(title)},{N(c.get('goal'))},{N(c.get('raised'))},'{status}',{E(c.get('id'))}
        where not exists (select 1 from campaigns where name={E(title)});""")
    camp_map = {r["name"]: r["id"] for r in sql("select id,name from campaigns;")}

    # donors from transactions (dedupe by email)
    existing = {(r["email"] or "").lower() for r in sql("select email from donors where email is not null;")}
    seen, donor_rows = set(), []
    for t in txns:
        em = (t.get("email") or "").lower()
        if not em or em in existing or em in seen:
            continue
        seen.add(em)
        name = (f"{t.get('first_name','')} {t.get('last_name','')}").strip() or (t.get("giving_space") or {}).get("name") or "Donor"
        recur = "true" if em in plan_emails else "false"
        donor_rows.append(f"({E(name)},{E(em)},'givebutter','active')")
    if donor_rows:
        sql("insert into donors (full_name,email,source,status) values " + ",".join(donor_rows) + ";")
    email_to_id = {(r["email"] or "").lower(): r["id"] for r in sql("select id,email from donors where email is not null;")}

    # donations dedupe on external_id
    drows = []
    for t in txns:
        em = (t.get("email") or "").lower()
        did = email_to_id.get(em)
        cid = camp_map.get(t.get("campaign_title"))
        recur = "true" if (em in plan_emails) else "false"
        drows.append(f"({E(t.get('id'))},{(E(did) if did else 'NULL')},{(E(cid) if cid else 'NULL')},'{brand}',{N(t.get('amount'))},'givebutter','{t.get('status','succeeded')}',{recur},{E(t.get('created_at'))})")
    if drows:
        sql("""insert into donations (external_id,donor_id,campaign_id,brand_id,amount,channel,status,is_recurring,donated_at) values """
            + ",".join(drows) + " on conflict (external_id) where external_id is not null do nothing;")

    res = sql("select (select count(*) from donors) donors,(select count(*) from donations) donations,(select coalesce(sum(amount),0) from donations where status='succeeded') raised,(select count(*) from campaigns) campaigns;")
    print("AFTER SYNC:", res)

if __name__ == "__main__":
    main()
