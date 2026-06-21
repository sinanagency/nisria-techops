// Relay + task + notetaker wall (2026-06-21, KT #358). Four audit-ranked fixes:
//   A (#1a search-dodge): an explicit "text/tell/message X <words>" is caught BEFORE the
//      brain and STAGED for a one-tap "yes", so the model can never run the SEARCH tool
//      instead of sending. Owner/founder only; self/group excluded; no-body gets a guide.
//   B (#1b duplicate-contact): message_person no longer dead-ends "which one?" on a
//      duplicate name — it prefers the number we MOST RECENTLY messaged and shows the
//      last4, only asking when none were ever messaged.
//   C (#2 wrong-task-done): the fuzzy task matcher now ignores connector words, so
//      "meeting with Eliza" can no longer false-match "meeting with Bashir" on the two
//      scaffold words; the distinguishing NAME decides (or it asks).
//   D (#6 notetaker leak): a notetaker dispatch failure no longer pipes the raw infra
//      error to Nur; the real error is captured internally and she gets a clean line.
//
// Pure local (source-seam + behavioural mirrors).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const R = (p) => fs.readFileSync(path.resolve(HERE, "..", "..", p), "utf8");
const W = R("app/api/whatsapp/worker/route.ts");
const SMART = R("lib/smart-tools.ts");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

// ---- A: deterministic SEND route (#1a) ----
{
  const i = W.indexOf("DETERMINISTIC SEND (KT #358");
  const region = i >= 0 ? W.slice(i, i + 4400) : "";
  if (!region) fail("A the deterministic SEND route must exist");
  else if (!(i < W.indexOf("let reply: string | undefined;"))) fail("A the SEND route must run BEFORE the brain");
  else if (!/opRank === "owner" \|\| opRank === "founder"/.test(region)) fail("A the SEND route must be owner/founder only (sending is privileged)");
  else if (!/kind:\s*"send_message"/.test(region) || !/status:\s*"awaiting_confirm"/.test(region)) fail("A an explicit send command must STAGE a send_message for a one-tap yes (never auto-send)");
  else if (!/Want me to send this to \$\{recip\} now: "\$\{words\}"/.test(region)) fail("A the staged send must PREVIEW the recipient + exact text");
  else if (!/SELF\s*=/.test(region) || !/SELF\.test/.test(region)) fail("A self/group recipients must be excluded");
  else if (!/needs_body|what should I send/i.test(region)) fail("A a verb with no body must get a guiding ask, not a dead loop");
  else if (!/bodyStmt/.test(region)) fail("A a statement body ('board IS full') must be rejected, not staged as a send");
  else if (!/recipKnown/.test(region) || !/team_members[\s\S]{0,80}ilike/.test(region)) fail("A the recipient must be a KNOWN team member/contact before staging (kills 'message board...', 'accounts...')");
  else {
    // behavioural mirror of the two send-command regexes + SELF + bodyStmt
    const SELF = /^(?:me|myself|i|us|everyone|everybody|all|the\s+team|the\s+group|team|group|the\s+group\s+chat)$/i;
    const parse = (command) => {
      let recip = "", words = "", m;
      m = command.match(/^\s*(?:please\s+|pls\s+|can\s+you\s+|could\s+you\s+|kindly\s+)?let\s+([a-z][a-z'’.\- ]{1,30}?)\s+know\s+(?:that\s+)?(.+)$/i);
      if (m) { recip = m[1].trim(); words = m[2].trim(); }
      else { m = command.match(/^\s*(?:please\s+|pls\s+|can\s+you\s+|could\s+you\s+|kindly\s+)?(?:text|message|msg|tell|ping|whatsapp|wa)\s+([a-z][a-z'’.\- ]{1,30}?)\s*[:,]?\s+(?:to\s+say\s+|saying\s+|that\s+|to\s+|about\s+)?(.+)$/i); if (m) { recip = m[1].trim(); words = m[2].trim(); } }
      const okRecip = !!recip && !SELF.test(recip) && recip.split(/\s+/).length <= 2
        && !/^(?:the|a|an|that|this|them|him|her|it|my|our|your|his|their)$/i.test(recip);
      const bodyStmt = /^(?:is|are|was|were|be|been|being|will|would|should|could|has|have|had|isn'?t|aren'?t|won'?t)\b/i.test(words || "");
      // NOTE: recipKnown is a DB check (mirror can't replicate); asserted on source above.
      return (m && recip && words && okRecip && !bodyStmt) ? { recip, words } : null;
    };
    const a = parse("text Mark come at 3pm");
    if (!a || a.recip.toLowerCase() !== "mark" || !/come at 3pm/.test(a.words)) fail("A 'text Mark come at 3pm' must parse to {Mark, come at 3pm}");
    else if (!parse("tell Grace the funds are in")) fail("A 'tell Grace the funds are in' must parse");
    else if ((() => { const r = parse("let Cynthia know the STP is due today"); return !r || r.recip.toLowerCase() !== "cynthia"; })()) fail("A 'let Cynthia know X' must parse to Cynthia");
    else if ((() => { const r = parse("message Wahome about the reimbursement"); return !r || !/reimbursement/.test(r.words); })()) fail("A 'message Wahome about X' must strip 'about' and keep X");
    else if (parse("tell me about the budget")) fail("A 'tell me about X' (self) must NOT fire");
    else if (parse("remind me to call the bank")) fail("A 'remind me' (self) must NOT fire");
    else if (parse("did you text Mark about the place")) fail("A 'did you text Mark' (a question) must NOT fire");
    else if (parse("text the team the update")) fail("A 'text the team' (group) must NOT fire");
    else if (parse("what did Mark say")) fail("A 'what did Mark say' must NOT fire");
    else if (parse("message board is full")) fail("A 'message board is full' (statement body) must NOT fire");
    else if (parse("whatsapp accounts are linked")) fail("A 'whatsapp accounts are linked' (statement body) must NOT fire");
    else ok("A SEND route: stages explicit sends (owner/founder, preview, known-recipient, never auto-send); yields self/group/questions/statements");
  }
}

// ---- B: duplicate-contact recency pick (#1b) ----
{
  const i = SMART.indexOf("KT #358 (#1b)");
  const region = i >= 0 ? SMART.slice(i - 200, i + 1500) : "";
  if (!region) fail("B the duplicate-contact recency pick must exist");
  else if (/I found more than one match[^]*Which one\?", opts \}\), detail: \{ ambiguous: true \} \};/.test(SMART.slice(0, i))) fail("B the old bare 'Which one?' dead-end must be replaced");
  else if (!/whatsapp\.message_out/.test(region) || !/to_last4/.test(region)) fail("B it must rank duplicates by the number we most recently MESSAGED");
  else if (!/the one ending \$\{number\.slice\(-4\)\}/.test(region)) fail("B it must SHOW which number it used (last4) so a wrong pick is correctable");
  else if (!/Which one, or give me the number\?/.test(region)) fail("B it must STILL ask only when none of the duplicates were ever messaged");
  else ok("B duplicate name: prefers most-recently-messaged number, shows last4, asks only when no history");
}

// ---- C: task matcher ignores connectors (#2) ----
{
  if (!/"with","for","about","and","from","into","your","our"/.test(SMART)) fail("C connector words must be in TASK_FRAG_STOPLIST");
  if (!/w\.length >= 3 && !TASK_FRAG_STOPLIST\.has\(w\)/.test(SMART)) fail("C the fuzzy scorer must filter stop-words so only distinctive words score");
  else {
    // behavioural: replicate the distinctive-word scoring
    const STOP = new Set(["meeting","meet","call","task","email","mail","do","done","the","a","an","today","tomorrow","yesterday","this","that","one","it","item","thing","stuff","work","job","with","for","about","and","from","into","your","our"]);
    const distinctive = (s) => s.toLowerCase().split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w));
    const score = (frag, title) => { const tl = title.toLowerCase(); return distinctive(frag).filter((w) => tl.includes(w)).length; };
    // full resolver mirror (scorer + the refined acceptance gate): which titles match?
    const resolve = (frag, titles) => {
      const w = distinctive(frag);
      const scored = titles.map((t) => ({ t, s: w.filter((x) => t.toLowerCase().includes(x)).length })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
      const best = scored.length ? scored[0].s : 0;
      const top = scored.filter((x) => x.s === best);
      if (best >= 2 || (best >= 1 && (w.length === 1 || top.length === 1))) return top.map((x) => x.t);
      return [];
    };
    // the canonical false-close: 'Eliza' frag must resolve to the Eliza task, NEVER Bashir
    if (score("meeting with Eliza", "meeting with Bashir") !== 0) fail("C 'meeting with Eliza' must NOT score against 'meeting with Bashir' (distinguishing name differs)");
    else if ((() => { const r = resolve("meeting with Eliza", ["meeting with Bashir", "meeting with Eliza"]); return r.length !== 1 || !/Eliza/.test(r[0]); })()) fail("C 'meeting with Eliza' must resolve to the Eliza task only, never Bashir");
    // skeptic-caught #2 regression: a single distinctive word that UNIQUELY matches must resolve
    else if ((() => { const r = resolve("chase the email from kra", ["Email from KRA", "Buy supplies for camp"]); return r.length !== 1 || !/KRA/.test(r[0]); })()) fail("C 'chase the email from kra' must still resolve (kra uniquely identifies the KRA task) — the over-correction regression");
    else if (score("give Taona access to Canva", "Give Taona access to CANVA") < 2) fail("C a real multi-word reference must still resolve");
    else if (resolve("the report", ["Q1 report", "Q2 report"]).length < 2) fail("C an ambiguous frag (two 'report' tasks) must surface BOTH so the matcher asks, not silently pick one");
    else ok("C task matcher: distinctive word decides; unique single-word match resolves (kra), ties ask, no Eliza→Bashir false-close");
  }
}

// ---- D: notetaker failure no longer leaks raw infra error (#6) ----
{
  const i = W.indexOf("KT #358 (#6)");
  const region = i >= 0 ? W.slice(i, i + 2000) : "";
  if (!region) fail("D the notetaker clean-error handling must exist");
  else if (/the service returned: \$\{dispatch\.error\}/.test(W)) fail("D the raw dispatch.error must NOT be piped to Nur anymore");
  else if (!/notetaker_dispatch_failed/.test(region) || !/pushIncident/.test(region)) fail("D the real error must be captured internally (event + incident) for the team");
  else if (!/flagged it to the team/.test(region)) fail("D Nur must get a clean, honest, non-technical line");
  else if (/ANTHROPIC_API_KEY|localhost:8000/.test(region.replace(/\/\/[^\n]*/g, ""))) fail("D no infra token may appear in the user-facing reply");
  else ok("D notetaker failure: real error captured internally, Nur gets a clean honest line (no infra leak)");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
