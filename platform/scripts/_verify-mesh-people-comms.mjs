// Confirm people + comms routing with 90s spacing (no coalescing). 2 sends only.
import crypto from "node:crypto";
const SECRET = "f898bfcb361e9fc65b46399daa128ae2";
const SVC = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0dmhxdWRvbnZ2c3p1cHpoY2ZsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTUzNzg3OCwiZXhwIjoyMDk1MTEzODc4fQ.a6m6iwh9favoUlgi1BajeIGkMfPfbvDyH-cxFSyE0dM";
const SUPA = "https://ptvhqudonvvszupzhcfl.supabase.co";
const FROM = "971501168462";
const WEBHOOK = "https://command.nisria.co/api/whatsapp/webhook";
const TESTS = [
  { text: "Add Sarah Mwende as a new beneficiary in the program", expect: "people", key: "Sarah Mwende" },
  { text: "Send a WhatsApp message to Violet saying the report is ready", expect: "comms", key: "Violet saying the report" },
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function recentRouted() {
  const r = await fetch(`${SUPA}/rest/v1/events?select=payload,created_at&type=eq.mesh.routed&order=created_at.desc&limit=15`, { headers: { apikey: SVC, Authorization: `Bearer ${SVC}` } });
  return r.ok ? await r.json() : [];
}
const results = [];
for (let i = 0; i < TESTS.length; i++) {
  const t = TESTS[i];
  const id = `wamid.HARNESS_PC_${i}_${Math.floor(Math.random() * 1e9)}`;
  const body = JSON.stringify({ entry: [{ changes: [{ value: { contacts: [{ wa_id: FROM, profile: { name: "MeshTest" } }], messages: [{ from: FROM, id, type: "text", text: { body: t.text } }] } }] }] });
  const sig = crypto.createHmac("sha256", SECRET).update(body).digest("hex");
  const r = await fetch(WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json", "x-hub-signature-256": `sha256=${sig}` }, body });
  console.log(`[${i + 1}/2] sent "${t.text.slice(0, 30)}..." HTTP ${r.status}; waiting 90s for a clean turn...`);
  await sleep(90000);
  const routed = await recentRouted();
  const match = routed.find((e) => (e.payload?.command || "").includes(t.key));
  const got = match ? match.payload?.domain : null;
  const pass = got === t.expect;
  results.push({ ...t, got, pass, conf: match?.payload?.confidence });
  console.log(`     -> routed=${got || "(none)"} expected=${t.expect} ${pass ? "PASS" : "FAIL"} conf=${match?.payload?.confidence ?? "?"}`);
}
console.log("\n" + results.map((r) => `${r.pass ? "PASS" : "FAIL"} ${r.expect} <- ${r.got}`).join("\n"));
process.exit(results.every((r) => r.pass) ? 0 : 1);
