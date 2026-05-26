// One-off: load the May 2026 recurring monthly expenses (NS 202605) into payments.
// Faithful to the sheet; total reconciles to 597,000 KES. Grant coverage (STP /
// SANARA) is noted in the purpose. Re-runnable: clears prior rows with this batch tag.
import fs from "node:fs";

const env = fs.readFileSync(new URL("../.env.seed", import.meta.url), "utf8");
const get = (k) => { const m = env.match(new RegExp(`^${k}=(.*)$`, "m")); return m ? m[1].trim().replace(/^"|"$/g, "") : ""; };
const URL_ = get("SUPABASE_URL"), KEY = get("SUPABASE_SERVICE_KEY");
if (!URL_ || !KEY) { console.error("missing url/key"); process.exit(1); }

const BATCH = "2026-05 monthly import";
const PAID = "2026-05-01T00:00:00Z";

// [payee, purpose, category, amountKES, ref]
const raw = [
  ["Linda Ojuok", "Monthly payroll, Project Coordinator (part STP-funded)", "payroll", 40000, null],
  ["Dorcas Njambi", "Monthly payroll, Caretaker", "payroll", 35000, null],
  ["Cynthia Mwangi", "Monthly payroll, Project Manager (Maisha)", "payroll", 50000, null],
  ["Mirriam Karagu", "Monthly payroll, Tailoring Teacher (part SANARA-funded)", "payroll", 30000, null],
  ["Violet Otieno", "Monthly payroll, Accountant (part SANARA-funded)", "payroll", 20000, null],
  ["Julia Mwaniki", "Monthly payroll, Alternative Mother", "payroll", 15000, null],
  ["Eston Mundia", "Monthly payroll, Content Creator", "payroll", 30000, null],
  ["Monicah Wanjira", "Monthly payroll, Designer Assistant", "payroll", 20000, null],
  ["Elizabeth Kariuki", "Monthly payroll, Fashion Designer", "payroll", 30000, null],
  ["Wahome Jerry", "Monthly payroll, Program Assistant", "payroll", 15000, "Leah Wanyoike (M-PESA)"],
  ["Michell Nyambura", "Monthly payroll, Social Media Manager", "payroll", 20000, null],
  ["Cecilia Wambui", "Monthly payroll, Designer Assistant", "payroll", 15000, "Beth Kamau (M-PESA)"],
  ["Mark Njambi", "Monthly payroll, Outreach Coordinator", "payroll", 15000, null],
  ["Lucy Wanjiku", "Monthly payroll, Tailor (STP-funded)", "payroll", 12000, null],
  ["Marion Njoki", "Monthly payroll, Tailor (STP-funded)", "payroll", 12000, null],
  ["Raisa Njeri", "Monthly payroll, Tailor (STP-funded)", "payroll", 12000, null],
  ["Lucy Wangare", "Monthly payroll, Tailor (STP-funded)", "payroll", 12000, null],
  ["Recheal Wambui", "Monthly payroll, Tailor (STP-funded)", "payroll", 12000, null],
  ["Faith Wanjira", "Monthly payroll, Tailor (STP-funded)", "payroll", 12000, null],
  ["Veronica Masaka", "Monthly payroll, Tailor (STP-funded)", "payroll", 12000, null],
  ["Jennifer Marete", "Monthly payroll, Tailor (STP-funded)", "payroll", 12000, null],
  ["Rose Wanjiku Mwangi", "Monthly payroll, Tailor (STP-funded)", "payroll", 12000, null],
  ["Jackline Agutu", "Monthly stipend, Program Beneficiary", "stipend", 5000, null],
  ["Pasaka", "Monthly upkeep, Program Beneficiary", "upkeep", 5000, "Till 8180192"],
  ["Cynthia Mwangi", "Monthly petty cash (Maisha)", "petty cash", 15000, null],
  ["Linda Ojuok", "Monthly petty cash", "petty cash", 20000, null],
  ["Nisria Rent", "Monthly rent (part SANARA + STP funded)", "rent", 50000, "Grace Mwangi"],
  ["Electricity", "Monthly electricity (part SANARA + STP funded)", "utilities", 7000, "PayBill 888880, Acct 57100461656"],
  ["Water", "Monthly water", "utilities", 3500, "PayBill 716038, Acct 209312120027"],
  ["Maisha Wifi", "Monthly internet", "utilities", 3500, "PayBill 4041273, Acct 13231"],
  ["Supermarket", "Monthly supplies", "utilities", 43000, "Acct 0720108688"],
  ["Garbage Collection", "Monthly garbage collection", "utilities", 2000, "PayBill 506900, Acct 0003005020015887"],
];

const rows = raw.map(([payee, purpose, category, amount, ref]) => ({
  direction: "out", payee, purpose, category, amount, currency: "KES",
  method: "mpesa", status: "paid", recurrence: "monthly",
  paid_at: PAID, ref: ref ? `${BATCH} · ${ref}` : BATCH,
  brand: "nisria", created_by: BATCH, vendor_country: "KE",
}));

const total = rows.reduce((s, r) => s + r.amount, 0);
if (total !== 597000) { console.error(`TOTAL MISMATCH: ${total} (expected 597000)`); process.exit(1); }

const api = `${URL_.replace(/\/$/, "")}/rest/v1/payments`;
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
await fetch(`${api}?created_by=eq.${encodeURIComponent(BATCH)}`, { method: "DELETE", headers });
const r = await fetch(api, { method: "POST", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify(rows) });
const j = await r.json();
if (!r.ok) { console.error("INSERT FAILED", r.status, JSON.stringify(j)); process.exit(1); }
console.log(`inserted ${Array.isArray(j) ? j.length : "?"} expense rows, total ${total.toLocaleString()} KES`);
