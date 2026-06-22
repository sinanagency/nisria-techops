// Canonical proactive-send record wall (2026-06-23, KT #373, class C1 state-spine). The
// lie-engine class could not be closed at the guard level because no source was both COMPLETE
// and CLEAN: messages.direction='out' is complete but polluted (includes the bot's replies to
// the operator), events.message_out is clean but was thought sparse. Verified: message_out
// carries to_name on every real message_person send; the only null rows are two operator-facing
// status-pings (interim_wait / empty_reply_reask). So the clean+complete record = message_out
// (to_name present) UNION relayed_colleague (delivered). proactiveSendsSince() is the ONE reader
// every honesty decision uses — never the polluted messages table.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeProactiveSends } from "../../lib/proactive-sends.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SASA = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "agents", "sasa.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);
const eq = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? ok(m) : fail(`${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`));

// ---- N1: the normalizer keeps real sends, drops pings + replies + queued ----
{
  const messageOut = [
    { created_at: "t1", payload: { to_name: "Malieng", to_last4: "1234", text: "Sikka brief", via: "whatsapp", wamid: "w1" } }, // real send
    { created_at: "t2", payload: { to: "971501168462", kind: "interim_wait" } },        // status ping -> dropped (no to_name)
    { created_at: "t3", payload: { to: "971501168462", kind: "empty_reply_reask" } },   // status ping -> dropped
  ];
  const relay = [
    { created_at: "t4", payload: { to_name: "Grace", to_last4: "5678", text: "forms dropped", delivered: true } },  // delivered relay
    { created_at: "t5", payload: { to_name: "Mark", to_last4: "9999", text: "held", delivered: false } },           // QUEUED -> dropped
    { created_at: "t6", payload: { to_name: "Violet", to_last4: "0000", text: "ping" } },                            // no delivered flag = kept
  ];
  const out = normalizeProactiveSends(messageOut, relay);
  eq(out.map((s) => s.to_name).sort(), ["Grace", "Malieng", "Violet"], "N1a keeps real sends + delivered relays, drops pings + queued");
  if (out.some((s) => s.text === "held")) fail("N1b a queued/held relay must NOT appear in the record");
  else ok("N1b queued relay excluded (queued is not sent)");
  if (out.some((s) => !s.to_name)) fail("N1c every record row has a recipient (no status-pings)");
  else ok("N1c no status-ping rows (every row is a real send)");
}

// ---- N2: empty/garbage safe ----
{
  eq(normalizeProactiveSends(null, null), [], "N2a null inputs -> empty record");
  eq(normalizeProactiveSends([{ created_at: "t", payload: {} }], []), [], "N2b a row with no to_name -> dropped");
}

// ---- N3: answerSendStateFromLog NOT yet re-pointed (KT #373 OPEN sibling) ----
// The canonical record is CLEAN but INCOMPLETE (a Blue skeptic proved it misses notify/file
// sends → send-blindness). So answerSendStateFromLog deliberately STILL reads the COMPLETE
// (polluted) messages source until a canonical send-event is emitted at every proactive seam.
// This wall documents that the sibling is knowingly open, not silently broken.
{
  const i = SASA.indexOf("async function answerSendStateFromLog");
  const fn = i >= 0 ? SASA.slice(i, i + 2000) : "";
  if (!/class C1, OPEN/.test(fn)) fail("N3a answerSendStateFromLog must carry the KT #373 OPEN note (no silent regression)");
  else ok("N3a answerSendStateFromLog documents the open sibling (complete-but-polluted, until canonical emits land)");
}

// ---- N4: recentlySentTo re-pointed to the same shared reader (zero drift) ----
{
  const i = SASA.indexOf("async function recentlySentTo");
  const fn = i >= 0 ? SASA.slice(i, i + 1200) : "";
  if (/from\("events"\)\.select\("payload"\)\.eq\("type", "whatsapp\.message_out"\)/.test(fn))
    fail("N4a recentlySentTo must NOT inline its own event read — use the shared reader");
  else ok("N4a recentlySentTo no longer inlines the event read");
  if (!/const sends = \(await proactiveSendsSince\(db, since\)\)/.test(fn)) fail("N4b recentlySentTo must read proactiveSendsSince (shared, zero drift)");
  else ok("N4b recentlySentTo uses the shared canonical reader");
}

// ---- N5: sasa.ts imports the shared modules ----
{
  if (!/import \{ proactiveSendsSince \} from "\.\.\/proactive-sends\.mjs";/.test(SASA)) fail("N5a must import proactiveSendsSince");
  else ok("N5a imports proactiveSendsSince");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
