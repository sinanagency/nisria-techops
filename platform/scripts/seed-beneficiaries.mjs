// One-off: import the 2025 Kwetu (rescued children) + Microfund (women's groups)
// databases into beneficiaries. PRIVATE by default (consent_public=false) so PII is
// RLS-gated and never world-readable. National ID numbers are deliberately NOT
// imported (privacy minimisation; not needed for platform function). Re-runnable
// via ref_code upsert. AUTO-IMPORTED -> flag for human review.
import fs from "node:fs";
const env = fs.readFileSync(new URL("../.env.seed", import.meta.url), "utf8");
const get = k => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim().replace(/^"|"$/g, "") || "";
const URL_ = get("SUPABASE_URL"), KEY = get("SUPABASE_SERVICE_KEY");
const clean = s => String(s || "").replace(/[—–]/g, ",").replace(/-{2,}/g, "").replace(/\s+,/g, ",").trim();
const iso = d => { if (!d) return null; const m = String(d).match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if (!m) return null; let [_, dd, mm, yy] = m; yy = yy.length === 2 ? "20" + yy : yy; const x = new Date(`${yy}-${mm.padStart(2,"0")}-${dd.padStart(2,"0")}`); return isNaN(x) ? null : x.toISOString().slice(0,10); };

// Kwetu rescued children: [name, gender, age, date, case, resolution]
const F = new Set(["Christine Amokebe","Ann Angela","Agnes Momanyi","Deborah Naliaka","Risper Chepkirki (Angel)","Jane Doe","Marion Chebet","Purity Waasisha","Serah Wairimu"]);
const kids = [
["George Masai","15","Lost and Found","","Tracing done; placed with family in Bungoma County"],
["John Maina","14","Lost and Found","","Tracing done; rejoined family at Kitale, Uasin Gishu County"],
["Christine Amokebe","15","Lost and found / pregnancy","24/07/2023","Referred to the Beehive home for more care and protection"],
["Ibrahim Mwaura (John Kamau)","14","Lost and Found","26/07/2023","Traced and rejoined parents; counselled. Resident of Ndebo, Nakuru County"],
["Paul Okech","13","Lost and Found","04/10/2023","Tracing relatives and placement"],
["Phillip Bundi","12","Lost and Found","04/10/2023","Tracing relatives/parent and placement"],
["Peter Kinyanjui","17","Abandoned","06/10/2023","In progress"],
["Ann Angela","12","Lost and Found","17/08/2023","Traced and referred back through the children office"],
["Agnes Momanyi","12","Lost and Found","17/08/2023","Traced and referred back through the children office"],
["Brian Makori","9","Lost and Found","28/11/2023","Tracing parent/relatives and referred home"],
["Francis Mwai","7","Lost and Found","29/11/2023","Tracing parent/relatives and referred home"],
["Josphat Mukandu","10","Lost and Found","30/11/2023","Tracing parent/relatives and referred home"],
["Zacharia Chikanda","12","Lost and Found","03/01/2024","Tracing parent"],
["Jacob Njuguna","11","Lost and Found","09/01/2024","Tracing done; taken by his father"],
["Deborah Naliaka","15","Lost and Found","10/01/2024","Tracing relatives and placement"],
["Mike Kimeu","13","Lost and Found","16/01/2024","Tracing relatives and placement"],
["Maxwell Ndiritu","1.5","Lost and Found","27/02/2024",""],
["Risper Chepkirki (Angel)","17","Lost and Found","02/04/2024",""],
["Samwel Wanjala","13","Lost and Found","14/05/2024",""],
["Brian Fadhili","11","Lost and Found","14/05/2024",""],
["Walter Gichuhi Wambui","13","Lost and Found","20/05/2024",""],
["Joseph Kingori","12","Lost and Found","28/05/2024",""],
["John Macharia","16","Lost and Found","30/05/2024",""],
["Erick Kibet","9","Lost and Found","27/06/2024",""],
["Stephen Ngugi","12","Lost and Found","29/06/2024",""],
["Vicking Kamau","5","Lost and Found","22/08/2024",""],
["Francis Mwai","8","Lost and Found","02/09/2024",""],
["Brian Mwaniki","16","Lost and Found","25/11/2024",""],
["Meshak Elupe","11","Lost and Found","09/11/2025",""],
["Jane Doe","14","Lost and Found","11/01/2025",""],
["Marion Chebet","16","Lost and Found","27/01/2025",""],
["Martin Mwangi Gitau","9","Lost and Found","14/02/2025",""],
["Samuel Mwangi","7","Lost and Found","14/02/2025",""],
["Brian Mwendwa","12","Lost and Found","27/02/2025",""],
["Peter Waweru","9","Lost and Found","27/02/2025",""],
["Gift Onguko","14","Lost and Found","17/03/2025",""],
["Shantila Milimu","17","Lost and Found","24/03/2025",""],
["Purity Waasisha","15","Lost and Found","04/04/2025",""],
["Alvin Omega","11","Lost and Found","10/06/2025",""],
["Pasaka Lekaratu","","Lost and Found","14/07/2025",""],
["Serah Wairimu","15","Lost and Found","14/07/2025",""],
["David Otieno","14","Lost and Found","16/07/2025",""],
["Ezra Kela","13","Lost and Found","16/07/2025",""],
["Brian Ogonda","12","Lost and Found","16/07/2025",""],
["Nyamasoko Julius","11","Lost and Found","22/07/2025",""],
["Talia Michelle","6","Lost and Found","15/06/2025",""],
["Gregory Kiprono","16","Lost and Found","17/11/2025",""],
];

// Microfund women: [name, group, role, phone]
const mf = [
["Dorcas Njambi Kariuki","Jiinue Women's Group","Member","254728173006"],
["Beth Nduta Mburu","Jiinue Women's Group","Member","254713649267"],
["Julia Ngonjo Mwanaki","Jiinue Women's Group","Member","254240031300"],
["Joyce Wangui Nyambura","Jiinue Women's Group","Member","254704684025"],
["Joyce Muthoni Ndungu","Jiinue Women's Group","Member","254725779384"],
["Monicah Wangui Mwaniki","Jiinue Women's Group","Member","254728517657"],
["Monicah Wairimu Mwaniki","Jiinue Women's Group","Member","254715681903"],
["Eisther Wambui Mwaniki","Jiinue Women's Group","Money Counter","254796827700"],
["Susan Wanjiru Maina","Jiinue Women's Group","Member","254705105112"],
["Milcah Nyambura Mwaniki","Jiinue Women's Group","Member","254769231009"],
["Naomi Wambui Kariuki","Jiinue Women's Group","Member","254725870814"],
["Nancy Wanjiku Mwangi","Jiinue Women's Group","Member","254729392068"],
["Mirriam Wanjiku Mungai","Jiinue Women's Group","Member","254726175129"],
["Ann Wanjiru","Jiinue Women's Group","Member","254702949869"],
["Veronicah Kabata Martha","Jiinue Women's Group","Member","254738796564"],
["Joice Wanjiru","Jiinue Women's Group","Member","254729890995"],
["Jane Nduta Mwangi","Jiinue Women's Group","Member","254701596161"],
["Beth Nyambura","Jiinue Women's Group","Member","254727881897"],
["Phyllis Njeri","Jiinue Women's Group","Member","254725284751"],
["Hannah Njoki","Jiinue Women's Group","Member","254720983851"],
["Tabitha Nyambura","Jiinue Women's Group","Member","254714653625"],
["Betty Musa","Jiinue Women's Group","Member","254757631328"],
["Mary Wangari","Jiinue Women's Group","Member","254702505839"],
["Mary Wakonyo","Microfund Group 2","Member","254710105867"],
["Millka Njeri","Microfund Group 2","Member","254728106762"],
["Peris Munyue","Microfund Group 2","Member","254715448480"],
["Ann Wambui","Microfund Group 2","Member","254711691453"],
["Jane Waithera","Microfund Group 2","Member","254710109437"],
["Lydia Muthoni","Microfund Group 2","Member","254711753968"],
["Teresiah Njeri Kabore","Microfund Group 2","Member","254703255084"],
["Sarah Wanjiru","Microfund Group 2","Member","254715440423"],
["Deris Gathoni","Microfund Group 2","Member","254705307498"],
["Rebecca Waithera","Microfund Group 2","Member","254718208513"],
["Racheal Wambui","Microfund Group 2","Member","254703413154"],
["Florence Wangui","Microfund Group 2","Member","254728203543"],
["Peninah Wambui","Microfund Group 2","Member","254742128573"],
["Lulia Mwaniki","Microfund Group 2","Member","254790026225"],
["Elizabeth Wangechi","Microfund Group 2","Member","254706097035"],
["Keziah Njeri Kuria","Microfund Group 2","Member","254701224965"],
["Naomi Wangari Watiri","Microfund Group 2","Member","254759915344"],
["Elizabeth Nduta Gatinu","Microfund Group 2","Member","254714561527"],
["Hannah Wangui Kagumy","Microfund Group 2","Member","254792482594"],
["Rebecca Nduta Gatimu","Microfund Group 2","Member","254725835423"],
["Virginia Njeri","Microfund Group 2","Member","254710333113"],
["Monicah Waithira","Microfund Group 2","Member","254724424914"],
["Beatrice Kagema","Microfund Group 2","Member","254791613697"],
];

const rows = [];
kids.forEach(([name, age, kase, date, res], i) => {
  rows.push({
    ref_code: `KW-${String(i + 1).padStart(3, "0")}`,
    full_name: clean(name), program: "rescue", category: "Kwetu Haven (rescue)",
    gender: F.has(name) ? "female" : "male",
    intake_date: iso(date), region: "Gilgil, Nakuru",
    needs: `Case: ${clean(kase)}${age ? ` · age ~${age} at intake` : ""}`,
    story_private: clean(res) || "Lost-and-found intake at Kwetu Haven (2023-2025 database).",
    status: clean(res) && /trac|rejoin|placed|referred|reunif|father|home|family/i.test(res) ? "transitioned" : "active",
    consent_public: false, tags: ["kwetu", "rescue", "2025 database", "auto-import: review"],
  });
});
mf.forEach(([name, group, role, phone], i) => {
  rows.push({
    ref_code: `MF-${String(i + 1).padStart(3, "0")}`,
    full_name: clean(name), program: "other", category: "Microfund (women)",
    gender: "female", intake_date: null,
    region: "Gilgil, Nakuru",
    needs: `Microfund member · ${group}${role && role !== "Member" ? ` · ${role}` : ""}`,
    story_private: `Microfund women's group member. Group: ${group}. Role: ${role}. Contact: ${phone}.`,
    status: "active", consent_public: false,
    tags: ["microfund", group, "2025 database", "auto-import: review"],
  });
});

const api = `${URL_.replace(/\/$/, "")}/rest/v1/beneficiaries`;
const h = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const r = await fetch(`${api}?on_conflict=ref_code`, { method: "POST", headers: { ...h, Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(rows) });
const j = await r.json();
console.log(r.ok ? `beneficiaries: imported ${Array.isArray(j) ? j.length : "?"} (${kids.length} rescued children + ${mf.length} microfund women), all private (consent_public=false)` : `FAIL ${JSON.stringify(j).slice(0, 300)}`);
