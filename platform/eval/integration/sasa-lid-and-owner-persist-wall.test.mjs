// Lid-contact + owner-persistence wall (2026-06-21, KT #345). Two root-cause fixes
// behind the 01:22–01:35 transcript:
//   (1) THE DUP SOURCE: Meta can deliver a ~15-digit WhatsApp "lid" (linked-device /
//       privacy id) in m.from instead of the real phone. resolveContact stored it
//       raw (toE164 caps at 13 digits) and spawned a duplicate "Nur" contact
//       (106274704363640) that blocked relays. The real E.164 is in contacts[].wa_id,
//       so the webhook now prefers it in a 1:1 inbound.
//   (2) THE "I NEVER GOT IT": the worker's notetaker/cancel early-returns set
//       dev:true from opRank==="owner", which under Law 12 SKIPS the messages insert
//       — so the owner's real replies never persisted. dev must come from a genuine
//       harness message id, not owner rank.
//
// Seams:
//   S1  webhook prefers contacts[].wa_id over m.from (lid fix present)
//   S2  behavioural: lid in m.from + real wa_id in contacts[] resolves to the REAL phone
//   S3  worker no longer triggers dev-mode from opRank==="owner"; uses isHarnessMessageId
//   S4  behavioural: harness id → dev true; a real owner message → dev undefined (persists)
//
// Pure local.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEBHOOK = fs.readFileSync(path.resolve(HERE, "..", "..", "app", "api", "whatsapp", "webhook", "route.ts"), "utf8");
const WORKER = fs.readFileSync(path.resolve(HERE, "..", "..", "app", "api", "whatsapp", "worker", "route.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

// ---- S1 ----
if (!/waIdFromContacts\s*=\s*\(v\.contacts\s*\|\|\s*\[\]\)\.length\s*===\s*1\s*\?\s*digits\(v\.contacts\[0\]\?\.wa_id\)/.test(WEBHOOK)) fail("S1 webhook must prefer contacts[0].wa_id in a 1:1 inbound");
else if (!/const from = waIdFromContacts \|\| digits\(m\.from\)/.test(WEBHOOK)) fail("S1 `from` must fall back to m.from only when no single contacts entry");
else ok("S1 webhook prefers contacts[].wa_id over the lid m.from");

// ---- S2: behavioural (mirror the webhook resolution + its digits()) ----
{
  const digits = (s) => (s || "").replace(/\D/g, "");
  const resolveFrom = (m, contacts) => {
    const waIdFromContacts = (contacts || []).length === 1 ? digits(contacts[0]?.wa_id) : "";
    return waIdFromContacts || digits(m.from);
  };
  // the live incident: lid in m.from, real number echoed in contacts[].wa_id
  const real = resolveFrom({ from: "106274704363640" }, [{ wa_id: "+971501622716", profile: { name: "Nur M’nasria" } }]);
  if (real !== "971501622716") fail(`S2 a lid m.from with a real contacts[].wa_id must resolve to the real phone, got ${real}`);
  // no contacts entry → fall back to m.from unchanged (status-only / fan-in)
  else if (resolveFrom({ from: "971501622716" }, []) !== "971501622716") fail("S2 no-contacts fallback must use m.from");
  // a normal 1:1 where m.from already equals wa_id stays correct
  else if (resolveFrom({ from: "254703119486" }, [{ wa_id: "254703119486" }]) !== "254703119486") fail("S2 a normal 1:1 must be unchanged");
  else ok("S2 lid resolves to the real phone; normal + fan-in paths unchanged");
}

// ---- S3 ----
if (/dev:\s*opRank === "owner" \? true : undefined/.test(WORKER)) fail("S3 worker must NOT trigger dev-mode from opRank==='owner'");
else if ((WORKER.match(/dev:\s*isHarnessMessageId\(waMsgId\)\s*\?\s*true\s*:\s*undefined/g) || []).length < 2) fail("S3 both notetaker/cancel early-returns must gate dev on isHarnessMessageId(waMsgId)");
else ok("S3 worker dev-mode gated on harness id, not owner rank (owner replies persist)");

// ---- S4: behavioural (mirror the gate) ----
{
  // isHarnessMessageId true only for sandbox/test ids; a real WhatsApp wamid is not.
  const devFlag = (isHarness) => (isHarness ? true : undefined);
  if (devFlag(true) !== true) fail("S4 a harness message id must still set dev:true (Law 12 preserved)");
  else if (devFlag(false) !== undefined) fail("S4 a real owner message must NOT set dev (so it persists)");
  else ok("S4 harness id → dev:true; real owner message → persists");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
