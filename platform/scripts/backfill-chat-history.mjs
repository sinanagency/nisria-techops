// Backfill the four internal WhatsApp group exports into the messages table so
// every person's profile timeline is populated while we wait for the live group
// bot to start feeding new data. These are GROUP messages: tagged
// sender_type='group', the group name in `account`, status='history' and
// handled_by='backfill' so they NEVER inflate the "needs reply" counts or inbox.
//
// Each sender is attributed to a contact; where the sender maps to a team member
// (by name or a small alias map for nicknames) the contact carries that member's
// phone so live messages later thread to the same contact and the profile shows
// the history. Financial/beneficiary records are NOT created here (gated, per
// the money-truth doctrine); this is messages-for-timeline only.
//
// Idempotent: clears prior backfill rows (handled_by='backfill') then re-inserts.
import fs from "node:fs";
import crypto from "node:crypto";

const P = "/Users/milaaj/Code/nisria-techops/platform";
const re = (f, k) => { const m = fs.readFileSync(P + "/" + f, "utf8").match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim().replace(/^"|"$/g, "") : ""; };
const BASE = re(".env.seed", "SUPABASE_URL").replace(/\/$/, "");
const SK = re(".env.seed", "SUPABASE_SERVICE_KEY");
const H = { apikey: SK, Authorization: `Bearer ${SK}`, "Content-Type": "application/json" };
const api = (t) => `${BASE}/rest/v1/${t}`;

const CHATS = "/Users/milaaj/.claude/jobs/391a7ccf/tmp/nisria_chats";
const GROUPS = [
  ["Nisria • (Admin)", "Nisria Admin"],
  ["Maisha • Operations", "Maisha Operations"],
  ["Nisria • Grants & Funds", "Nisria Grants & Funds"],
  ["Nisria • Social Media", "Nisria Social Media"],
];

// chat-name -> team_member name, for senders whose chat handle differs
const ALIAS = {
  "shakshak": "Mohamed Hassan",
  "mama njambi": "Dorcas Njambi",
  "val": "Valentine Mwenja",
  "michell nyambura": "Mitchelle Nyambura",
  "conde yvans": "Conde Yvans",
  "haifa beseisso": "Haifa Beseisso",
};

const stripEmoji = (s) => s.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "").trim();
// fold accents (Condé -> Conde) and curly quotes (M’nasria -> M'nasria) so chat
// handles match the DB names regardless of glyph variant.
const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[‘’ʼ]/g, "'");
const norm = (s) => fold(stripEmoji(s)).replace(/^~\s*/, "").replace(/‎/g, "").trim().toLowerCase();

// lines that are WhatsApp system/structure noise or media placeholders -> skip
const SKIP = /(Messages and calls are end-to-end encrypted|created group|created this group|added you|added |left$| left\b|removed |joined using|changed the subject|changed this group|changed their phone number|changed the group description|You're now an admin|pinned a message|turned on admin approval|<Media omitted>|image omitted|video omitted|audio omitted|sticker omitted|GIF omitted|document omitted|Contact card omitted|This message was deleted|You deleted this message|null\b|location: https)/i;

const LINE = /^\[(\d{2})\/(\d{2})\/(\d{4}), (\d{1,2}):(\d{2}):(\d{2})\s?([AP]M)\]\s([^:]+?):\s?(.*)$/;

function parse(file, groupLabel) {
  const raw = fs.readFileSync(file, "utf8").replace(/\r/g, "");
  const out = [];
  let cur = null;
  for (const line of raw.split("\n")) {
    const m = line.match(LINE);
    if (m) {
      if (cur) out.push(cur);
      let [, dd, mm, yyyy, hh, mi, ss, ap, sender, body] = m;
      let h = parseInt(hh, 10) % 12; if (ap.toUpperCase() === "PM") h += 12;
      const iso = `${yyyy}-${mm}-${dd}T${String(h).padStart(2, "0")}:${mi}:${ss}+03:00`; // Nairobi time
      cur = { ts: iso, sender: sender.trim(), body: (body || "").replace(/‎/g, "").trim(), group: groupLabel };
    } else if (cur) {
      cur.body += "\n" + line.replace(/‎/g, "");
    }
  }
  if (cur) out.push(cur);
  return out.filter((r) => r.body && !SKIP.test(r.body) && r.body.replace(/[\s‎]/g, "").length > 0);
}

// ---- load team members for attribution ----
const team = await (await fetch(api("team_members?select=id,name,phone"), { headers: H })).json();
const teamByNorm = new Map();
for (const t of team) teamByNorm.set(norm(t.name), t);
function resolveTeam(sender) {
  const n = norm(sender);
  if (teamByNorm.has(n)) return teamByNorm.get(n);
  if (ALIAS[n] && teamByNorm.has(norm(ALIAS[n]))) return teamByNorm.get(norm(ALIAS[n]));
  return null;
}

// ---- contact cache (one per distinct sender name) ----
const contactCache = new Map();
async function getContact(sender) {
  const key = norm(sender);
  if (contactCache.has(key)) return contactCache.get(key);
  const tm = resolveTeam(sender);
  const displayName = tm ? tm.name : stripEmoji(sender).replace(/^~\s*/, "").trim();
  // find existing contact by name+channel
  const found = await (await fetch(api(`contacts?select=id&channel=eq.whatsapp&name=eq.${encodeURIComponent(displayName)}&limit=1`), { headers: H })).json();
  let id = found?.[0]?.id;
  if (!id) {
    const ins = await fetch(api("contacts"), { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify({ name: displayName, phone: tm?.phone || null, channel: "whatsapp" }) });
    id = (await ins.json())?.[0]?.id;
  }
  contactCache.set(key, id);
  return id;
}

// ---- clear prior backfill (idempotent) ----
console.log("Clearing prior backfill rows...");
await fetch(api("messages?handled_by=eq.backfill"), { method: "DELETE", headers: H });

// ---- parse + insert ----
let total = 0, attributed = 0;
const senderHits = {};
for (const [folder, label] of GROUPS) {
  const file = `${CHATS}/${folder}/_chat.txt`;
  if (!fs.existsSync(file)) { console.log("MISSING", file); continue; }
  const msgs = parse(file, label);
  console.log(`\n${label}: ${msgs.length} messages`);
  const batch = [];
  for (let mi = 0; mi < msgs.length; mi++) {
    const msg = msgs[mi];
    const contactId = await getContact(msg.sender);
    if (resolveTeam(msg.sender)) attributed++;
    senderHits[msg.sender] = (senderHits[msg.sender] || 0) + 1;
    batch.push({
      contact_id: contactId,
      channel: "whatsapp",
      direction: "in",
      body: msg.body.slice(0, 6000),
      handled_by: "backfill",
      status: "history",
      sender_type: "group",
      account: label,
      // per-group index guarantees a unique external_id (two identical short
      // messages in the same second would otherwise collide on uq_messages_external)
      external_id: "hist_" + crypto.createHash("sha1").update(`${label}|${mi}|${msg.ts}|${msg.sender}`).digest("hex").slice(0, 24),
      created_at: msg.ts,
    });
  }
  // insert in chunks
  for (let i = 0; i < batch.length; i += 500) {
    const chunk = batch.slice(i, i + 500);
    const r = await fetch(api("messages"), { method: "POST", headers: H, body: JSON.stringify(chunk) });
    if (!r.ok) { console.log("  INSERT FAIL", r.status, (await r.text()).slice(0, 200)); break; }
    total += chunk.length;
    process.stdout.write(`  inserted ${total}\r`);
  }
}
console.log(`\n\nDone. ${total} messages inserted, ${attributed} attributed to team members.`);
const unmatched = Object.entries(senderHits).filter(([s]) => !resolveTeam(s)).sort((a, b) => b[1] - a[1]).slice(0, 12);
console.log("Top senders with NO team match (external/community, contact-only):");
for (const [s, n] of unmatched) console.log(`  ${n}  ${s}`);
