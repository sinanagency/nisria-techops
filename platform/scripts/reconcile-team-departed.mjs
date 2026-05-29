// Record former team members the four WhatsApp chats reveal but the live
// team_members table is missing. Each is written with status='exited' and a
// factual reason and date in notes, tagged 'former' + 'whatsapp-import'. This
// gives the bot the "who left and why" the operator asked for, so it never
// treats a departed person as current. Idempotent: matched by name (case
// sensitive on the stored value), updated in place if already present.
//
// Reasons are factual and sourced from the chat record, not gossip. No
// em-dashes (doctrine). member_type is one of staff|tailor|volunteer|contractor.
import fs from "node:fs";

const ENV = "/Users/milaaj/Code/nisria-techops/platform/.env.seed";
const env = fs.readFileSync(ENV, "utf8");
const get = (k) => { const m = env.match(new RegExp(`^${k}=(.*)$`, "m")); return m ? m[1].trim().replace(/^"|"$/g, "") : ""; };
const BASE = get("SUPABASE_URL").replace(/\/$/, "");
const KEY = get("SUPABASE_SERVICE_KEY");
const api = `${BASE}/rest/v1/team_members`;
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

const SRC = "WhatsApp team chats 2021-2026";

const departed = [
  { name: "Paul Mburu", member_type: "staff", role: "Former Operations Manager", location: "Gilgil",
    notes: `Former. Operations manager and field social worker in Gilgil from 2023, exited January 2026 after a dispute. Access revoked and the matter went to a lawyer. Not authorized. Do not route tasks, payments, or contacts to him. Source: ${SRC}.` },
  { name: "Conde Yvans", member_type: "staff", role: "Former Lead Designer", location: "Gilgil",
    notes: `Former. Lead fashion designer and creative director of Maisha collections, left in 2025. Source: ${SRC}.` },
  { name: "Beth Wangui", member_type: "staff", role: "Former Admin & Embroidery", location: "Gilgil",
    notes: `Former. Admin support and embroidery (tatreez) team, left in 2025. Source: ${SRC}.` },
  { name: "Valentine Mwenja", member_type: "staff", role: "Former Program Coordinator", location: "Gilgil",
    notes: `Former. Program and admin coordinator known as Val, handled reporting and weekly meetings, left in 2024. Source: ${SRC}.` },
  { name: "Asande Maoga", member_type: "staff", role: "Former Content Lead", location: "Kenya",
    notes: `Former. Content and design apprentice lead, left in 2024. Source: ${SRC}.` },
  { name: "Yuri Sadia", member_type: "contractor", role: "Former Design Intern", location: "Kenya",
    notes: `Former. Fashion design intern who graduated to designer, left in 2025. Source: ${SRC}.` },
  { name: "Isichi Nikki", member_type: "contractor", role: "Former Design Intern", location: "Kenya",
    notes: `Former. Fashion design intern, left in 2024. Source: ${SRC}.` },
  { name: "Mohamed Hassan", member_type: "contractor", role: "Former Photographer (founding team)", location: "Egypt",
    notes: `Former. Known as Shakshak. Founding photographer and videographer, lived at the home from 2021. Released in the July 2023 restructure when operations moved to the Kenyan field team. Source: ${SRC}.` },
  { name: "Hany Khalifa", member_type: "contractor", role: "Former Video Editor (founding team)", location: "Dubai, UAE",
    notes: `Former. Founding video editor and creative. Released in the July 2023 restructure. Source: ${SRC}.` },
  { name: "Nour El Massry", member_type: "contractor", role: "Former Illustrator (founding team)", location: "Egypt",
    notes: `Former. Founding graphic artist and illustrator, created the early merch artwork. Released in the July 2023 restructure. Source: ${SRC}.` },
  { name: "Tawfiq", member_type: "contractor", role: "Former Social Media Consultant", location: "Dubai, UAE",
    notes: `Former. Early social media consultant, 2022. Source: ${SRC}.` },
  { name: "Haifa Beseisso", member_type: "contractor", role: "Former Creative Collaborator", location: "Dubai, UAE",
    notes: `Former. Dubai-based creative and content collaborator, 2024. Source: ${SRC}.` },
  { name: "Deso", member_type: "contractor", role: "Former Content Collaborator", location: "Dubai, UAE",
    notes: `Former. Dubai-based photographer and content collaborator. Source: ${SRC}.` },
];

async function getByName(name) {
  const r = await fetch(`${api}?name=eq.${encodeURIComponent(name)}&select=id,name,status`, { headers });
  if (!r.ok) return null;
  const arr = await r.json();
  return arr[0] || null;
}

async function run(p) {
  const body = {
    name: p.name,
    member_type: p.member_type,
    role: p.role,
    location: p.location,
    status: "exited",
    notes: p.notes,
    tags: ["former", "whatsapp-import"],
  };
  const existing = await getByName(p.name);
  if (existing) {
    const r = await fetch(`${api}?id=eq.${existing.id}`, { method: "PATCH", headers, body: JSON.stringify({ status: "exited", notes: p.notes, member_type: p.member_type, role: p.role, tags: ["former", "whatsapp-import"] }) });
    console.log(r.ok ? `  updated -> exited: ${p.name}` : `  UPDATE FAIL ${p.name} ${r.status} ${await r.text()}`);
    return r.ok;
  }
  const r = await fetch(api, { method: "POST", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify(body) });
  console.log(r.ok ? `  inserted exited: ${p.name}` : `  INSERT FAIL ${p.name} ${r.status} ${await r.text()}`);
  return r.ok;
}

console.log(`Reconciling ${departed.length} former team members into team_members...`);
let ok = 0;
for (const p of departed) { if (await run(p)) ok++; }
console.log(`Done. ${ok}/${departed.length} former members recorded as exited.`);
