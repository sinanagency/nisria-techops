// Itemise the historical monthly expense sheets (Nov/Dec/Jan) into per-line
// categorised payments, REPLACING the 3 lump month-totals. Each month is reconciled
// against its stated sheet total before anything commits (the gate); a month that
// doesn't reconcile is skipped and left as its lump + flagged. Also writes an
// extraction_staging audit row per month. Idempotent via created_by + signature.
import fs from "node:fs";
const env = fs.readFileSync(new URL("../.env.seed", import.meta.url), "utf8");
const get = k => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim().replace(/^"|"$/g, "") || "";
const URL_ = get("SUPABASE_URL"), KEY = get("SUPABASE_SERVICE_KEY");
const api = (t) => `${URL_.replace(/\/$/, "")}/rest/v1/${t}`;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const BATCH = "drive itemised history";

const cat = (exp) => {
  const e = (exp || "").toLowerCase();
  if (e.includes("payroll")) return "payroll";
  if (e.includes("petty")) return "petty cash";
  if (e.includes("pocket") || e.includes("upkeep")) return e.includes("upkeep") ? "upkeep" : "stipend";
  if (e.includes("rent")) return "rent";
  return "utilities"; // electricity, water, wifi, supermarket, garbage, transportation
};

// [payee, designation, expense, amount]
const MONTHS = {
  "2025-11-28": { total: 460620, lines: [
    ["Mburu Paul","Manager","Payroll",35000],["Mburu Paul","Manager","Petty Cash",15000],
    ["Dorcas Njambi","Caretaker","Payroll",35000],["Cynthia Mwangi","Project Manager (Maisha)","Payroll",45000],
    ["Cynthia Mwangi","Project Manager (Maisha)","Petty Cash",15000],["Mirriam Karagu","Tailoring Teacher","Payroll",22500],
    ["Violet Otieno","Accountant","Payroll",10000],["Julia Mwaniki","Alternative Mother","Payroll",15000],
    ["Kevin Mburu","Content Creator","Payroll",20000],["Monicah Wanjira","Designer Assistant","Payroll",20000],
    ["Elizabeth Kariuki","Fashion Designer","Payroll",30000],["Wahome Jerry","Program Assistant","Payroll",15000],
    ["Sammy Wambui","Outreach Coordinator","Payroll",20000],["Sammy Wambui","Outreach Coordinator","Petty Cash",10000],
    ["Aurelia Mireya","Intern","Pocket Money",5000],["Mark Njambi","Intern","Pocket Money",8000],
    ["Rick Wambui","Intern","Pocket Money",8000],["Cecilia Wambui","Intern","Pocket Money",10000],
    ["Jackline Agutu","Program Beneficiary","Pocket Money",5000],["Faith Kariuki","Program Beneficiary","Pocket Money",5000],
    ["Geoffrey Wainaina","Program Beneficiary","Pocket Money",5000],["Cynthia Shinamote","Program Beneficiary","Pocket Money",5000],
    ["Nisria Rent","Office","Rent",40000],["Electricity","Utility","Electricity",3120],["Water","Utility","Water",3500],
    ["Maisha Wifi","Utility","Internet",3500],["Supermarket","Supplies","Supermarket",50000],["Garbage Collection","Utility","Garbage",2000],
  ]},
  "2025-12-28": { total: 450120, lines: [
    ["Mburu Paul","Manager","Payroll",35000],["Mburu Paul","Manager","Petty Cash",15000],
    ["Dorcas Njambi","Caretaker","Payroll",35000],["Cynthia Mwangi","Project Manager (Maisha)","Payroll",50000],
    ["Cynthia Mwangi","Project Manager (Maisha)","Petty Cash",15000],["Mirriam Karagu","Tailoring Teacher","Payroll",22500],
    ["Violet Otieno","Accountant","Payroll",2500],["Julia Mwaniki","Alternative Mother","Payroll",15000],
    ["Kevin Mburu","Content Creator","Payroll",20000],["Monicah Wanjira","Designer Assistant","Payroll",20000],
    ["Elizabeth Kariuki","Fashion Designer","Payroll",30000],["Wahome Jerry","Program Assistant","Payroll",15000],
    ["Sammy Wambui","Outreach Coordinator","Payroll",20000],["Sammy Wambui","Outreach Coordinator","Petty Cash",10000],
    ["Aurelia Mireya","Intern","Pocket Money",5000],["Mark Njambi","Intern","Pocket Money",8000],
    ["Rick Wambui","Designer Assistant","Pocket Money",10000],["Cecilia Wambui","Designer Assistant","Pocket Money",10000],
    ["Jackline Agutu","Program Beneficiary","Pocket Money",5000],["Faith Kariuki","Program Beneficiary","Pocket Money",5000],
    ["Geoffrey Wainaina","Program Beneficiary","Pocket Money",5000],["Cynthia Shinamote","Program Beneficiary","Pocket Money",5000],
    ["Nisria Rent","Office","Rent",40000],["Electricity","Utility","Electricity",3120],["Water","Utility","Water",3500],
    ["Maisha Wifi","Utility","Internet",3500],["Supermarket","Supplies","Supermarket",40000],["Garbage Collection","Utility","Garbage",2000],
  ]},
  "2026-01-28": { total: 482120, lines: [
    ["Mburu Paul","Manager","Payroll",35000],["Mburu Paul","Manager","Petty Cash",15000],
    ["Dorcas Njambi","Caretaker","Payroll",35000],["Cynthia Mwangi","Project Manager (Maisha)","Payroll",50000],
    ["Cynthia Mwangi","Project Manager (Maisha)","Petty Cash",15000],["Mirriam Karagu","Tailoring Teacher","Payroll",22500],
    ["Violet Otieno","Accountant","Payroll",2500],["Julia Mwaniki","Alternative Mother","Payroll",15000],
    ["Mundia","Content Creator","Payroll",30000],["Monicah Wanjira","Designer Assistant","Payroll",20000],
    ["Elizabeth Kariuki","Fashion Designer","Payroll",30000],["Wahome Jerry","Program Assistant","Payroll",15000],
    ["Michell","Social Media Manager","Payroll",20000],["Fayrouz","Social Media Manager","Payroll",30000],
    ["Aurelia Mireya","Intern","Pocket Money",10000],["Mark Njambi","Intern","Pocket Money",10000],
    ["Rick Wambui","Designer Assistant","Pocket Money",10000],["Cecilia Wambui","Designer Assistant","Pocket Money",10000],
    ["Jackline Agutu","Program Beneficiary","Upkeep",5000],["Nisria Rent","Office","Rent",40000],
    ["Transportation","Logistics","Transportation",10000],["Electricity","Utility","Electricity",3120],
    ["Water","Utility","Water",3500],["Maisha Wifi","Utility","Internet",3500],
    ["Supermarket","Supplies","Supermarket",40000],["Garbage Collection","Utility","Garbage",2000],
  ]},
};

// 1) reconcile each month; only proceed with the ones that match their stated total
const ok = {};
for (const [date, m] of Object.entries(MONTHS)) {
  const sum = m.lines.reduce((s, l) => s + l[3], 0);
  if (sum === m.total) ok[date] = m;
  else console.log(`SKIP ${date}: itemised sum ${sum} != stated ${m.total} (left as lump, flagged)`);
}

// 2) remove the lump rows for the months we are itemising; insert per-line rows
const dates = Object.keys(ok);
if (dates.length) {
  // delete prior itemised batch (idempotent) + the lump rows for these months
  await fetch(`${api("payments")}?created_by=eq.${encodeURIComponent(BATCH)}`, { method: "DELETE", headers: H });
  for (const date of dates) {
    const month = date.slice(0, 7);
    await fetch(`${api("payments")}?created_by=eq.${encodeURIComponent("drive monthly history")}&paid_at=gte.${month}-01&paid_at=lte.${month}-31`, { method: "DELETE", headers: H });
  }
  const rows = [];
  for (const [date, m] of Object.entries(ok)) {
    m.lines.forEach(([payee, desig, exp, amt], i) => rows.push({
      direction: "out", payee, purpose: `${exp}, ${desig} (${date.slice(0,7)})`, category: cat(exp),
      amount: amt, currency: "KES", method: "mpesa", status: "paid", recurrence: "none",
      paid_at: date + "T00:00:00Z", ref: `${BATCH} ${date.slice(0,7)} #${i+1}`, brand: "nisria",
      created_by: BATCH, vendor_country: "KE",
    }));
  }
  const r = await fetch(api("payments"), { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify(rows) });
  const j = await r.json();
  console.log(r.ok ? `itemised ${j.length} lines across ${dates.length} months (${dates.map(d=>d.slice(0,7)).join(", ")}), each reconciled to its stated total` : `FAIL ${JSON.stringify(j).slice(0,300)}`);

  // 3) audit rows in extraction_staging (reconciled = true, high confidence)
  const audit = Object.entries(ok).map(([date, m]) => ({
    source_doc_id: `monthly-sheet-${date.slice(0,7)}`, domain: "finance",
    normalized: { month: date.slice(0,7), lines: m.lines.length, total: m.total },
    confidence: "high", reconciled: true, status: "committed",
    signature: `itemise-${date.slice(0,7)}`, notes: `Itemised ${m.lines.length} lines, sum == stated ${m.total}.`,
    committed_at: new Date().toISOString(),
  }));
  await fetch(`${api("extraction_staging")}?on_conflict=signature`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(audit) });
}
