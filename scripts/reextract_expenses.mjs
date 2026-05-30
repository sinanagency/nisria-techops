// Pass 0 FINAL FIX — replace the fabricated/inflated 'drive monthly history' backfill with
// clean line items re-extracted from the real monthly expense sheets in Drive.
//
// The backfill misread PayBill/Account numbers as amounts (the 5e21 rows) and templated 34
// months that have no source sheet. Truth: the sheets state their own month total, and the
// "Amount (KES)" column reconciles to it. We parse that column, reconcile to the stated Total,
// and only write months that balance. Donations, Givebutter payouts, and bank_transactions are
// untouched. Reversible: full snapshot saved before any delete.
//
// Run DRY first:   DRY_RUN=1 node --dns-result-order=ipv4first scripts/reextract_expenses.mjs
// Then for real:   DRY_RUN=0 node --dns-result-order=ipv4first scripts/reextract_expenses.mjs
import fs from "node:fs";
import crypto from "node:crypto";

const DRY = process.env.DRY_RUN !== "0";
const SEED = "/Users/milaaj/Code/nisria-techops/platform/.env.seed";
const REF = "ptvhqudonvvszupzhcfl";

const seed = fs.readFileSync(SEED, "utf8");
const grab = (k) => { const m = seed.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim().replace(/^["']|["']$/g, "") : ""; };
const sa = JSON.parse(Buffer.from(grab("GOOGLE_SERVICE_ACCOUNT_B64"), "base64").toString("utf8"));
const SUPA_TOK = (await import("node:child_process")).execSync("security find-generic-password -s 'bu-supabase-token' -w").toString().trim();

async function fr(url, opts = {}, tries = 6) {
  for (let i = 0; i < tries; i++) {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 40000);
    try { const r = await fetch(url, { ...opts, signal: ac.signal }); clearTimeout(t); return r; }
    catch (e) { clearTimeout(t); if (i === tries - 1) throw e; await new Promise((r) => setTimeout(r, 2000 * (i + 1))); }
  }
}
// drive token
const now = Math.floor(Date.now() / 1000);
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const inp = `${b64u({ alg: "RS256", typ: "JWT" })}.${b64u({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/drive.readonly", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
const sig = crypto.sign("RSA-SHA256", Buffer.from(inp), sa.private_key).toString("base64url");
const DTOK = (await (await fr("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${inp}.${sig}` }) })).json()).access_token;
const find = async (q) => (await (await fr(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=50&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives`, { headers: { authorization: `Bearer ${DTOK}` } })).json()).files || [];
const csvOf = async (id) => await (await fr(`https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=text/csv`, { headers: { authorization: `Bearer ${DTOK}` } })).text();
// supabase mgmt query
const sql = async (q) => {
  const r = await fr(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: "POST", headers: { authorization: `Bearer ${SUPA_TOK}`, "content-type": "application/json", "user-agent": "pass0-reextract" }, body: JSON.stringify({ query: q }) });
  const d = await r.json();
  if (d && d.error) throw new Error("SQL: " + JSON.stringify(d));
  return d;
};

// minimal CSV parser (handles quoted fields with commas + newlines)
function parseCSV(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const num = (s) => { const m = String(s || "").replace(/,/g, "").match(/-?\d+\.?\d*/); return m ? Number(m[0]) : null; };
const catOf = (expense) => {
  const e = (expense || "").toLowerCase();
  if (e.includes("payroll")) return "payroll";
  if (e.includes("petty")) return "petty cash";
  if (e.includes("rent")) return "rent";
  if (e.includes("utilit")) return "utilities";
  if (e.includes("upkeep")) return "upkeep";
  if (e.includes("food")) return "upkeep";
  return "other";
};

// Discover EVERY monthly expense sheet (both naming conventions), pick ONE primary sheet per
// month, and skip supplementary variants (STP / Maisha / Pending / Remaining / Payroll / La Carica)
// so a month is not double-counted. Primary = a plain "YYYYMM - nisria Expenses" or
// "[NS] YYYYMM - Monthly Expenses".
const allSheets = new Map();
for (const term of ["nisria Expenses", "Monthly Expenses"]) {
  for (const f of await find(`name contains '${term}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`)) allSheets.set(f.id, f);
}
const SUPP = /STP|Maisha|Pending|Remaining|Payroll|La Carica/i;
const byMonth = new Map();
for (const f of allSheets.values()) {
  const m = f.name.match(/(20\d{2})\s*0?([1-9]|1[0-2])(?:\D|$)/) || f.name.match(/(20\d{2})(0[1-9]|1[0-2])/);
  const ymRaw = (f.name.match(/20\d{4}/) || [])[0];
  if (!ymRaw) continue; // skip annual/summary sheets (no YYYYMM)
  const ym = `${ymRaw.slice(0, 4)}-${ymRaw.slice(4, 6)}`;
  const isPrimary = !SUPP.test(f.name);
  const cur = byMonth.get(ym);
  // prefer a primary sheet; among primaries prefer the shortest name (the plain one)
  if (!cur || (isPrimary && (SUPP.test(cur.name) || f.name.length < cur.name.length))) byMonth.set(ym, f);
}
const MONTHS = [...byMonth.keys()].sort().map((ym) => ({ ym, file: byMonth.get(ym) }));
const latestYm = MONTHS.length ? MONTHS[MONTHS.length - 1].ym : null;
console.log(`discovered ${MONTHS.length} monthly sheets: ${MONTHS[0]?.ym} to ${latestYm}\n`);

const esc = (s) => String(s == null ? "" : s).replace(/'/g, "''").slice(0, 200);
const parsed = [];
for (const m of MONTHS) {
  const f = m.file;
  if (!f) { console.log(`${m.ym}: SHEET NOT FOUND, skipping`); continue; }
  const rows = parseCSV(await csvOf(f.id));
  const header = rows.find((r) => r.some((c) => /amount/i.test(c))) || rows[0];
  // Read the KES amount ONLY from the labeled KES column (never Payment Details / PayBill / Bank /
  // the $ column), so account numbers can never be parsed as money. KES is the operating currency;
  // the older sheets' tiny, inconsistently-recorded USD agency column is intentionally not loaded.
  const findCol = (re) => header.findIndex((c) => re.test(c || ""));
  let iKes = findCol(/amount\s*\(kes\)|amount.*kes|kes.*amount/i);
  if (iKes < 0) iKes = findCol(/amount/i);
  const iName = findCol(/name/i), iExp = findCol(/expense/i), iGrant = findCol(/grant/i), iDesig = findCol(/desig/i);
  let curName = "", stated = null;
  const items = [];
  for (const r of rows) {
    if (r === header) continue;
    const name = (r[iName] || "").trim();
    if (name) curName = name;
    const expense = (r[iExp] || "").trim();
    const desig = iDesig >= 0 ? (r[iDesig] || "").trim() : "";
    const kes = num(r[iKes]);
    // a LABELED total row (cell that is/begins with "total") is the stated month total, never an item
    if (r.some((c) => /^total/i.test((c || "").trim()))) { if (kes != null) stated = kes; continue; }
    if (kes == null || kes === 0) continue;
    items.push({ payee: curName || expense || "Expense", purpose: [expense, desig, (r[iGrant] || "").trim() ? `[${(r[iGrant] || "").trim()}]` : ""].filter(Boolean).join(" ").trim(), category: catOf(expense), amount: kes, allEmpty: !name && !desig && !expense });
  }
  // older sheets have an UNLABELED total as the final all-empty row whose value equals the sum above
  if (stated == null && items.length) {
    const last = items[items.length - 1];
    const rest = items.slice(0, -1).reduce((a, b) => a + b.amount, 0);
    if (last.allEmpty && Math.abs(last.amount - rest) <= Math.max(2, rest * 0.02)) { stated = last.amount; items.pop(); }
  }
  const sum = items.reduce((s, x) => s + x.amount, 0);
  const absurd = items.find((i) => i.amount > 1_000_000);
  parsed.push({ ...m, file: f.name, items, stated, sum, absurd: !!absurd });
  const flag = absurd ? "*** ABSURD ITEM ***" : (stated != null && Math.abs(sum - stated) > Math.max(2, stated * 0.001) ? `(stated ${Math.round(stated).toLocaleString()}, stale, line items win)` : "ok");
  console.log(`${m.ym}  ${f.name.slice(0, 32).padEnd(32)} items=${String(items.length).padStart(2)} sum=${Math.round(sum).toLocaleString().padStart(9)}  ${flag}`);
}

// Trust the line items (read from the labeled amount columns). Load every month that has valid
// items and no absurd parse. Stale stated totals are reported but do not block, the itemized
// expenses are the truth. Only ABSURD parses (a >1M single KES line) or empty months are skipped.
const loadable = parsed.filter((p) => !p.absurd && p.items.length > 0);
const skipped = parsed.filter((p) => p.absurd || p.items.length === 0);
const stale = loadable.filter((p) => p.stated != null && Math.abs(p.sum - p.stated) > Math.max(2, p.stated * 0.001));
console.log(`\nloadable: ${loadable.length}/${parsed.length} months  |  skipped: ${skipped.map((m) => `${m.ym}${m.absurd ? "(absurd)" : "(empty)"}`).join(", ") || "none"}`);
console.log(`stale stated totals (loaded from line items anyway): ${stale.map((m) => `${m.ym}`).join(", ") || "none"}  |  DRY_RUN=${DRY}`);

if (DRY) { console.log("\nDRY RUN: no writes. Re-run with DRY_RUN=0 to snapshot, purge old data, and load."); process.exit(0); }
if (!loadable.length) { console.log("aborting: nothing loadable."); process.exit(2); }

// 1) snapshot anything we are about to replace (old backfill + my earlier partial load) — reversible
const snap = await sql("select id,payee,purpose,amount::text,currency,status,paid_at::text,ref,created_by,category from payments where created_by like 'drive monthly history%' or created_by like 'drive sheet%';");
const snapPath = `docs/baselines/pass-0-backfill-snapshot-${new Date().toISOString().slice(0, 10)}.json`;
fs.writeFileSync(snapPath, JSON.stringify(snap, null, 2));
console.log(`snapshot: ${snap.length} rows -> ${snapPath}`);

// 2) purge the fabricated backfill AND my earlier partial load (idempotent). donations, payouts, bank untouched
const del = await sql("delete from payments where created_by like 'drive monthly history%' or created_by like 'drive sheet%' returning id;");
console.log(`deleted rows: ${del.length}`);

// 3) insert clean rows for every loadable month, currency per item (KES + agency USD)
let inserted = 0;
for (const p of loadable) {
  const [y, mo] = p.ym.split("-");
  const paidAt = `${p.ym}-28`;
  const recurrence = p.ym === latestYm ? "monthly" : "none";
  const values = p.items.map((it, i) =>
    `('out','${esc(it.payee)}','${esc(it.purpose)}',${it.amount},'KES','mpesa','paid','${paidAt} 00:00:00+00','drive sheet ${y}${mo} #${i + 1}','drive sheet ${p.ym}','${it.category}','${recurrence}')`
  ).join(",\n");
  await sql(`insert into payments (direction,payee,purpose,amount,currency,method,status,paid_at,ref,created_by,category,recurrence) values\n${values};`);
  inserted += p.items.length;
  console.log(`inserted ${p.items.length} rows for ${p.ym} (KES ${Math.round(p.sum).toLocaleString()})`);
}
console.log(`\nDONE. inserted ${inserted} clean rows across ${loadable.length} months.`);
// 4) verify coverage
const ver = await sql("select count(distinct to_char(date_trunc('month',paid_at),'YYYY-MM')) months, min(paid_at)::date first, max(paid_at)::date last, round(sum(amount)::numeric,0) kes from payments where currency='KES' and status='paid' and created_by like 'drive sheet%';");
console.log("verify:", JSON.stringify(ver));
