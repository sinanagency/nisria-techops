#!/usr/bin/env node
// Google Ads API runner for Nisria — reuses the SAME service-account + domain-wide
// delegation engine as lib/gcal.ts (impersonates sasa@nisria.co), so no OAuth
// refresh-token dance. Talks to the Google Ads REST API directly with a bearer
// access token. The dev token comes from Keychain (nisria-google-ads-dev-token)
// or env GOOGLE_ADS_DEVELOPER_TOKEN.
//
// Usage:
//   node scripts/gads.mjs whoami                     # list accessible customer IDs (also validates auth + token level)
//   node scripts/gads.mjs campaigns <customerId>     # list campaigns on an account
//   node scripts/gads.mjs whoami --login <mgrId>     # set login-customer-id (manager) header
//
// customerId / mgrId: digits only, no dashes (1234567890 not 123-456-7890).

import crypto from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://googleads.googleapis.com/v22";
const SCOPE = "https://www.googleapis.com/auth/adwords";
const SUBJECT = process.env.NISRIA_ADS_IMPERSONATE || "sasa@nisria.co";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- load GOOGLE_SERVICE_ACCOUNT_B64 from .env.seed / .env.local (values may be quoted) ---
function loadEnvVar(name) {
  if (process.env[name]) return process.env[name];
  for (const f of [".env.local", ".env.seed", ".env"]) {
    const p = path.join(__dirname, "..", f);
    if (!fs.existsSync(p)) continue;
    const line = fs.readFileSync(p, "utf8").split(/\r?\n/).find((l) => l.startsWith(name + "="));
    if (line) return line.slice(name.length + 1).replace(/^["']|["']$/g, "");
  }
  return null;
}

function devToken() {
  if (process.env.GOOGLE_ADS_DEVELOPER_TOKEN) return process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  try {
    return execSync('security find-generic-password -a "nisria-google-ads-dev-token" -w', { encoding: "utf8" }).trim();
  } catch {
    throw new Error("dev token not found (Keychain nisria-google-ads-dev-token or env GOOGLE_ADS_DEVELOPER_TOKEN)");
  }
}

function sa() {
  const b64 = loadEnvVar("GOOGLE_SERVICE_ACCOUNT_B64");
  if (!b64) throw new Error("GOOGLE_SERVICE_ACCOUNT_B64 not found in env/.env.seed");
  const j = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  return { client_email: j.client_email, private_key: j.private_key, client_id: j.client_id };
}

// JWT-bearer grant with domain-wide delegation — identical shape to gcal.ts.
async function token() {
  const s = sa();
  const nowS = Math.floor(Date.now() / 1000);
  const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const claim = { iss: s.client_email, sub: SUBJECT, scope: SCOPE, aud: "https://oauth2.googleapis.com/token", iat: nowS, exp: nowS + 3600 };
  const input = `${b64u({ alg: "RS256", typ: "JWT" })}.${b64u(claim)}`;
  const sig = crypto.sign("RSA-SHA256", Buffer.from(input), s.private_key).toString("base64url");
  const jwt = `${input}.${sig}`;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const j = await r.json();
  if (!j.access_token) {
    throw new Error(`token mint failed: ${j.error || ""} ${j.error_description || ""}\n` +
      `(If 'unauthorized_client': the SA client_id ${s.client_id} is NOT yet authorized for the adwords scope in Workspace Admin → Security → API controls → Domain-wide delegation.)`);
  }
  return j.access_token;
}

function headers(tok, loginCid) {
  const h = { authorization: `Bearer ${tok}`, "developer-token": devToken(), "content-type": "application/json" };
  if (loginCid) h["login-customer-id"] = loginCid;
  return h;
}

// Fetch + tolerant parse. Google Ads errors are JSON, but a bad version / disabled
// API / interstitial returns HTML — capture the raw text so we can diagnose.
async function req(url, opts) {
  const r = await fetch(url, opts);
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { ok: r.ok, status: r.status, json, text };
}

function explain(status, body) {
  const msg = JSON.stringify(body);
  const hints = [];
  if (/DEVELOPER_TOKEN_NOT_APPROVED|test account/i.test(msg))
    hints.push("→ Dev token is at TEST access. It can only touch test accounts. Apply for Basic access in the Ads API Center.");
  if (/DEVELOPER_TOKEN_PROHIBITED|invalid.*developer.*token/i.test(msg))
    hints.push("→ Dev token invalid or wrong manager account.");
  if (/PERMISSION_DENIED|USER_PERMISSION_DENIED/i.test(msg))
    hints.push(`→ ${SUBJECT} may not have access to that customer ID, or login-customer-id (manager) is missing/wrong.`);
  if (/unauthorized_client|invalid_grant/i.test(msg))
    hints.push("→ DWD not authorized: add the SA client_id for scope https://www.googleapis.com/auth/adwords in Workspace Admin.");
  return `HTTP ${status}\n${JSON.stringify(body, null, 2)}${hints.length ? "\n\n" + hints.join("\n") : ""}`;
}

async function whoami(loginCid) {
  const tok = await token();
  const { ok, status, json, text } = await req(`${API}/customers:listAccessibleCustomers`, { headers: headers(tok, loginCid) });
  if (!ok || !json) {
    if (json) console.error(explain(status, json));
    else console.error(`HTTP ${status} — non-JSON response (first 400 chars):\n${text.slice(0, 400)}\n\n→ Usually means wrong API version in the URL, or the Google Ads API is not enabled on GCP project crack-cogency-497521-r0.`);
    process.exit(1);
  }
  const body = json;
  const names = (body.resourceNames || []);
  console.log(`✅ Auth works. ${SUBJECT} can access ${names.length} account(s):`);
  for (const n of names) {
    const id = n.split("/")[1];
    const pretty = id.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3");
    console.log(`   • ${pretty}  (${id})`);
  }
  console.log("\nNext: node scripts/gads.mjs campaigns <id>  (use one of the ids above, digits only)");
}

async function campaigns(cid, loginCid) {
  if (!cid) throw new Error("usage: gads.mjs campaigns <customerId>");
  const tok = await token();
  const query = "SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type FROM campaign ORDER BY campaign.id";
  const r = await fetch(`${API}/customers/${cid}/googleAds:searchStream`, {
    method: "POST", headers: headers(tok, loginCid), body: JSON.stringify({ query }),
  });
  const body = await r.json();
  if (!r.ok) { console.error(explain(r.status, body)); process.exit(1); }
  const rows = (Array.isArray(body) ? body : [body]).flatMap((b) => b.results || []);
  if (!rows.length) { console.log("(no campaigns on this account yet)"); return; }
  console.log(`Campaigns on ${cid}:`);
  for (const row of rows) {
    const c = row.campaign;
    console.log(`   • [${c.status}] ${c.name}  (${c.advertisingChannelType}, id ${c.id})`);
  }
}

async function info(cid, loginCid) {
  if (!cid) throw new Error("usage: gads.mjs info <customerId>");
  const tok = await token();
  const query = "SELECT customer.id, customer.descriptive_name, customer.manager, customer.test_account, customer.currency_code, customer.time_zone FROM customer";
  const { ok, status, json, text } = await req(`${API}/customers/${cid}/googleAds:searchStream`, {
    method: "POST", headers: headers(tok, loginCid), body: JSON.stringify({ query }),
  });
  if (!ok || !json) { console.error(json ? explain(status, json) : `HTTP ${status}\n${text.slice(0, 300)}`); process.exit(1); }
  const rows = (Array.isArray(json) ? json : [json]).flatMap((b) => b.results || []);
  for (const r of rows) {
    const c = r.customer;
    console.log(`${cid}: "${c.descriptiveName}"  manager=${!!c.manager}  test=${!!c.testAccount}  ${c.currencyCode} ${c.timeZone}`);
  }
}

// Set every non-removed campaign to a new status. action = "PAUSED" (reversible) or "REMOVED" (permanent).
async function cleanCampaigns(cid, action, loginCid) {
  if (!cid) throw new Error("usage: gads.mjs clean <customerId> --status PAUSED|REMOVED");
  if (!["PAUSED", "REMOVED", "ENABLED"].includes(action)) throw new Error("status must be PAUSED, REMOVED or ENABLED");
  const tok = await token();
  // find all campaigns not already removed
  const q = "SELECT campaign.id, campaign.name, campaign.status FROM campaign WHERE campaign.status != 'REMOVED'";
  const sr = await req(`${API}/customers/${cid}/googleAds:searchStream`, { method: "POST", headers: headers(tok, loginCid), body: JSON.stringify({ query: q }) });
  if (!sr.ok || !sr.json) { console.error(sr.json ? explain(sr.status, sr.json) : `HTTP ${sr.status}\n${sr.text.slice(0,300)}`); process.exit(1); }
  const rows = (Array.isArray(sr.json) ? sr.json : [sr.json]).flatMap((b) => b.results || []);
  if (!rows.length) { console.log("Already at 0 active campaigns. Nothing to do."); return; }
  // REMOVE uses a dedicated remove op (resource name only); PAUSE/ENABLE use update+mask.
  const operations = rows.map((r) => {
    const rn = `customers/${cid}/campaigns/${r.campaign.id}`;
    return action === "REMOVED" ? { remove: rn } : { update: { resourceName: rn, status: action }, updateMask: "status" };
  });
  const mr = await req(`${API}/customers/${cid}/campaigns:mutate`, { method: "POST", headers: headers(tok, loginCid), body: JSON.stringify({ operations, partialFailure: false }) });
  if (!mr.ok || !mr.json) { console.error(mr.json ? explain(mr.status, mr.json) : `HTTP ${mr.status}\n${mr.text.slice(0,400)}`); process.exit(1); }
  console.log(`✅ Set ${operations.length} campaign(s) to ${action}:`);
  for (const r of rows) console.log(`   • ${r.campaign.name}`);
}

// 2-3 day optimization check: pulls metrics + flags negatives/low-QS/CTR risk.
async function report(cid, loginCid) {
  if (!cid) throw new Error("usage: gads.mjs report <customerId>");
  const tok = await token();
  const run = async (query) => {
    const { ok, status, json, text } = await req(`${API}/customers/${cid}/googleAds:searchStream`, { method: "POST", headers: headers(tok, loginCid), body: JSON.stringify({ query }) });
    if (!ok || !json) { console.error(json ? explain(status, json) : `HTTP ${status} ${text.slice(0,200)}`); return []; }
    return (Array.isArray(json) ? json : [json]).flatMap((b) => b.results || []);
  };
  const num = (m) => Number(m || 0);
  // 1) campaign metrics last 7 days
  const camps = await run("SELECT campaign.name, metrics.impressions, metrics.clicks, metrics.ctr, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM campaign WHERE campaign.status='ENABLED' AND segments.date DURING LAST_7_DAYS");
  let imp=0, clk=0, conv=0, val=0;
  console.log("=== CAMPAIGNS (last 7 days) ===");
  for (const r of camps) { const m=r.metrics; imp+=num(m.impressions); clk+=num(m.clicks); conv+=num(m.conversions); val+=num(m.conversionsValue);
    console.log(`  ${r.campaign.name}: ${num(m.impressions)} impr, ${num(m.clicks)} clk, CTR ${(num(m.ctr)*100).toFixed(1)}%, ${num(m.conversions)} conv, $${num(m.conversionsValue).toFixed(0)} value`); }
  const acctCtr = imp? (clk/imp*100):0;
  console.log(`  ACCOUNT: ${imp} impr, ${clk} clk, CTR ${acctCtr.toFixed(2)}% ${acctCtr<5&&imp>50?'⚠️ BELOW 5% (suspension risk)':''}, ${conv} conv, $${val.toFixed(0)}`);
  // 2) wasteful search terms (clicks, no conv) -> negative candidates
  const terms = await run("SELECT search_term_view.search_term, metrics.clicks, metrics.conversions, metrics.cost_micros FROM search_term_view WHERE segments.date DURING LAST_7_DAYS AND metrics.clicks > 1 ORDER BY metrics.clicks DESC LIMIT 25");
  const waste = terms.filter(r=>num(r.metrics.conversions)===0 && num(r.metrics.clicks)>=2);
  console.log(`\n=== NEGATIVE CANDIDATES (clicks, 0 conv) — ${waste.length} ===`);
  waste.slice(0,15).forEach(r=>console.log(`  "${r.searchTermView.searchTerm}" — ${num(r.metrics.clicks)} clk`));
  // 3) low quality score keywords
  const lowqs = await run("SELECT ad_group_criterion.keyword.text, ad_group_criterion.quality_info.quality_score FROM ad_group_criterion WHERE ad_group_criterion.type='KEYWORD' AND ad_group_criterion.status='ENABLED' AND ad_group_criterion.quality_info.quality_score <= 2");
  console.log(`\n=== LOW QUALITY SCORE (<=2, consider pausing) — ${lowqs.length} ===`);
  lowqs.slice(0,15).forEach(r=>console.log(`  "${r.adGroupCriterion.keyword.text}" QS=${r.adGroupCriterion.qualityInfo?.qualityScore}`));
  console.log("\n(no changes made — review and tell me what to cut)");
}

// Raw GAQL passthrough for diagnostics: gads.mjs gaql "<query>" <customerId>
async function gaql(query, cid, loginCid) {
  if (!query || !cid) throw new Error('usage: gads.mjs gaql "<GAQL>" <customerId>');
  const tok = await token();
  const { ok, status, json, text } = await req(`${API}/customers/${cid}/googleAds:searchStream`, {
    method: "POST", headers: headers(tok, loginCid), body: JSON.stringify({ query }),
  });
  if (!ok || !json) { console.error(json ? explain(status, json) : `HTTP ${status}\n${text.slice(0,400)}`); process.exit(1); }
  const rows = (Array.isArray(json) ? json : [json]).flatMap((b) => b.results || []);
  console.log(JSON.stringify(rows, null, 2));
}

async function conversions(cid, loginCid) {
  if (!cid) throw new Error("usage: gads.mjs conversions <customerId>");
  const tok = await token();
  const query = "SELECT conversion_action.id, conversion_action.name, conversion_action.status, conversion_action.type, conversion_action.category, conversion_action.counting_type, conversion_action.value_settings.default_value FROM conversion_action ORDER BY conversion_action.status";
  const { ok, status, json, text } = await req(`${API}/customers/${cid}/googleAds:searchStream`, {
    method: "POST", headers: headers(tok, loginCid), body: JSON.stringify({ query }),
  });
  if (!ok || !json) { console.error(json ? explain(status, json) : `HTTP ${status}\n${text.slice(0,300)}`); process.exit(1); }
  const rows = (Array.isArray(json) ? json : [json]).flatMap((b) => b.results || []);
  if (!rows.length) { console.log("⚠️  NO conversion actions exist on this account. Tracking is NOT set up — this is the keystone blocker."); return; }
  console.log(`Conversion actions on ${cid}:`);
  for (const r of rows) {
    const c = r.conversionAction;
    console.log(`   • [${c.status}] ${c.name} — ${c.category}/${c.type}, count=${c.countingType}, defaultValue=${c.valueSettings?.defaultValue ?? "none"}`);
  }
}

const [cmd, ...rest] = process.argv.slice(2);
const statusIdx = rest.indexOf("--status");
const statusArg = statusIdx >= 0 ? rest[statusIdx + 1] : null;
const loginIdx = rest.indexOf("--login");
const loginCid = loginIdx >= 0 ? rest[loginIdx + 1] : (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || undefined);
const flags = new Set(["--login", "--status"]);
const positional = rest.filter((a, i) => !flags.has(a) && !flags.has(rest[i - 1]));

try {
  if (cmd === "whoami") await whoami(loginCid);
  else if (cmd === "info") await info(positional[0], loginCid);
  else if (cmd === "campaigns") await campaigns(positional[0], loginCid);
  else if (cmd === "conversions") await conversions(positional[0], loginCid);
  else if (cmd === "gaql") await gaql(positional[0], positional[1], loginCid);
  else if (cmd === "report") await report(positional[0], loginCid);
  else if (cmd === "clean") await cleanCampaigns(positional[0], statusArg, loginCid);
  else {
    console.log("commands:\n  whoami [--login <mgrId>]\n  info <customerId>\n  campaigns <customerId>\n  clean <customerId> --status PAUSED|REMOVED");
    process.exit(1);
  }
} catch (e) {
  console.error("✗ " + e.message);
  if (e.cause) console.error("  cause:", e.cause?.code || e.cause?.message || e.cause);
  process.exit(1);
}
