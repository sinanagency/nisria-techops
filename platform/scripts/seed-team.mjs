// One-off: populate team_members from the 2026 Staff Directory (PDF roles +
// responsibilities, XLSX emails + phones). Inserts via PostgREST with the service
// key so arrays/long text need no SQL escaping. Idempotent-ish: clears the
// directory-sourced rows (source tag) first, then inserts fresh.
import fs from "node:fs";

const env = fs.readFileSync(new URL("../.env.seed", import.meta.url), "utf8");
const get = (k) => {
  const m = env.match(new RegExp(`^${k}=(.*)$`, "m"));
  return m ? m[1].trim().replace(/^"|"$/g, "") : "";
};
const URL_ = get("SUPABASE_URL");
const KEY = get("SUPABASE_SERVICE_KEY");
if (!URL_ || !KEY) { console.error("missing url/key"); process.exit(1); }

const clean = (s) => String(s).replace(/[—–]/g, ",").replace(/\s+,/g, ",").trim();
const resp = (...lines) => lines.map((l) => "• " + clean(l)).join("\n");

const T = (name, phone) => ({
  name, role: "Tailor", email: null, phone,
  member_type: "tailor", status: "active", activated: true,
  location: "Gilgil", engagement_type: "On-site", pay_currency: "KES",
  tags: ["Maisha Production"],
  responsibilities: resp(
    "Daily garment and uniform production in the Maisha workshop",
    "School Uniforms Program: manufacturing uniforms for Gilgil schools",
    "Maintain workshop cleanliness, fabric inventory and equipment upkeep",
  ),
});

const rows = [
  { name: "Nur M'nasria", role: "Founder & Executive Director", email: "nur@nisria.co", phone: "00971501622716",
    member_type: "staff", location: "Dubai, UAE", engagement_type: "Remote", tags: ["Leadership"],
    responsibilities: resp(
      "Sets organizational strategy and vision across all programs",
      "Leads all fundraising, grant prospecting and donor relationships",
      "Manages global partnerships and media/PR",
      "Oversees Maisha, Kepenzi and AHADI project development and growth",
      "Handles all external communications and brand voice",
      "Manages all social media channels (except LinkedIn)",
      "Manages donor communications and correspondence",
      "Schedules and arranges all volunteer visits",
      "Manages Givebutter fundraising platform",
      "Handles payroll for all staff",
      "Coordinates with Kenya team on program delivery and priorities") },

  { name: "Dorcas Njambi", role: "Care Taker & Field Officer", email: "dorcas@nisria.co", phone: "00254728173006",
    location: "Gilgil", engagement_type: "On-site", tags: ["Kwetu Haven & Field"],
    responsibilities: resp(
      "Daily care and supervision of children at Kwetu Haven",
      "Child intake: assessment, documentation and immediate stabilization",
      "Family tracing and reunification follow-up in the field",
      "Liaises with police station, children's office, schools and community leaders (with Linda and Mark)",
      "Documents child welfare cases and progress reports (with Linda and Mark)",
      "Frontline point of contact for child rescue referrals (with Linda and Mark)",
      "Ensures Nisria premises is always clean, tidy and well-maintained",
      "Manages food supplies; ensures premises is ready for students, children, volunteers and visitors") },

  { name: "Julia Mwanki", role: "Care Taker", email: "julia@nisria.co", phone: "00254724003100",
    location: "Gilgil", engagement_type: "On-site", tags: ["Kwetu Haven & Field"],
    responsibilities: resp(
      "Daily care, feeding, hygiene and emotional support for children at Kwetu Haven",
      "Cooks for staff and students on a daily basis",
      "Ensures premises is always clean and tidy",
      "Communicates with Micro Fund women beneficiaries, their groups, leaders and treasurers") },

  { name: "Mirriam Karagu", role: "Lead Teacher, Maisha Training", email: "mirriam@nisria.co", phone: "00254720663972",
    location: "Gilgil", engagement_type: "On-site", tags: ["Maisha Training"],
    responsibilities: resp(
      "Leads and delivers the Maisha vocational training curriculum for trainees",
      "Monitors trainee progress and skills development across cohorts",
      "Prepares lesson plans and training materials",
      "Reports on training outcomes for grant reporting (SANARA/Mastercard Foundation)",
      "Identifies trainees needing additional support") },

  { name: "Cecilia Wambui", role: "Assistant Teacher, Maisha Training", email: "cecilia@nisria.co", phone: "00254729538776",
    location: "Gilgil", engagement_type: "On-site", tags: ["Maisha Training"],
    responsibilities: resp(
      "Supports Mirriam across all Maisha training delivery",
      "Works one-on-one with trainees needing extra attention",
      "Assists with classroom management, materials and record keeping") },

  { name: "Cynthia Mwangi", role: "Project Manager & Maisha Co-Founder", email: "cynthia@nisria.co", phone: "0025411174123",
    location: "Gilgil", engagement_type: "Part-time", notes: "Part-time until June 2026", tags: ["Maisha Production"],
    responsibilities: resp(
      "Oversees Maisha production operations and project coordination",
      "Manages quality control across garment production",
      "Coordinates sample production, collections and event deliveries",
      "Maintains relationships with training participants and graduates",
      "Reports on grant milestones to HEVA Fund / Mastercard Foundation",
      "Supports Kepenzi prototype development alongside the design team") },

  { name: "Eliza Kariuki", role: "Lead Designer", email: "eliza@nisria.co", phone: "00254796210538",
    location: "Gilgil", engagement_type: "On-site", tags: ["Maisha Production"],
    responsibilities: resp(
      "Leads creative direction for Maisha garment collections",
      "Designs upcycled garment patterns and develops new collection concepts",
      "Supervises Monica, Lucy Wanjiku and Faith Wanjira",
      "Oversees inventory and procurement for the production workshop",
      "Manages sourcing of materials and fabrics",
      "Supports and assists Mirriam and trainees when needed",
      "Supports event preparation: curates looks and oversees finishing") },

  { name: "Monica Wanjira", role: "Assistant Designer", email: "monica@nisria.co", phone: "00254748701591",
    location: "Gilgil", engagement_type: "On-site", tags: ["Maisha Production"],
    responsibilities: resp(
      "Actively involved in the creative process and design of collections and garments",
      "Assists Eliza with pattern making, cutting and design prep",
      "Supports inventory, procurement and material shopping alongside Eliza",
      "Assists with Kepenzi product prototyping and production") },

  T("Lucy Wanjiku", "00254791277201"),
  T("Marion Njoki", "00254111773725"),
  T("Raisa Njeri", "00254724258608"),
  T("Lucy Wangare", "00254717117691"),
  T("Recheal Wambui", "00254119496926"),
  T("Faith Wanjira", "00254706179976"),
  T("Veronica Masaka", "00254118459291"),
  T("Jennifer Marete", "00254728117472"),
  T("Rose Wanjiku Mwangi", "00254114831682"),

  { name: "Violet Otieno", role: "Accountant", email: "accounts@nisria.co", phone: "00254719342752",
    location: "Gilgil", engagement_type: "On-site", tags: ["Finance & Admin"],
    responsibilities: resp(
      "Manages all day-to-day financial transactions for Nisria operations",
      "Maintains accounts and bookkeeping across all programs and projects",
      "Tracks program budgets vs. actuals and reports to Cynthia/Nur",
      "Prepares and submits monthly financial reports",
      "Manages petty cash, procurement records and supplier payments",
      "Supports grant financial reporting (SANARA, Smile Together)",
      "Supports annual financial audits") },

  { name: "Linda Ojuok", role: "Project Coordinator", email: "linda@nisria.co", phone: "00254722713346",
    location: "Gilgil", engagement_type: "On-site", tags: ["Operations & Programs"],
    responsibilities: resp(
      "Coordinates day-to-day delivery of all humanitarian programs",
      "Manages beneficiary records and program data",
      "Organises monthly food package distributions from Nisria Gilgil premises",
      "Coordinates health checkups, counseling sessions and medical referrals",
      "Liaises with police station, children's office and community leaders (with Dorcas and Mark)",
      "Documents child welfare cases and referrals (with Dorcas and Mark)",
      "Represents Nisria at community events and meetings (with Mark)",
      "Tracks program KPIs and compiles impact data for reports and grants") },

  { name: "Wahome Jerry", role: "Operations Admin", email: "wahome@nisria.co", phone: "00254706298128",
    location: "Nairobi", engagement_type: "Hybrid", tags: ["Operations & Programs"],
    responsibilities: resp(
      "Full-time operational and administrative support across Nisria",
      "Manages organizational records, filing systems and documentation",
      "Supports grant administration: tracking deadlines and coordinating submissions",
      "IT support and systems management (email, tools, platforms)",
      "Coordinates logistics between Nairobi and Gilgil operations") },

  { name: "Mark Njambi", role: "Outreach Officer", email: "mark@nisria.co", phone: "00254703119486",
    location: "Gilgil", engagement_type: "Full-time", tags: ["Operations & Programs"],
    responsibilities: resp(
      "Full-time community outreach and engagement for all Nisria programs",
      "Conducts field outreach to identify vulnerable children, families and women",
      "Builds and maintains relationships with community leaders, schools and local organizations",
      "Supports beneficiary intake and referral processes",
      "Liaises with police station, children's office and community leaders (with Dorcas and Linda)",
      "Supports Micro Fund outreach: identifying eligible community women",
      "Represents Nisria at community events and meetings (with Linda)") },

  { name: "Mitchelle Nyambura", role: "Social Media Manager", email: "social@nisria.co", phone: "00254794312349",
    location: "Nairobi", engagement_type: "Hybrid", tags: ["Communications & Content"],
    responsibilities: resp(
      "Manages and grows Nisria's LinkedIn presence",
      "Creates and schedules LinkedIn content for Nisria and Maisha",
      "Engages with the LinkedIn community and responds to messages") },

  { name: "Eston Mundia", role: "Content Creator", email: "media@nisria.co", phone: "0025474104801",
    member_type: "contractor", location: "Nairobi", engagement_type: "Freelance", tags: ["Communications & Content"],
    responsibilities: resp(
      "Captures photo and video for all Nisria and Maisha events, pop-ups and fashion shows",
      "Documents community engagement, activations and outreach",
      "Captures beneficiaries and their stories",
      "Shoots e-commerce product photography",
      "Edits and delivers all final media assets") },

  { name: "Kevin Mgo", role: "Driver", email: null, phone: "00254710105160",
    member_type: "contractor", location: "Nairobi", engagement_type: "Freelance", tags: ["Logistics"],
    responsibilities: resp(
      "On-call transport for Nairobi-based logistics and team movements",
      "Transports volunteers and visitors to Gilgil and back to Nairobi",
      "Supports supply runs and event logistics as needed") },
].map((r) => ({
  // PostgREST bulk insert requires EVERY object to carry the SAME keys, so build
  // a uniform shape and fill the optional ones with null.
  name: r.name,
  role: r.role,
  email: r.email ?? null,
  phone: r.phone ?? null,
  member_type: r.member_type ?? "staff",
  status: "active",
  activated: true,
  location: r.location ?? null,
  engagement_type: r.engagement_type ?? null,
  pay_currency: "KES",
  notes: r.notes ?? null,
  responsibilities: r.responsibilities ?? null,
  // tag every directory row so a re-run can clear just these
  tags: [...(r.tags || []), "2026 directory"],
}));

const api = `${URL_.replace(/\/$/, "")}/rest/v1/team_members`;
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

// clear any prior directory-seeded rows so re-running is clean (matches the tag)
await fetch(`${api}?tags=cs.{"2026 directory"}`, { method: "DELETE", headers });

const r = await fetch(api, { method: "POST", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify(rows) });
const j = await r.json();
if (!r.ok) { console.error("INSERT FAILED", r.status, JSON.stringify(j)); process.exit(1); }
console.log(`inserted ${Array.isArray(j) ? j.length : "?"} team members`);
