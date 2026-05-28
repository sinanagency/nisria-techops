// Backfill the WHOLE monthly-expense history from the Drive so the Finance ledger
// goes back as far as the files do (Mar 2023 -> now). Each "YYYYMM - nisria Expenses"
// Google Sheet is exported via the service account, parsed (Name | Designation |
// Expense | Amount KES | Amount $), and written as per-line categorised payments
// dated to that month. Continuation rows (blank name) carry the previous payee.
// Idempotent: clears the prior monthly batches and rewrites uniformly. Excludes the
// current month (left to the live obligations). KES and USD kept separate.
import fs from "node:fs";
import crypto from "node:crypto";
import * as XLSX from "xlsx";

const env = fs.readFileSync(new URL("../.env.seed", import.meta.url), "utf8");
const g = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim().replace(/^"|"$/g, "") || "";
const URL_ = g("SUPABASE_URL").replace(/\/$/, ""), KEY = g("SUPABASE_SERVICE_KEY");
const SA = JSON.parse(Buffer.from(g("GOOGLE_SERVICE_ACCOUNT_B64"), "base64").toString());
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "User-Agent": "Mozilla/5.0", "Content-Type": "application/json" };
const BATCH = "drive monthly history";
const CURRENT = "2026-05"; // leave the live obligations alone

async function driveToken() {
  const now = Math.floor(Date.now() / 1000);
  const h = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const c = Buffer.from(JSON.stringify({ iss: SA.client_email, scope: "https://www.googleapis.com/auth/drive.readonly", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })).toString("base64url");
  const sig = crypto.sign("RSA-SHA256", Buffer.from(`${h}.${c}`), SA.private_key).toString("base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${h}.${c}.${sig}` }) });
  return (await r.json()).access_token;
}
const num = (v) => { const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, "")); return isFinite(n) ? n : 0; };
const cat = (exp, desig) => {
  const e = `${exp || ""} ${desig || ""}`.toLowerCase();
  if (/payroll|salary/.test(e)) return "payroll";
  if (/pocket|stipend/.test(e)) return "stipend";
  if (/upkeep/.test(e)) return "upkeep";
  if (/rent/.test(e)) return "rent";
  if (/medic|therapy|health|hospital/.test(e)) return "health";
  if (/registr|case|caution|land|lawyer|legal|audit/.test(e)) return "legal";
  if (/electric|water|wifi|internet|garbage|transport|utilit/.test(e)) return "utilities";
  if (/food|bread|egg|sausage|potato|supermarket|shopping|fridge|supplies|clothes/.test(e)) return "supplies";
  return "other";
};

const tok = await driveToken();
// month -> fileId (first wins), nisria monthly sheets only, exclude current month
const docs = await (await fetch(`${URL_}/rest/v1/documents?select=title,drive_file_id,mime&mime=eq.application/vnd.google-apps.spreadsheet&limit=2000`, { headers: H })).json();
const monthMap = new Map();
for (const d of docs) {
  if (!/nisria Expenses|Monthly Expenses/i.test(d.title || "")) continue;
  const m = (d.title || "").replace(/[^0-9]/g, "").match(/(20\d{2})(0[1-9]|1[0-2])/);
  if (!m) continue;
  const ym = `${m[1]}-${m[2]}`;
  if (ym === CURRENT) continue;
  if (!monthMap.has(ym)) monthMap.set(ym, d.drive_file_id);
}
const months = [...monthMap.keys()].sort();
console.log(`months to backfill: ${months.length} (${months[0]} .. ${months[months.length - 1]})`);

// clear prior monthly batches so we rewrite uniformly from one source
for (const mk of ["drive monthly history", "drive itemised history"]) {
  await fetch(`${URL_}/rest/v1/payments?created_by=eq.${encodeURIComponent(mk)}`, { method: "DELETE", headers: H });
}

let grand = 0, rowsAll = [];
for (const ym of months) {
  const fileId = monthMap.get(ym);
  let rows;
  try {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}`, { headers: { authorization: `Bearer ${tok}` } });
    if (!r.ok) { console.log(`  ${ym}: export ${r.status}`); continue; }
    const wb = XLSX.read(Buffer.from(await r.arrayBuffer()), { type: "buffer" });
    rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false });
  } catch (e) { console.log(`  ${ym}: read fail`); continue; }
  // find header row
  let hi = rows.findIndex((r) => (r || []).some((c) => /name/i.test(String(c))) && (r || []).some((c) => /expense/i.test(String(c))));
  if (hi < 0) hi = 0;
  const date = `${ym}-28T00:00:00Z`;
  let lastName = "", lastDesig = "", n = 0, kesSum = 0;
  for (const r of rows.slice(hi + 1)) {
    const name = String(r[0] ?? "").trim() || lastName;
    const desig = String(r[1] ?? "").trim() || (String(r[0] ?? "").trim() ? "" : lastDesig);
    if (String(r[0] ?? "").trim()) { lastName = String(r[0]).trim(); lastDesig = String(r[1] ?? "").trim(); }
    const exp = String(r[2] ?? "").trim();
    const kes = num(r[3]); const usd = num(r[4]);
    if (kes <= 0 && usd <= 0) continue;
    if (!name) continue;
    const c = cat(exp, desig);
    if (kes > 0) { rowsAll.push({ direction: "out", payee: name, purpose: `${exp || c}${desig ? ", " + desig : ""} (${ym})`.slice(0, 200), category: c, amount: kes, currency: "KES", method: "mpesa", status: "paid", recurrence: "none", paid_at: date, ref: `${BATCH} ${ym} #${++n}`, brand: "nisria", created_by: BATCH, vendor_country: "KE" }); kesSum += kes; }
    if (usd > 0) { rowsAll.push({ direction: "out", payee: name, purpose: `${exp || c}${desig ? ", " + desig : ""} (${ym})`.slice(0, 200), category: c, amount: usd, currency: "USD", method: "bank", status: "paid", recurrence: "none", paid_at: date, ref: `${BATCH} ${ym} $#${++n}`, brand: "nisria", created_by: BATCH, vendor_country: "KE" }); }
  }
  grand += kesSum;
  console.log(`  ${ym}: ${n} lines, KES ${Math.round(kesSum).toLocaleString()}`);
}

// insert in chunks
for (let i = 0; i < rowsAll.length; i += 300) {
  const r = await fetch(`${URL_}/rest/v1/payments`, { method: "POST", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify(rowsAll.slice(i, i + 300)) });
  if (!r.ok) { console.log("INSERT FAIL", r.status, (await r.text()).slice(0, 200)); process.exit(1); }
}
console.log(`\nDONE: ${rowsAll.length} payment lines across ${months.length} months, KES total ${Math.round(grand).toLocaleString()}`);
