// Backfill the PUBLIC "nisria" community (announcement group) history into the
// messages table, up to the moment the live group bot was added. These are GROUP
// messages: sender_type='group', the group name in `account`, status='history',
// handled_by='backfill' so they never inflate "needs reply" counts or the inbox.
//
// ALIGNMENT IS CRITICAL. The live group bot already ingested 4 rows for this
// community tagged account='nisria' (handled_by='group-bot') from 30/05 15:15+.
// So the canonical label is the EXACT lowercase string 'nisria'. We backfill with
// that label so history + live messages thread into the SAME group on /groups.
//
// CUTOFF: only messages strictly BEFORE 2026-05-30 15:14:08 Nairobi (the moment
// "You added Nisria Group Bot"). The live bot owns everything at/after that, so
// backfilling it would double-count.
//
// IDEMPOTENT BUT SCOPED: deletes ONLY handled_by='backfill' AND account='nisria'
// before reinserting. NEVER a global backfill delete (that would wipe the 9327
// team-group rows). Safe to re-run.
//
// Reuses the proven parse/skip/alias/name-fold/contact logic from
// backfill-chat-history.mjs.
import fs from "node:fs";
import crypto from "node:crypto";

const P = "/Users/milaaj/Code/nisria-techops/platform";
const re = (f, k) => { const m = fs.readFileSync(P + "/" + f, "utf8").match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim().replace(/^"|"$/g, "") : ""; };
const BASE = re(".env.seed", "SUPABASE_URL").replace(/\/$/, "");
const SK = re(".env.seed", "SUPABASE_SERVICE_KEY");
if (!BASE || !SK) { console.error("MISSING SUPABASE creds in .env.seed"); process.exit(1); }
const H = { apikey: SK, Authorization: `Bearer ${SK}`, "Content-Type": "application/json" };
const api = (t) => `${BASE}/rest/v1/${t}`;

// canonical label = exact string the live bot tags this community with
const LABEL = "nisria";

// source export (LRM-stripped)
const SRC_CANDIDATES = [
  "/Users/milaaj/.claude/jobs/a3d0b847/tmp/nis/clean.txt",
  "/Users/milaaj/.claude/jobs/a3d0b847/tmp/nis/_chat.txt",
];
const SRC = SRC_CANDIDATES.find((p) => fs.existsSync(p));
if (!SRC) { console.error("MISSING source export. Re-unzip from ~/Downloads/WhatsApp Chat - nisria.zip"); process.exit(1); }

// CUTOFF: strictly before 30/05/2026 15:14:08 Nairobi (+03:00) == 12:14:08Z
const CUTOFF_MS = Date.parse("2026-05-30T15:14:08+03:00");

// chat-name -> team_member name, for senders whose chat handle differs.
// Map the org/Nur handles seen in this community export to Nur's member record.
const ALIAS = {
  "nisria": "Nur M'nasria",
  "nur": "Nur M'nasria",
  "shakshak": "Mohamed Hassan",
  "mama njambi": "Dorcas Njambi",
  "val": "Valentine Mwenja",
  "michell nyambura": "Mitchelle Nyambura",
  "conde yvans": "Conde Yvans",
  "haifa beseisso": "Haifa Beseisso",
};

const stripEmoji = (s) => s.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "").trim();
const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[‘’ʼ]/g, "'");
const norm = (s) => fold(stripEmoji(s)).replace(/^~\s*/, "").replace(/‎/g, "").trim().toLowerCase();

// WhatsApp system/structure noise + media placeholders -> skip. Superset of the
// original SKIP, with community-specific lines added (created the community,
// changed the community description/settings, turned on/off advanced chat privacy,
// assigned you as the new owner, joined using a community link / invite, You added,
// You removed, deactivated the group).
const SKIP = /(Messages and calls are end-to-end encrypted|added privacy for your phone number|created the community|created group|created this group|changed the community description|changed this community|changed the community|changed the subject|changed the group description|changed their phone number|changed this group|deactivated the group|allow everyone to add|allow members to|Welcome to the community|You're now an admin|assigned you as the new owner|is no longer a community admin|is now a community admin|turned on advanced chat privacy|turned off advanced chat privacy|turned on admin approval|added you|joined using|You added|You removed|removed you|left$|\bleft\b|\bremoved\b|pinned a message|security code with|<Media omitted>|image omitted|video omitted|audio omitted|sticker omitted|GIF omitted|document omitted|Contact card omitted|This message was deleted|You deleted this message|location: https)/i;

const LINE = /^\[(\d{2})\/(\d{2})\/(\d{4}), (\d{1,2}):(\d{2}):(\d{2})\s?([AP]M)\]\s([^:]+?):\s?(.*)$/;

function parse(file) {
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
      cur = { ts: iso, ms: Date.parse(iso), sender: sender.trim(), body: (body || "").replace(/‎/g, "").trim() };
    } else if (cur) {
      cur.body += "\n" + line.replace(/‎/g, "");
    }
  }
  if (cur) out.push(cur);
  return out;
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
let contactsCreated = 0;
async function getContact(sender) {
  const key = norm(sender);
  if (contactCache.has(key)) return contactCache.get(key);
  const tm = resolveTeam(sender);
  const displayName = tm ? tm.name : stripEmoji(sender).replace(/^~\s*/, "").trim();
  const found = await (await fetch(api(`contacts?select=id&channel=eq.whatsapp&name=eq.${encodeURIComponent(displayName)}&limit=1`), { headers: H })).json();
  let id = found?.[0]?.id;
  if (!id) {
    const ins = await fetch(api("contacts"), { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify({ name: displayName, phone: tm?.phone || null, channel: "whatsapp" }) });
    id = (await ins.json())?.[0]?.id;
    contactsCreated++;
  }
  contactCache.set(key, id);
  return id;
}

// ---- parse + filter ----
const all = parse(SRC);
console.log(`Parsed ${all.length} dated lines from ${SRC.split("/").pop()}`);
const msgs = all.filter((r) =>
  r.body &&
  !SKIP.test(r.body) &&
  r.body.replace(/[\s‎]/g, "").length > 0 &&
  Number.isFinite(r.ms) && r.ms < CUTOFF_MS
);
console.log(`Real human/org messages before cutoff (${new Date(CUTOFF_MS).toISOString()}): ${msgs.length}`);

// ---- SCOPED idempotent delete: only this community's backfill rows ----
console.log(`Clearing prior backfill rows for account='${LABEL}' ONLY...`);
const del = await fetch(api(`messages?handled_by=eq.backfill&account=eq.${encodeURIComponent(LABEL)}`), { method: "DELETE", headers: H });
console.log(`  delete status ${del.status}`);

// ---- build rows ----
let attributed = 0;
const senderHits = {};
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
    account: LABEL,
    external_id: "hist_" + crypto.createHash("sha1").update(`${LABEL}|${mi}|${msg.ts}|${msg.sender}`).digest("hex").slice(0, 24),
    created_at: msg.ts,
  });
}

// ---- insert in chunks of 500 ----
let total = 0;
for (let i = 0; i < batch.length; i += 500) {
  const chunk = batch.slice(i, i + 500);
  const r = await fetch(api("messages"), { method: "POST", headers: H, body: JSON.stringify(chunk) });
  if (!r.ok) { console.log("  INSERT FAIL", r.status, (await r.text()).slice(0, 300)); break; }
  total += chunk.length;
  process.stdout.write(`  inserted ${total}\r`);
}

const dates = msgs.map((m) => m.ts).sort();
console.log(`\n\nDone. account='${LABEL}'`);
console.log(`  parsed lines: ${all.length}`);
console.log(`  inserted messages: ${total}`);
console.log(`  contacts created: ${contactsCreated}`);
console.log(`  attributed to team members: ${attributed}`);
console.log(`  inserted date range: ${dates[0]} -> ${dates[dates.length - 1]}`);
console.log("\nSenders (count):");
for (const [s, n] of Object.entries(senderHits).sort((a, b) => b[1] - a[1])) console.log(`  ${n}\t${s}${resolveTeam(s) ? "  [team:" + resolveTeam(s).name + "]" : ""}`);
