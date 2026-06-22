// Send-state truth wall (Nur 2026-06-22, KT #313 follow-up). Pins the fix for: Nur
// asked "did you text them today?", the bot answered "I have not actually messaged
// them" — a LIE (4 real sends to Mark+Cynthia were in the log). Root: (a) the guard's
// SEND_STATE_CLAIM regex covered "sent" but not "messaged" so it never fired, and
// (b) even when it fired it only promised "let me check" and never checked.
//
// Source-seam asserts the wiring in lib/agents/sasa.ts; behavioural half mirrors the
// recipient-resolution logic (the part the prod proof caught a bug in).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SA = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "agents", "sasa.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);
const eq = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? ok(m) : fail(`${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`));

// ---- T1: the guard now FIRES on a "messaged/texted/told" denial (regex gap) ----
{
  const SEND_STATE_CLAIM = (() => {
    const m = SA.match(/const SEND_STATE_CLAIM = (\/.*\/i);/);
    if (!m) { fail("T1a could not locate SEND_STATE_CLAIM"); return /$^/; }
    return eval(m[1]);
  })();
  if (!SEND_STATE_CLAIM.test("I have not actually messaged them")) fail("T1b SEND_STATE_CLAIM must now match 'have not messaged' (the exact production lie)");
  if (!SEND_STATE_CLAIM.test("I haven't texted them")) fail("T1c must match 'haven't texted'");
  if (!SEND_STATE_CLAIM.test("I didn't notify her")) fail("T1d must match \"didn't notify\"");
  if (!SEND_STATE_CLAIM.test("haven't sent it")) fail("T1e must still match the original 'haven't sent'");
  else ok("T1 SEND_STATE_CLAIM fires on messaged/texted/told/notified denials (not just 'sent')");
}

// ---- T2: the guard branch does a DETERMINISTIC lookup, not a dead 'let me check' ----
{
  if (!/async function answerSendStateFromLog\(/.test(SA)) fail("T2a the deterministic answerer must exist");
  if (!/const truthful = canAnswerSendState \? await answerSendStateFromLog\(db, opts, reply, n\) : null;/.test(SA)) fail("T2b the guard branch must CALL the deterministic lookup (tier-gated)");
  if (!/reply = truthful \|\| humanize\("Let me actually check/.test(SA)) fail("T2c truth is used; 'let me check' is only the fallback when unresolved");
  if (!/from\("events"\)\.select\("created_at,payload"\)\.eq\("type", "whatsapp\.message_out"\)/.test(SA)) fail("T2d it must read the real outbound log (events.whatsapp.message_out)");
  else ok("T2 the guard now pulls the real log and answers from it (no dead 'let me check' promise)");
}

// ---- T4: tier-gate (no leak) + no over-share fallback (skeptic #5/#6) ----
{
  if (!/const canAnswerSendState = !inGroup && \(opts\.operatorRank === "owner" \|\| opts\.operatorRank === "founder"\);/.test(SA)) fail("T4a the deterministic answer must be tier-gated to owner/founder on a private line (no team/group leak)");
  if (!/if \(asked\.length === 0\) return null;/.test(SA)) fail("T4b when the asked person is unresolved it must return null (honest 'let me check'), NOT dump the day's roster");
  if (/today I have messaged \$\{joinNames\(all\)\}/.test(SA)) fail("T4c the over-share 'today I have messaged <everyone>' branch must be removed");
  // tz-correct 'today' (skeptic #3): filtered to the Dubai calendar day, not now-18h
  if (!/dayKey\(String\(e\?\.created_at \|\| ""\)\) !== todayKey\) continue;/.test(SA)) fail("T4d sends must be filtered to the operator's calendar today (tz-correct), not a rolling window");
  else ok("T4 tier-gated, no over-share fallback, tz-correct 'today'");
}

// ---- T3: behavioural mirror of recipient resolution (the bug the prod proof caught) ----
{
  // mirror: clean to_name, skip numeric, intersect ctx with real recipient keys
  const group = (rows) => {
    const byName = new Map();
    for (const e of rows) {
      const clean = String(e.to_name || "").replace(/\s*\([^)]*\)\s*/g, "").trim();
      const key = clean.toLowerCase().split(/\s+/)[0];
      if (!/^[a-z]{2,}$/.test(key)) continue;
      if (!byName.has(key)) byName.set(key, clean);
    }
    return byName;
  };
  const resolve = (command, history, byName) => {
    const ctx = (command + " " + history.map((m) => m.content).join(" ")).toLowerCase();
    const asked = [];
    for (const key of byName.keys()) if (new RegExp(`\\b${key}\\b`).test(ctx)) asked.push(key);
    return [...new Set(asked)];
  };
  // the REAL prod rows (from the proof): two named sends + two numeric-name resends
  const rows = [
    { to_name: "Mark Njambi" },
    { to_name: "Cynthia Mwangi (the one ending 4123)" },
    { to_name: "00254703119486" },
    { to_name: "0025411174123" },
  ];
  const byName = group(rows);
  eq([...byName.values()], ["Mark Njambi", "Cynthia Mwangi"], "T3a numeric recipients skipped, '(the one ending…)' stripped");
  const command = "Did you text them today?";
  const reply = "I have not actually messaged them. Want me to message them now?";
  const history = [{ role: "user", content: "Did you follow up with Mark and Cynthia on their tasks" }, { role: "user", content: command }];
  const asked = resolve(command + " " + reply, history, byName);
  eq(asked, ["mark", "cynthia"], "T3b 'them' resolves to Mark+Cynthia from context (NOT 'message' from 'to message them')");
  // the answer that gets built
  const join = (n) => n.length === 2 ? `${n[0]} and ${n[1]}` : n.join(", ");
  const sent = asked.map((a) => byName.get(a));
  eq(`Yes, I did message ${join(sent)} earlier today.`, "Yes, I did message Mark Njambi and Cynthia Mwangi earlier today.", "T3c builds the truthful answer that prod data proved");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
