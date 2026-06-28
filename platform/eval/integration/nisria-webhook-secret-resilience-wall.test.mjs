// L1 wall (2026-06-29). When WHATSAPP_APP_SECRET is unset, the webhook must NOT return a
// 5xx: repeated non-200s make Meta disable the webhook subscription, leaving the bot deaf
// even after the secret is restored. It must return 200 (subscription survives), DROP the
// unverified message, and emit a P0 alert. The VERIFIED path (secret set) is unchanged:
// a bad signature still 401s. Source-assertion wall, offline.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const R = fs.readFileSync(path.resolve(HERE, "..", "..", "app", "api", "whatsapp", "webhook", "route.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

const i = R.indexOf("const secret = process.env.WHATSAPP_APP_SECRET;");
const region = i >= 0 ? R.slice(i, i + 900) : "";
if (!region) fail("the app-secret check must exist in the webhook POST");
else {
  if (/WHATSAPP_APP_SECRET not configured", \{ status: 500 \}/.test(region)) fail("L1a missing secret must NOT return 500 (Meta would disable the subscription)");
  else ok("L1a missing secret no longer returns 500");
  if (!/if \(!secret\) \{[\s\S]*?return new NextResponse\("ok", \{ status: 200 \}\);/.test(region)) fail("L1b missing secret must return 200 so the Meta subscription survives");
  else ok("L1b missing secret returns 200 (subscription survives)");
  if (!/whatsapp\.app_secret_missing/.test(region)) fail("L1c missing secret must fire a P0 alert");
  else ok("L1c missing secret fires a P0 alert");
}
// the verified path must still reject a bad signature with 401 (unchanged)
if (!/if \(!safeEqual\(sig, expected\)\) \{[\s\S]*?status: 401/.test(R)) fail("L1d a bad signature on the verified path must still 401");
else ok("L1d verified path still 401s a bad signature (security unchanged)");

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
