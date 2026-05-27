// Extract bank-statement transactions with a HARD reconciliation gate. Sends the
// statement PDF to Claude (it OCRs + structures), then refuses to write anything
// unless the parsed rows sum back to the bank's own stated debit/credit totals AND
// opening - debits + credits == closing. Financial data: no unverified figures land.
// Idempotent per source_doc_id. Usage: node scripts/ocr-bank.mjs nisria
import fs from "node:fs";
import crypto from "node:crypto";
import { execSync } from "node:child_process";

const env = fs.readFileSync(new URL("../.env.seed", import.meta.url), "utf8");
const g = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim().replace(/^"|"$/g, "") || "";
const URL_ = g("SUPABASE_URL").replace(/\/$/, ""), KEY = g("SUPABASE_SERVICE_KEY");
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "User-Agent": "Mozilla/5.0", "Content-Type": "application/json" };
const SA = JSON.parse(Buffer.from(g("GOOGLE_SERVICE_ACCOUNT_B64"), "base64").toString());
const ANTHROPIC = execSync("security find-generic-password -s rinq-anthropic-key -w", { encoding: "utf8" }).trim();

const STATEMENTS = {
  nisria: {
    docId: "2637a200-515c-40bc-806e-875118eb857d", fileId: "1sgXg70z6BTAJrOxcAEVtglMQyhv_NZTX",
    account: "Absa 2043066008 · Nisria CBO (UWEZO KES)", currency: "KES",
    opening: 3203234.40, closing: 447370.65, debitTotal: 7163825.95, creditTotal: 4407962.20,
  },
};

async function driveToken() {
  const now = Math.floor(Date.now() / 1000);
  const h = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const c = Buffer.from(JSON.stringify({ iss: SA.client_email, scope: "https://www.googleapis.com/auth/drive.readonly", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })).toString("base64url");
  const sig = crypto.sign("RSA-SHA256", Buffer.from(`${h}.${c}`), SA.private_key).toString("base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${h}.${c}.${sig}` }) });
  return (await r.json()).access_token;
}

const key = process.argv[2] || "nisria";
const S = STATEMENTS[key];
if (!S) { console.log("unknown statement", key); process.exit(1); }

console.log(`downloading ${key} statement…`);
const tok = await driveToken();
const dl = await fetch(`https://www.googleapis.com/drive/v3/files/${S.fileId}?alt=media&supportsAllDrives=true`, { headers: { authorization: `Bearer ${tok}` } });
const b64 = Buffer.from(await dl.arrayBuffer()).toString("base64");
console.log(`  pdf ${(b64.length / 1.37 / 1e6).toFixed(1)}MB -> Claude`);

const prompt = `This is a scanned Kenyan bank statement (Absa). Extract EVERY transaction line into JSON. Return ONLY the JSON object, no prose:
{"transactions":[{"date":"YYYY-MM-DD","description":"...","debit":0,"credit":0,"balance":0}]}

CRITICAL — the statement states its own control totals. Your extraction MUST reconcile to them:
- Opening balance: ${S.opening}
- Closing balance: ${S.closing}
- ${119} DEBIT (money OUT) transactions totaling ${S.debitTotal}
- ${23} CREDIT (money IN) transactions totaling ${S.creditTotal}
So there are about 142 rows total. opening - sum(debits) + sum(credits) MUST equal closing.

Column rules: each row has EITHER a debit (money out: cheque withdrawals, fees, excise duty, statement fees, outgoing transfers) OR a credit (money in: inward TT, PESALINK in, deposits, incoming funds transfer). The third money column is the running BALANCE — never put a balance figure into debit or credit. The running balance should DECREASE on a debit and INCREASE on a credit; use that to decide which column a figure belongs to.

Before you answer: sum your debits and credits, check they match ${S.debitTotal} and ${S.creditTotal} and that opening - debits + credits = ${S.closing}. If they do not match, re-read the scan and fix the misread rows (most errors are a debit wrongly placed as a credit, or a balance figure copied into an amount). Only return the JSON once it reconciles. Be meticulous with digits.`;

const ar = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: { "x-api-key": ANTHROPIC, "anthropic-version": "2023-06-01", "content-type": "application/json" },
  body: JSON.stringify({
    model: "claude-opus-4-7", max_tokens: 32000,
    messages: [{ role: "user", content: [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
      { type: "text", text: prompt },
    ] }],
  }),
});
const aj = await ar.json();
if (!aj.content) { console.log("CLAUDE ERR", JSON.stringify(aj).slice(0, 400)); process.exit(1); }
let raw = aj.content.map((c) => c.text || "").join("");
raw = raw.replace(/^```json?/i, "").replace(/```$/i, "").trim();
const m = raw.match(/\{[\s\S]*\}/);
const parsed = JSON.parse(m ? m[0] : raw);
const txns = parsed.transactions || [];

// ---- reconciliation gate ----
const round = (n) => Math.round(n * 100) / 100;
const dTot = round(txns.reduce((s, t) => s + (Number(t.debit) || 0), 0));
const cTot = round(txns.reduce((s, t) => s + (Number(t.credit) || 0), 0));
const computedClose = round(S.opening - dTot + cTot);
const tol = 1.0; // 1 KES tolerance for OCR rounding
const okDebit = Math.abs(dTot - S.debitTotal) <= tol;
const okCredit = Math.abs(cTot - S.creditTotal) <= tol;
const okClose = Math.abs(computedClose - S.closing) <= tol;

console.log(`\nparsed ${txns.length} transactions`);
console.log(`  debits  ${dTot}  vs stated ${S.debitTotal}  ${okDebit ? "OK" : "MISMATCH"}`);
console.log(`  credits ${cTot}  vs stated ${S.creditTotal}  ${okCredit ? "OK" : "MISMATCH"}`);
console.log(`  opening-debits+credits = ${computedClose}  vs closing ${S.closing}  ${okClose ? "OK" : "MISMATCH"}`);

if (!(okDebit && okCredit && okClose)) {
  console.log("\nRECONCILIATION FAILED — NOT writing to bank_transactions. (Numbers must match the bank's own totals.)");
  fs.writeFileSync(`/tmp/bank-${key}.json`, JSON.stringify(parsed, null, 2));
  console.log(`parsed rows saved to /tmp/bank-${key}.json for inspection.`);
  process.exit(2);
}

// ---- commit (idempotent) ----
await fetch(`${URL_}/rest/v1/bank_transactions?source_doc_id=eq.${S.docId}`, { method: "DELETE", headers: H });
const rows = txns.map((t, i) => ({
  account: S.account, txn_date: t.date, description: String(t.description || "").slice(0, 300),
  amount: (Number(t.debit) || 0) > 0 ? Number(t.debit) : Number(t.credit) || 0,
  currency: S.currency, direction: (Number(t.debit) || 0) > 0 ? "out" : "in",
  balance: Number(t.balance) || null, source_doc_id: S.docId, confidence: "high",
  signature: `${S.docId}#${i}`,
}));
for (let i = 0; i < rows.length; i += 200) {
  const r = await fetch(`${URL_}/rest/v1/bank_transactions`, { method: "POST", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify(rows.slice(i, i + 200)) });
  if (!r.ok) { console.log("INSERT FAIL", r.status, (await r.text()).slice(0, 200)); process.exit(1); }
}
console.log(`\nRECONCILED ✓ — wrote ${rows.length} transactions to bank_transactions for ${S.account}`);
