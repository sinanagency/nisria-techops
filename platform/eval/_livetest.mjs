// LIVE END-TO-END TEST (Taona-approved). Sends a SIGNED WhatsApp webhook to the
// production bot AS THE OWNER (Taona, 971501168462) — NEVER Nur (971501622716).
// The bot replies to Taona's number only. We then read events to confirm.
import fs from "node:fs";
import crypto from "node:crypto";
const env = Object.fromEntries(fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));

const OWNER = "971501168462"; // Taona
const NUR = "971501622716";
const text = process.argv[2] || "show me the draft";
if (text.includes(NUR)) { console.error("REFUSING: test references Nur's number"); process.exit(1); }

const wamid = "wamid.LIVETEST_" + Date.now().toString(36).toUpperCase();
const payload = {
  object: "whatsapp_business_account",
  entry: [{ id: "TEST", changes: [{ field: "messages", value: {
    messaging_product: "whatsapp",
    metadata: { display_phone_number: "0", phone_number_id: "0" },
    contacts: [{ wa_id: OWNER, profile: { name: "Taona" } }],
    messages: [{ from: OWNER, id: wamid, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text } }],
  } }] }],
};
const raw = JSON.stringify(payload);
const sig = "sha256=" + crypto.createHmac("sha256", env.WHATSAPP_APP_SECRET).update(raw).digest("hex");

const r = await fetch("https://command.nisria.co/api/whatsapp/webhook", {
  method: "POST",
  headers: { "content-type": "application/json", "x-hub-signature-256": sig },
  body: raw,
});
console.log(`SENT as OWNER (..8462): "${text}"`);
console.log(`webhook -> ${r.status} ${(await r.text()).slice(0, 80)}`);
console.log(`wamid: ${wamid}`);
