#!/usr/bin/env python3
"""
sync_inbox.py — pull REAL emails from the Nisria mailboxes into Supabase so the
Command Center Inbox shows live mail (not demo data). Uses IMAP (app passwords)
+ the Supabase Management API. Idempotent: dedupes on the email Message-ID.

Mailboxes: sasa@nisria.co, maisha@nisria.co  (Gmail IMAP, app passwords in Keychain)
"""
import imaplib, email, json, subprocess, sys
from email.header import decode_header
from email.utils import parseaddr, parsedate_to_datetime

REF = "ptvhqudonvvszupzhcfl"
SB_URL = f"https://api.supabase.com/v1/projects/{REF}/database/query"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
PER_BOX = 25  # most-recent N per mailbox

MBOXES = [
    ("sasa@nisria.co", "bu-sasa-gmail-apppass"),
    ("maisha@nisria.co", "bu-maisha-gmail-apppass"),
]

def kc(label):
    return subprocess.run(["security","find-generic-password","-l",label,"-w"],
                          capture_output=True, text=True).stdout.strip()

SB = kc("bu-supabase-token")

def sql(q):
    p = subprocess.run(["curl","-s","-X","POST",SB_URL,
        "-H",f"Authorization: Bearer {SB}","-H","Content-Type: application/json",
        "-A",UA,"--data","@-"], input=json.dumps({"query":q}), capture_output=True, text=True)
    try: return json.loads(p.stdout)
    except Exception: print("SQL ERR:", p.stdout[:300]); return None

def dh(s):
    if not s: return ""
    out=[]
    for txt,enc in decode_header(s):
        out.append(txt.decode(enc or "utf-8","ignore") if isinstance(txt,bytes) else txt)
    return "".join(out)

def body_of(msg):
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type()=="text/plain" and "attachment" not in str(part.get("Content-Disposition")):
                try: return part.get_payload(decode=True).decode(part.get_content_charset() or "utf-8","ignore")
                except Exception: pass
        return ""
    try: return msg.get_payload(decode=True).decode(msg.get_content_charset() or "utf-8","ignore")
    except Exception: return ""

E = lambda s: "NULL" if s in (None,"") else "'" + str(s).replace("'","''") + "'"

def fetch_box(user, app_pass):
    rows=[]
    try:
        M = imaplib.IMAP4_SSL("imap.gmail.com")
        M.login(user, app_pass)
        M.select("INBOX")
        typ, data = M.search(None, "ALL")
        ids = data[0].split()[-PER_BOX:]
        for i in reversed(ids):
            typ, md = M.fetch(i, "(BODY.PEEK[])")
            if not md or not md[0]: continue
            msg = email.message_from_bytes(md[0][1])
            name, addr = parseaddr(msg.get("From",""))
            try: dt = parsedate_to_datetime(msg.get("Date")).isoformat()
            except Exception: dt = None
            rows.append({
                "to": user,
                "name": dh(name) or (addr.split("@")[0] if addr else "Unknown"),
                "addr": addr.lower(),
                "subject": dh(msg.get("Subject",""))[:300],
                "body": (body_of(msg) or "").strip()[:1500],
                "msgid": (msg.get("Message-ID","") or f"{user}-{i.decode()}").strip()[:400],
                "date": dt,
            })
        M.logout()
    except Exception as e:
        print(f"IMAP ERR {user}: {e}")
    return rows

def main():
    all_rows=[]
    for user, lbl in MBOXES:
        ap = kc(lbl)
        got = fetch_box(user, ap)
        print(f"{user}: fetched {len(got)}")
        all_rows += got
    if not all_rows:
        print("no emails fetched"); return

    # contacts: unique by sender addr (skip blanks)
    existing = {(r.get("email") or "").lower() for r in (sql("select email from contacts where email is not null;") or [])}
    seen=set(); crows=[]
    for r in all_rows:
        a=r["addr"]
        if not a or a in existing or a in seen: continue
        seen.add(a); crows.append(f"({E(r['name'])},{E(a)},'email')")
    if crows:
        sql("insert into contacts (name,email,channel) values " + ",".join(crows) + ";")
    cmap={(r["email"] or "").lower():r["id"] for r in (sql("select id,email from contacts where email is not null;") or [])}

    # messages: dedupe on external_id (Message-ID)
    mrows=[]
    for r in all_rows:
        cid=cmap.get(r["addr"])
        if not cid: continue
        mrows.append(f"({E(cid)},'email','in',{E(r['subject'])},{E(r['body'])},{E(r['msgid'])},'pending','new',{E(r['date'])})")
    if mrows:
        sql("insert into messages (contact_id,channel,direction,subject,body,external_id,handled_by,status,created_at) values "
            + ",".join(mrows) + " on conflict (external_id) where external_id is not null do nothing;")

    res = sql("select count(*) msgs,(select count(*) from contacts) contacts from messages;")
    print("AFTER SYNC:", res)

if __name__ == "__main__":
    main()
