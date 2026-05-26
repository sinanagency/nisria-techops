// One-off: LINK each monthly payroll obligation to its team member.
//
// Pay was seeded only as recurring "payroll" obligations in the `payments`
// table (keyed by payee NAME), so the Team page showed "no pay set" for
// everyone. This copies each payroll amount onto the member's HR record
// (team_members.pay_amount / pay_type='monthly' / pay_currency) so the Team
// directory and 360 show real pay. The payroll obligations stay put as the
// finance salary reminders. Idempotent: re-running just re-writes the same pay.
//
// Payee spellings don't always match member names exactly, so a small alias map
// reconciles the four known mismatches. Run: node scripts/backfill-pay.mjs
import fs from "node:fs";

const ENV = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => { const m = ENV.match(new RegExp(`^${k}=(.*)$`, "m")); return m ? m[1].trim().replace(/^"|"$/g, "").replace(/\\n$/, "") : ""; };
const URL_ = get("SUPABASE_URL"), KEY = get("SUPABASE_SERVICE_KEY");
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const rest = (p, init = {}) => fetch(`${URL_}/rest/v1/${p}`, { ...init, headers: { ...H, ...(init.headers || {}) } });

const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
// payroll-payee (normalised) -> member-name (normalised) for the known spelling drifts
const ALIAS = {
  "julia mwaniki": "julia mwanki",
  "monicah wanjira": "monica wanjira",
  "elizabeth kariuki": "eliza kariuki",
  "michell nyambura": "mitchelle nyambura",
};

const members = await (await rest("team_members?select=id,name")).json();
const payroll = await (await rest("payments?select=payee,amount,currency,category,recurrence&category=in.(payroll,salary)&recurrence=neq.none")).json();

const byName = new Map(members.map((m) => [norm(m.name), m]));
const resolve = (payee) => byName.get(ALIAS[norm(payee)] || norm(payee)) || null;

let matched = 0; const unmatched = [];
for (const p of payroll) {
  const m = resolve(p.payee);
  if (!m) { unmatched.push(p.payee); continue; }
  const u = await rest(`team_members?id=eq.${m.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ pay_amount: p.amount, pay_type: "monthly", pay_currency: p.currency || "KES" }),
  });
  if (!u.ok) { console.log("  ✗ write failed for", m.name, await u.text()); continue; }
  console.log(`  ✓ ${m.name.padEnd(22)} ← ${p.currency} ${p.amount}`);
  matched++;
}
console.log(`\nLinked ${matched}/${payroll.length} payroll rows to members.`);
if (unmatched.length) console.log("UNMATCHED payees (need an alias):", unmatched);
process.exit(unmatched.length ? 1 : 0);
