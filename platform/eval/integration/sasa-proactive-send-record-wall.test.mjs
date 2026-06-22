// Canonical proactive-send record wall (2026-06-23, KT #373, class C1 state-spine). The
// lie-engine class could not close at the guard level because no source was both COMPLETE and
// CLEAN: messages.direction='out' is complete but polluted (the bot's replies-to-operator),
// events were clean but partial. Fix: ONE canonical record = message_out (to_name) UNION relay
// (delivered) UNION file_sent (to_name, enriched) UNION task.alert_sent (to_names[], enriched).
// Every honesty "did I send" decision reads proactiveSendsSince — never the polluted table.
// A Blue skeptic proved an events-ONLY-but-PARTIAL version went send-blind (missed notify/file);
// this version is clean AND complete for person-sends.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeProactiveSends } from "../../lib/proactive-sends.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SASA = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "agents", "sasa.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);
const eq = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? ok(m) : fail(`${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`));

// ---- N1: the normalizer keeps real sends across ALL source types, drops pings/replies/queued ----
{
  const out = normalizeProactiveSends({
    messageOut: [
      { created_at: "t1", payload: { to_name: "Malieng", to_last4: "1234", text: "Sikka brief", via: "whatsapp" } }, // real send
      { created_at: "t2", payload: { to: "971", kind: "interim_wait" } },        // status ping -> dropped
      { created_at: "t3", payload: { to: "971", kind: "empty_reply_reask" } },   // status ping -> dropped
    ],
    relay: [
      { created_at: "t4", payload: { to_name: "Grace", text: "forms dropped", delivered: true } },  // delivered relay
      { created_at: "t5", payload: { to_name: "Mark", text: "held", delivered: false } },           // QUEUED -> dropped
    ],
    file: [
      { created_at: "t6", payload: { to_name: "Violet", to_last4: "0000", title: "lease.pdf" } },   // file send (KT #373 enriched)
    ],
    taskAlert: [
      { created_at: "t7", payload: { title: "Call the clinic", to_names: ["Cynthia", "Nur"] } },     // task alert to 2 people
    ],
  });
  eq(out.map((s) => s.to_name).sort(), ["Cynthia", "Grace", "Malieng", "Nur", "Violet"], "N1a includes message/relay/file/task-alert sends; drops pings + queued");
  if (out.some((s) => s.text === "held")) fail("N1b a queued/held relay must NOT appear");
  else ok("N1b queued relay excluded");
  if (out.some((s) => !s.to_name)) fail("N1c every row has a recipient (no status-pings)");
  else ok("N1c no status-ping rows");
  // a file send is the 'did you send X the file' sibling — must carry the recipient by name
  if (!out.some((s) => s.to_name === "Violet" && s.via === "file")) fail("N1d a file send must be in the record by name");
  else ok("N1d file send included by name (closes 'did you send X the file')");
  // a task alert is the 'did you remind Cynthia' sibling — must be in the record (no send-blindness)
  if (!out.some((s) => s.to_name === "Cynthia" && s.via === "task_alert")) fail("N1e a task alert must be in the record by name (no send-blindness)");
  else ok("N1e task alert included by name (closes 'did you remind X')");
}

// ---- N2: empty/garbage safe ----
{
  eq(normalizeProactiveSends({}), [], "N2a empty input -> empty record");
  eq(normalizeProactiveSends({ messageOut: [{ created_at: "t", payload: {} }] }), [], "N2b a row with no to_name -> dropped");
  eq(normalizeProactiveSends({ taskAlert: [{ created_at: "t", payload: { title: "x" } }] }), [], "N2c a task alert with no to_names -> dropped");
}

// ---- N3: answerSendStateFromLog re-pointed to the COMPLETE canonical record (seam) ----
{
  const i = SASA.indexOf("async function answerSendStateFromLog");
  const fn = i >= 0 ? SASA.slice(i, i + 2400) : "";
  if (/from\("messages"\)\.select\("contact_id/.test(fn)) fail("N3a answerSendStateFromLog must NOT read the polluted messages table");
  else ok("N3a answerSendStateFromLog no longer reads the polluted messages table");
  if (!/for \(const s of await proactiveSendsSince\(db, since\)\)/.test(fn)) fail("N3b must read the canonical proactiveSendsSince record");
  else ok("N3b reads the canonical (complete+clean) proactive-send record");
  // skeptic D: EXACT first-name match here (no variant) — there is no content-tie to gate a
  // 3-prefix collision (Mark/Martha), so the match must be the exact-word regex test(cmd),
  // and must NOT use isNameVariant (which would false-affirm a different person).
  if (!fn.includes(".test(cmd)")) fail("N3c named subject must be EXACT-matched via test(cmd)");
  else if (fn.includes("isNameVariant")) fail("N3c answerSendStateFromLog must NOT use isNameVariant (no content-tie here → false-affirm risk, skeptic D)");
  else ok("N3c named subject is exact-matched, no variant false-affirm (skeptic D closed)");
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

// ---- N5: the enriched emits carry to_name (so the record is complete by name) ----
{
  const ST = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "smart-tools.ts"), "utf8");
  const NT = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "notify.ts"), "utf8");
  if (!/type: "whatsapp\.file_sent"[^}]*payload: \{ to_name: toName/.test(ST.replace(/\s+/g, " "))) fail("N5a send_file_to_person must emit to_name");
  else ok("N5a file_sent emit carries to_name");
  if (!/to_names: pinged\.map/.test(NT)) fail("N5b pushTaskAlert must emit to_names (recipient names)");
  else ok("N5b task.alert_sent emit carries to_names");
  if (!/import \{ proactiveSendsSince \} from "\.\.\/proactive-sends\.mjs";/.test(SASA)) fail("N5c sasa.ts must import proactiveSendsSince");
  else ok("N5c sasa.ts imports the canonical reader");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
