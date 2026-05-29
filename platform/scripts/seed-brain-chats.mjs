// Seed the Brain (agent_memory) with knowledge that lives ONLY in the four
// internal WhatsApp team chats and is NOT already covered by the Drive-extracted
// org_facts: who has left the team and why, how the team actually operates
// (cadence and rules), the field-ops glossary, and verbatim examples of Nur's
// voice. Idempotent: each row is keyed by metadata.slug, so a re-run replaces in
// place (delete-by-slug then insert) instead of piling up duplicates.
//
// No em-dashes (doctrine). No leaked credentials. KES and USD never summed.
// Source: WhatsApp exports Admin / Maisha Operations / Grants & Funds / Social
// Media, Aug 2021 to May 2026, analysed 2026-05-29.
import fs from "node:fs";

const ENV = "/Users/milaaj/Code/nisria-techops/platform/.env.seed";
const env = fs.readFileSync(ENV, "utf8");
const get = (k) => { const m = env.match(new RegExp(`^${k}=(.*)$`, "m")); return m ? m[1].trim().replace(/^"|"$/g, "") : ""; };
const BASE = get("SUPABASE_URL").replace(/\/$/, "");
const KEY = get("SUPABASE_SERVICE_KEY");
const api = `${BASE}/rest/v1/agent_memory`;
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

const SRC = "whatsapp-chats";

const rows = [
  {
    kind: "org_fact",
    brand: null,
    title: "Team history and who has left",
    content:
      "Current roster lives in team_members. People who are FORMER and must not be assigned work, payments, or treated as current: " +
      "Paul Mburu was the operations manager and field social worker in Gilgil from 2023 and exited in January 2026 after a dispute; his access was revoked and the matter went to a lawyer, so do not route tasks, payments, or contacts to him. " +
      "The founding creative team built the brand from 2021 to mid 2023 and was released in the July 2023 restructure when operations moved to the Kenyan field team: Mohamed Hassan (known as Shakshak, photographer and videographer), Hany Khalifa (video editor), Nour El Massry (illustrator), and Tawfiq (social consultant). " +
      "Others who have since rotated off: Conde Yvans (lead designer, to 2025), Beth Wangui (admin and embroidery, to 2025), Valentine Mwenja known as Val (coordinator, to 2024), Asande Maoga (content, to 2024), Yuri Sadia and Isichi Nikki (design interns), and Haifa Beseisso and Deso (Dubai creative collaborators). " +
      "If asked about any of these people, say plainly that they are former and are no longer with the team.",
    metadata: { slug: "chat:team-history-departures", source: SRC, sensitivity: "internal" },
    source_type: SRC,
  },
  {
    kind: "org_fact",
    brand: null,
    title: "How the team operates, cadence and standing rules",
    content:
      "Team meetings run on Monday and Friday with a rotating chair and secretary, and minutes are saved to the shared Drive. " +
      "The team welfare fund is collected on the first Friday of each month at KSh 100 per person, with a separate KSh 100 birthday contribution; a late contribution carries a KSh 100 fine. " +
      "Leave policy is two leave days per person per month; extra days need a valid reason such as sick leave with a doctor's letter or a funeral. " +
      "Procurement rule: every purchase needs a requisition and a supplier quotation shared for approval before any payment is made; the fund custodians are Mama Njambi and Mirriam, and approvals come from Violet or Nur. " +
      "Standing rule from Nur: respond to Cynthia, and to anyone who raises a question or a request, even when the answer is no.",
    metadata: { slug: "chat:operating-rhythm", source: SRC, sensitivity: "internal" },
    source_type: SRC,
  },
  {
    kind: "org_fact",
    brand: null,
    title: "Field operations glossary, people and places",
    content:
      "The children's home is Kwetu Haven, in Gilgil, Nakuru County, Kenya; it was earlier called Loving Hands Safe House. " +
      "Mama Njambi (Dorcas Njambi) is the house mother and an alternative mother to the children, and a trusted long-term custodian. " +
      "Cynthia Mwangi is the project manager and Maisha co-founder, the senior person on the ground. " +
      "The education program includes a cohort the team refers to as the Big 10. " +
      "The micro-fund runs women's savings and lending groups, for example the Tumeamka group. " +
      "School and supplier payments run mostly via M-Pesa PayBill and bank transfer, and receipts are always collected for audit and for reporting. " +
      "Founder Nur M'nasria works remotely from Dubai; the field team is in Gilgil and Nairobi.",
    metadata: { slug: "chat:field-ops-glossary", source: SRC, sensitivity: "internal" },
    source_type: SRC,
  },
  {
    kind: "brand_voice",
    brand: "nisria",
    title: "Nur's voice, examples from the team chats",
    content:
      "Write to the team the way Nur does: warm, grateful, grounded, brief. " +
      "She opens with greetings like 'Good morning awesome people' and 'Good morning beautiful ladies'. " +
      "She thanks generously and personally, for example 'I am proud and grateful to every single one of you' and, when thanked, 'My joy'. " +
      "She centres the work on the children and on dignity, and leans on faith and community without preaching. " +
      "She is firm and clear when it concerns money or quality, for example 'No transactions to be done without getting back to me and verifying'. " +
      "Match this register: warm, concrete, short, never corporate, no hype, no dashes.",
    metadata: { slug: "chat:nur-voice-examples", source: SRC, sensitivity: "internal" },
    source_type: SRC,
  },
];

async function upsert(row) {
  const slug = row.metadata.slug;
  // delete any existing row for this slug+kind, then insert (idempotent re-run)
  const del = await fetch(`${api}?kind=eq.${row.kind}&metadata->>slug=eq.${encodeURIComponent(slug)}`, { method: "DELETE", headers });
  if (!del.ok && del.status !== 404) console.log("  delete warn", slug, del.status, await del.text());
  const ins = await fetch(api, { method: "POST", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify(row) });
  if (!ins.ok) { console.log("  INSERT FAIL", slug, ins.status, await ins.text()); return false; }
  const [created] = await ins.json();
  console.log(`  ok [${row.kind}] ${row.title}  -> id ${created.id}`);
  return true;
}

console.log(`Seeding ${rows.length} chat-derived Brain rows into agent_memory...`);
let ok = 0;
for (const r of rows) { if (await upsert(r)) ok++; }
console.log(`Done. ${ok}/${rows.length} rows committed.`);
