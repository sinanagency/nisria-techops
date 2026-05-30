#!/usr/bin/env python3
"""Import WhatsApp group chat exports into the messages table (sender_type=group).

Fills the gaps: the Admin group was already imported; this brings in the other
three groups with REAL per-message timestamps and each sender mapped to a contact
(so the chat reads like WhatsApp: who said what, when). Exports are text-only, so
media references ("image omitted" etc.) become readable placeholders; videos are
skipped per the rule. Idempotent: skips a group that already has messages.

Usage: SUPABASE_URL=... SUPABASE_SERVICE_KEY=... python3 import-wa-groups.py
"""
import os, re, sys, json, urllib.request, urllib.parse
from datetime import datetime, timezone

URL = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_KEY"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}

# export file -> the account name the group shows under in the app
EXPORTS = {
    "/tmp/waimport/Grants_&_Funds/_chat.txt": "Nisria Grants & Funds",
    "/tmp/waimport/Operations/_chat.txt":     "Maisha Operations",
    "/tmp/waimport/Social_Media/_chat.txt":   "Nisria Social Media",
}
OWNER = "nur"  # owner's name (lowercased contains-match) -> renders on the right

LINE = re.compile(r"^‎?\[(\d{1,2}/\d{1,2}/\d{4}), (\d{1,2}:\d{2}:\d{2})\s?([AP]M)\]\s([^:]+?):\s(.*)$")
SYS = ("Messages and calls are end-to-end encrypted", "created this group", "created group",
       "added", "left", "removed", "changed the subject", "changed this group's icon",
       "changed the group description", "joined using", "turned on", "turned off",
       "You're now an admin", "now an admin", "changed their phone number", "pinned a message",
       "changed to", "deleted this group", "You created this group", "This message was deleted",
       "security code changed", "changed the settings")
MEDIA = {  # marker substring -> readable placeholder (None = skip the message, e.g. video)
    "video omitted": None, "image omitted": "🖼️ Photo", "audio omitted": "🎙️ Voice note",
    "sticker omitted": "Sticker", "GIF omitted": "GIF", "document omitted": "📄 Document",
    "Contact card omitted": "Contact", "‎video omitted": None,
}

def http(method, path, body=None, extra=None):
    req = urllib.request.Request(URL + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={**H, **(extra or {})})
    with urllib.request.urlopen(req) as r:
        raw = r.read().decode()
        return json.loads(raw) if raw else None

def parse(path):
    msgs, cur = [], None
    for line in open(path, encoding="utf-8"):
        line = line.rstrip("\n")
        m = LINE.match(line)
        if m:
            if cur: msgs.append(cur)
            d, t, ap, sender, body = m.groups()
            try:
                dt = datetime.strptime(f"{d} {t} {ap}", "%d/%m/%Y %I:%M:%S %p").replace(tzinfo=timezone.utc)
            except ValueError:
                cur = None; continue
            sender = sender.lstrip("~ ").strip()
            cur = {"ts": dt.isoformat(), "sender": sender, "body": body}
        elif cur is not None:
            cur["body"] += "\n" + line
    if cur: msgs.append(cur)
    return msgs

def clean(m):
    """Return body or None to drop (system noise / video)."""
    b = m["body"].replace("‎", "").strip()
    if not b: return None
    for marker, repl in MEDIA.items():
        if marker.replace("‎", "") in b:
            return repl  # None drops it (video), else placeholder
    for s in SYS:
        if s in b: return None
    return b

def get_contacts():
    rows = http("GET", "/rest/v1/contacts?select=id,name&channel=eq.whatsapp&limit=2000") or []
    return {(r.get("name") or "").lower(): r["id"] for r in rows}

def main():
    contacts = get_contacts()
    for path, account in EXPORTS.items():
        if not os.path.exists(path):
            print(f"skip {account}: no file"); continue
        existing = http("GET", f"/rest/v1/messages?select=id&channel=eq.whatsapp&sender_type=eq.group&account=eq.{urllib.parse.quote(account)}&limit=1")
        if existing:
            print(f"skip {account}: already has messages"); continue
        parsed = parse(path)
        rows = []
        for m in parsed:
            body = clean(m)
            if body is None: continue
            name = m["sender"]
            key = name.lower()
            cid = contacts.get(key)
            if not cid:
                made = http("POST", "/rest/v1/contacts", [{"name": name, "channel": "whatsapp"}], {"Prefer": "return=representation"})
                cid = made[0]["id"]; contacts[key] = cid
            is_owner = OWNER in key
            rows.append({"channel": "whatsapp", "sender_type": "group", "account": account,
                         "direction": "out" if is_owner else "in", "body": body[:4000],
                         "status": "received", "handled_by": "import", "contact_id": cid,
                         "created_at": m["ts"]})
        # insert in chunks
        for i in range(0, len(rows), 200):
            http("POST", "/rest/v1/messages", rows[i:i+200], {"Prefer": "return=minimal"})
        print(f"imported {account}: {len(rows)} messages (from {len(parsed)} lines)")

if __name__ == "__main__":
    main()
