// One-time (idempotent) reclassification sweep.
//
// The sender_type column is written by the out-of-repo Gmail sync, which mis-stamps
// marketing/transactional/calendar mail as 'individual' (PayPal, Charity Navigator,
// I&M, Goodstack, calendar-invite acceptances, automated reminders...). Those leak
// into the Workspace "humans only" rail. This sweep applies the SAME authority the
// UI uses (lib/email-render.isAutomatedSender) to every inbound row and corrects the
// mismatches to sender_type='automated', status='archived'.
//
// Safe: only ever flips rows the authority says are automated. Never touches a row
// it considers human. Re-runnable. Reads creds from the platform env.
//
//   node scripts/reclassify-automated.mjs           # apply
//   node scripts/reclassify-automated.mjs --dry      # report only, no writes

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!URL || !KEY) { console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_KEY"); process.exit(1); }
const DRY = process.argv.includes("--dry");

// Mirror of lib/email-render.ts (kept in sync by hand; this is a maintenance script).
const AUTOMATED = /(no-?reply|do-?not-?reply|notify|notification|notifications|mailer|postmaster|accounts@|updates@|automated|team@|support@|service@|billing@|payments?@|receipts?@|news@|newsletter|marketing@|hello@|info(rmation)?@|@notify|@mail\d?\.|@em\.|@e\.|donotreply|paypal|stripe|givebutter|donorbox|railway|kuja|goodstack|charitynavigator|comments-noreply|calendar-notification|notifications\.google|via google)/i;
const AUTOMATED_CONTENT = /(has accepted this invitation|has declined this invitation|requests access to an item|added a comment to the following|replied to a comment in the following|new activity in the following document|this is your reminder|your weekly report|unsubscribe|view (?:this email|it) in your browser|complete profile|enrol for the session|update your (?:email )?preferences|you are receiving this (?:email|because))/i;
function isAutomatedSender(name, email, sample) {
  const who = `${name || ""} ${email || ""}`;
  if (AUTOMATED.test(who)) return true;
  if (sample && AUTOMATED_CONTENT.test(sample)) return true;
  return false;
}

const h = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

async function main() {
  const res = await fetch(`${URL}/rest/v1/messages?select=id,sender_type,status,subject,body,channel,contact:contacts(name,email)&direction=eq.in&limit=2000`, { headers: h });
  const rows = await res.json();
  if (!Array.isArray(rows)) { console.error("Unexpected response:", JSON.stringify(rows).slice(0, 300)); process.exit(1); }

  let flipped = 0, alreadyOk = 0, humansKept = 0;
  const changes = [];
  for (const m of rows) {
    const c = m.contact || {};
    // WhatsApp is a person-to-person channel; never auto-archive it here.
    if (m.channel && m.channel !== "email") { humansKept++; continue; }
    const sample = `${m.subject || ""} ${(m.body || "").slice(0, 400)}`;
    const auto = isAutomatedSender(c.name, c.email, sample);
    if (!auto) { humansKept++; continue; }
    if (m.sender_type === "automated" && m.status === "archived") { alreadyOk++; continue; }
    changes.push({ id: m.id, who: `${c.name || "?"} <${c.email || ""}>`, was: `${m.sender_type}/${m.status}` });
    if (!DRY) {
      const u = await fetch(`${URL}/rest/v1/messages?id=eq.${m.id}`, { method: "PATCH", headers: { ...h, Prefer: "return=minimal" }, body: JSON.stringify({ sender_type: "automated", status: "archived" }) });
      if (!u.ok) { console.error("PATCH failed", m.id, u.status, await u.text()); continue; }
    }
    flipped++;
  }

  console.log(`Scanned ${rows.length} inbound. ${DRY ? "WOULD reclassify" : "Reclassified"} ${flipped} → automated/archived. Already correct: ${alreadyOk}. Kept human: ${humansKept}.`);
  for (const ch of changes) console.log(`  ${DRY ? "would flip" : "flipped"}: ${ch.who} (${ch.was})`);
}
main().catch((e) => { console.error(e); process.exit(1); });
