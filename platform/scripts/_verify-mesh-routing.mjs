// Live mesh routing verification. Sends 6 signed webhooks AS the allowlisted
// number (bypasses maintenance) with HARNESS ids (writes sandboxed). After each,
// polls the events table for the matching mesh.routed event and checks the domain.
// No real prod data is written. Run: node scripts/_verify-mesh-routing.mjs

import fs from "node:fs";
import crypto from "node:crypto";

const ENV = fs.readFileSync("/tmp/vcverify.env", "utf8") + "\n" + fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => { const m = ENV.match(new RegExp(`^${k}=(.*)$`, "m")); return m ? m[1].trim().replace(/^"|"$/g, "") : ""; };
const SECRET = get("WHATSAPP_APP_SECRET") || "f898bfcb361e9fc65b46399daa128ae2";
const SVC = get("SUPABASE_SERVICE_KEY");
const SUPA = get("SUPABASE_URL");
const FROM = "971501168462"; // allowlisted (bypasses maintenance)
const WEBHOOK = "https://command.nisria.co/api/whatsapp/webhook";

const TESTS = [
  { text: "Remind me to call Mark at 3pm tomorrow", expect: "work", key: "call Mark at 3pm" },
  { text: "Log a payment of KES 5000 for office rent", expect: "money", key: "5000 for office rent" },
  { text: "Add Sarah Mwende as a new beneficiary", expect: "people", key: "Sarah Mwende" },
  { text: "Send a WhatsApp message to Violet saying hello", expect: "comms", key: "to Violet saying hello" },
  { text: "Find the KRA registration document in the library", expect: "knowledge", key: "KRA registration document" },
  { text: "Hello there, how are you", expect: "general", key: "Hello there, how are you" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function recentRouted(limit = 12) {
  const url = `${SUPA}/rest/v1/events?select=type,subject_id,payload,created_at&type=eq.mesh.routed&order=created_at.desc&limit=${limit}`;
  const res = await fetch(url, { headers: { apikey: SVC, Authorization: `Bearer ${SVC}` } });
  return res.ok ? await res.json() : [];
}

const results = [];
for (let i = 0; i < TESTS.length; i++) {
  const t = TESTS[i];
  const id = `wamid.HARNESS_MESH_${i}_${Math.floor(Math.random() * 1e9)}`;
  const body = JSON.stringify({ entry: [{ changes: [{ value: { contacts: [{ wa_id: FROM, profile: { name: "MeshTest" } }], messages: [{ from: FROM, id, type: "text", text: { body: t.text } }] } }] }] });
  const sig = crypto.createHmac("sha256", SECRET).update(body).digest("hex");
  let http = 0;
  try {
    const r = await fetch(WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json", "x-hub-signature-256": `sha256=${sig}` }, body });
    http = r.status;
  } catch (e) { http = -1; }
  process.stdout.write(`[${i + 1}/6] sent "${t.text.slice(0, 32)}..." HTTP ${http} ; waiting for worker...\n`);
  // wait past coalesce window + worker processing
  await sleep(50000);
  const routed = await recentRouted();
  const match = routed.find((e) => (e.payload?.command || "").includes(t.key));
  const got = match ? (match.subject_id || match.payload?.domain) : null;
  const pass = got === t.expect;
  results.push({ text: t.text, expect: t.expect, got, pass, http, conf: match?.payload?.confidence });
  console.log(`     -> routed=${got || "(no mesh.routed found)"} expected=${t.expect} ${pass ? "PASS" : "FAIL"} conf=${match?.payload?.confidence ?? "?"}`);
}

console.log("\n==== ROUTING SUMMARY ====");
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.expect.padEnd(9)} <- got ${String(r.got).padEnd(9)} | ${r.text}`);
const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${TESTS.length} routed correctly.`);
process.exit(passed === TESTS.length ? 0 : 1);
