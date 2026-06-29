// H2 + M3 wall (2026-06-29).
// H2: the short-window SEND dedup must key on a full-number hash (recipHash), not the last
//     4 digits, so two different people who share the last 4 + identical text in the same
//     window no longer collide (a real send suppressed as "already sent"). to_last4 stays
//     on events for UX/honesty. The 120-day recency-pick stays on last4 by design (a
//     to_hash switch would empty it for months post-deploy).
// M3: the record_payment soft dedup keys on a short created_at window, not the whole day,
//     so two genuinely separate same-day payments both log (Law 1).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const S = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "smart-tools.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

// ---- H2: the hash helper + dedup comparisons ----
{
  if (!/const recipHash = \(n: string\): string => createHash\("sha256"\)\.update\(phoneKey\(String\(n \|\| ""\)\)\)\.digest\("hex"\)\.slice\(0, 16\)/.test(S))
    fail("H2a recipHash must hash the full normalized number (sha256(phoneKey(n)).slice(0,16))");
  else ok("H2a recipHash hashes the full normalized number");
  if (!/e\.payload\?\.to_hash === rh/.test(S)) fail("H2b relay dedup must compare to_hash, not to_last4");
  else ok("H2b relay dedup compares to_hash");
  if (!/e\?\.payload\?\.to_hash === toHash && e\?\.payload\?\.text === text\.slice\(0, 300\)/.test(S)) fail("H2c resend dedup must compare to_hash");
  else ok("H2c resend dedup compares to_hash");
  if (!/const sameRecipient = \(recent \|\| \[\]\)\.filter\(\(e: any\) => e\?\.payload\?\.to_hash === toHash\)/.test(S)) fail("H2d exact/fuzzy dedup must filter recipients by to_hash");
  else ok("H2d exact+fuzzy dedup filters by to_hash");
  if (!/const claimKey = resend \? `\$\{toHash\}:\$\{textHash\}:\$\{minuteBucket\}:resend:\$\{claimId\}` : `\$\{toHash\}:\$\{textHash\}:\$\{minuteBucket\}`/.test(S))
    fail("H2e the atomic claim key must embed the hash, not last4");
  else ok("H2e atomic claim key embeds the hash");
  // the message_out emits must carry to_hash so the dedup can read it back
  if (!/to_last4: number\.slice\(-4\), to_hash: toHash, text: text\.slice\(0, 300\), via: "template"/.test(S)) fail("H2f the template message_out emit must carry to_hash");
  else if (!/to_last4: number\.slice\(-4\), to_hash: toHash, text: text\.slice\(0, 300\), via: "whatsapp"/.test(S)) fail("H2f the whatsapp message_out emit must carry to_hash");
  else ok("H2f both message_out emits carry to_hash");
  // to_last4 must NOT be removed (UX + NUR_LAST4 + proactive-send honesty still use it)
  if (!/to_last4: number\.slice\(-4\)/.test(S)) fail("H2g to_last4 must stay on events for UX + the honesty layer");
  else ok("H2g to_last4 retained for UX + honesty layer");
}

// ---- H2: collision property (behavioral) ----
{
  const h = (n) => createHash("sha256").update(n).digest("hex").slice(0, 16);
  const a = "254700111234", b = "254733551234"; // two people, same last4 "1234"
  if (a.slice(-4) !== b.slice(-4)) fail("test setup: the two numbers must share last4");
  else if (h(a) === h(b)) fail("H2h the hash must differ for two different numbers sharing last4 (the collision)");
  else ok("H2h same-last4 different-number -> distinct hash keys (collision closed)");
}

// ---- M3: payment dedup is a short window, not the whole day ----
{
  if (/gte\("paid_at", `\$\{day\}T00:00:00Z`\)/.test(S)) fail("M3a payment dedup must NOT collapse the whole day (gte paid_at day-start)");
  else ok("M3a payment dedup no longer uses the whole-day window");
  if (!/const dupSince = new Date\(Date\.now\(\) - 3 \* 60 \* 1000\)\.toISOString\(\);/.test(S)) fail("M3b payment dedup must use a short window");
  else ok("M3b payment dedup uses a short (3-min) window");
  if (!/\.eq\("status", "paid"\)\.gte\("created_at", dupSince\)\.limit\(1\)/.test(S)) fail("M3c payment dedup must key on created_at (log time), not backdatable paid_at");
  else ok("M3c payment dedup keys on created_at");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
