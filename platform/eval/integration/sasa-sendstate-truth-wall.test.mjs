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
  // Phase-1 re-key: reads the un-blind `messages` store by contact_id (the bulk replies)…
  if (!/from\("messages"\)\.select\("contact_id,created_at"\)\.eq\("direction", "out"\)/.test(SA)) fail("T2d it must read the un-blind messages store (by contact_id, direction=out)");
  // …UNION the events store by to_name (proactive message_person sends that write no messages row)
  if (!/UNION the second store[\s\S]{0,600}?from\("events"\)\.select\("created_at,payload"\)\.eq\("type", "whatsapp\.message_out"\)/.test(SA)) fail("T2e it must UNION events.message_out (real to_name) so proactive sends like Cynthia aren't missed");
  else ok("T2 the guard reads BOTH stores (messages by contact_id + events by to_name) — no blind spot");
}

// ---- T4: tier-gate (no leak) + no over-share fallback (skeptic #5/#6) ----
{
  if (!/const canAnswerSendState = !inGroup && \(opts\.operatorRank === "owner" \|\| opts\.operatorRank === "founder"\);/.test(SA)) fail("T4a the deterministic answer must be tier-gated to owner/founder on a private line (no team/group leak)");
  if (!/if \(asked\.length === 0\) return null;/.test(SA)) fail("T4b an unresolved NAMED/pronoun subject must return null (honest 'let me check'), NOT dump the roster");
  // the roster list is allowed ONLY for an explicit 'who did you message' question, gated by the who-regex
  if (!/A LIST question[\s\S]{0,500}?Today I have messaged \$\{joinNames\(all\)\}/.test(SA)) fail("T4c the roster list may appear ONLY inside the explicit 'who did you message' branch (not as an unresolved fallback)");
  // tz-correct 'today' (skeptic #3): filtered to the Dubai calendar day, not now-18h
  if (!/dayKey\(String\(m\?\.created_at \|\| ""\)\) !== todayKey\) continue;/.test(SA)) fail("T4d sends must be filtered to the operator's calendar today (tz-correct), not a rolling window");
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
    const cmd = command.toLowerCase();
    let asked = [];
    for (const key of byName.keys()) if (new RegExp(`\\b${key}\\b`).test(cmd)) asked.push(key);
    if (asked.length === 0 && /\b(?:them|they|her|him)\b/.test(cmd)) {
      const hist = history.map((m) => m.content).join(" ").toLowerCase();
      for (const key of byName.keys()) if (new RegExp(`\\b${key}\\b`).test(hist)) asked.push(key);
    }
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
  const history = [{ role: "user", content: "Did you follow up with Mark and Cynthia on their tasks" }];
  // pronoun command → resolve from history
  eq(resolve("Did you text them today?", history, byName), ["mark", "cynthia"], "T3b a pronoun command resolves 'them' from recent history");
  // NAMED command → resolve from the COMMAND only, never bleed a different person from history (skeptic #2)
  eq(resolve("did you text mark today?", [{ role: "user", content: "remind cynthia about the report" }], byName), ["mark"], "T3b2 a NAMED question never bleeds a different person from history");
  // the answer that gets built (named command resolves both)
  const join = (n) => n.length === 2 ? `${n[0]} and ${n[1]}` : n.join(", ");
  const sent = resolve("did you text mark and cynthia today?", history, byName).map((a) => byName.get(a));
  eq(`Yes, I did message ${join(sent)} earlier today.`, "Yes, I did message Mark Njambi and Cynthia Mwangi earlier today.", "T3c builds the truthful answer that prod data proved");
}

// ---- T5: the OVERRIDE fires independent of any verify tool (the live recurrence) ----
{
  // source-seam: the override branch exists, is FIRST, and is NOT gated on a verify tool
  if (!/let sendStateTruth: string \| null = null;/.test(SA)) fail("T5a the deterministic send-state override must exist");
  const blk = SA.slice(SA.indexOf("let sendStateTruth"), SA.indexOf("let sendStateTruth") + 700);
  if (!/SEND_STATE_QUESTION\.test\(String\(opts\.command/.test(blk)) fail("T5b gated on a send-state question");
  if (!/SEND_STATE_DENIAL\.test\(String\(reply/.test(blk)) fail("T5c gated on a send-state DENIAL (not any claim — so a correct affirmation is never clobbered)");
  if (!/!toolRuns\.some\(\(t\) => SEND_TOOLS\.has\(t\.name\)/.test(blk)) fail("T5d exempts a genuine send THIS turn");
  if (/VERIFY_TOOLS/.test(blk)) fail("T5e the override must NOT depend on a verify tool (that gate is what let the lie ship)");
  // it must run BEFORE claimsStagingWithoutTool (be the first finalize branch)
  if (!(SA.indexOf("let sendStateTruth") < SA.indexOf("if (claimsStagingWithoutTool"))) fail("T5f the override must be the first finalize branch");
  if (!/sasa\.send_state_answered_from_log/.test(SA)) fail("T5g must emit an observable event");

  // behavioural mirror of the GATING — must pass even with a verify tool in toolRuns
  const SEND_STATE_QUESTION = (() => { const m = SA.match(/const SEND_STATE_QUESTION = (\/.*\/i);/); return m ? eval(m[1]) : /$^/; })();
  const SEND_STATE_DENIAL = (() => { const m = SA.match(/const SEND_STATE_DENIAL = (\/.*\/i);/); return m ? eval(m[1]) : /$^/; })();
  const SEND_TOOLS = new Set(["message_person", "post_to_group", "send_file_to_person", "transfer_drive_file"]);
  const gatePasses = (command, reply, toolRuns, rank) => (rank === "owner" || rank === "founder")
    && SEND_STATE_QUESTION.test(command) && SEND_STATE_DENIAL.test(reply)
    && !toolRuns.some((t) => SEND_TOOLS.has(t.name) && t.result?.ok === true);
  const command = "Did you text Mark and Cynthia today?";
  const lie = "I logged that, but I have not actually messaged them. It is on their board and will show in their daily brief. Want me to message them directly now so they see it?";
  // the LIVE failure: a verify tool ran, which defeated the old fix — the override must STILL fire
  eq(gatePasses(command, lie, [{ name: "read_contact_thread", result: { ok: true } }], "founder"), true, "T5h override fires even though a verify tool ran (the exact live recurrence)");
  // a genuine same-turn send is exempt (that's an honest confirmation, not a question-lie)
  eq(gatePasses(command, lie, [{ name: "message_person", result: { ok: true, detail: { delivered: true } } }], "founder"), false, "T5i a real send this turn is exempt");
  // team tier never triggers it (privacy)
  eq(gatePasses(command, lie, [], "member"), false, "T5j team tier never triggers the override");
  // skeptic #1: a CORRECT, richer affirmative reply must NOT be clobbered (denial gate)
  eq(gatePasses(command, "Yes, I sent Mark the report at 9am and he replied he is on it.", [], "founder"), false, "T5k a correct affirmative reply is left intact (not flattened)");
}

// ---- T6: the widened trigger catches the live phrasings the regex missed ----
{
  const SEND_STATE_QUESTION = (() => { const m = SA.match(/const SEND_STATE_QUESTION = (\/.*\/i);/); return m ? eval(m[1]) : /$^/; })();
  // the exact phrasing that slipped through live (no "did you", just "asking if you texted")
  if (!SEND_STATE_QUESTION.test("I am asking if u texted mark and cynthia today?")) fail("T6a trigger must catch 'I am asking if u texted…' (the live miss)");
  if (!SEND_STATE_QUESTION.test("who did u message today from the team")) fail("T6b trigger must catch 'who did u message today'");
  if (!SEND_STATE_QUESTION.test("did u message nur today?")) fail("T6c trigger must catch 'did u message nur'");
  // an action command must NOT trigger recall (don't-break: assign-task stays honest)
  if (SEND_STATE_QUESTION.test("message mark to bring the receipts")) fail("T6d an imperative send command must NOT match the recall trigger");
  // the 'who' list-path regex matches a who-question and not a named one
  const WHO = /\bwho\b[^.?!]{0,16}\b(?:did|have|d)\b[^.?!]{0,12}\b(?:you|u|ya)\b[^.?!]{0,14}\b(?:messag|text|sen[dt]|tell|told|contact|reach|email|ping)/i;
  if (!WHO.test("who did u message today from the team")) fail("T6e the list-path regex must match a 'who did you message' question");
  if (WHO.test("did u text mark today?")) fail("T6f the list-path must NOT fire on a named question");
  else ok("T6 trigger widened to the live phrasings; list-path scoped to 'who' questions; imperatives excluded");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
