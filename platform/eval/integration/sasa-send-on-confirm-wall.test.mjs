// Send-on-confirm wall (2026-06-21, KT #357). Live failure (06-21 13:27): Nur
// assigned a task, the bot honestly said "I logged that, but I have not actually
// messaged them... Want me to message them now?" — she replied "Yes" — and the bot
// looped back to the SAME offer instead of sending. Root cause: the honesty wall at
// sasa.ts substituted HONEST_NO_SEND but STAGED NOTHING, so her "yes" had no pending
// action to commit; the model just re-logged and re-offered. The honest half shipped
// last session; the DOING half did not.
//
// Fix: when the honesty wall catches a "told them" claim with no real send, STAGE the
// intended send (pending_actions kind='send_message') with the recipient + the exact
// text, and show that text in the reply so Nur confirms knowingly. Her "yes" then runs
// message_person for real through the existing confirm gate, which reports the TRUE
// result (sent / could-not-resolve), never a fabricated "Sent!".
//
// Seams:
//   S1  sasa.ts: the claimsSendWithoutSend arm stages a send_message pending_action
//       (owner/founder only) carrying {to_name, text}, and the reply previews the text
//   S2  sasa.ts: extractSendTarget pulls the real recipient+text from this turn's tool
//       runs (a tried-but-unresolved message_person first, else a create_task assignee)
//   S3  worker route.ts: the confirm gate handles kind==='send_message' by calling
//       message_person via runSmartTool, with a VERIFIED result (failed[] on non-ok),
//       and reports "Sent to X" only when it truly went
//
// Pure local (source-seam).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const R = (p) => fs.readFileSync(path.resolve(HERE, "..", "..", p), "utf8");
const SASA = R("lib/agents/sasa.ts");
const W = R("app/api/whatsapp/worker/route.ts");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

// ---- S1: staging on the honesty-wall arm ----
{
  const i = SASA.indexOf("claimsSendWithoutSend(reply, toolRuns)");
  // the arm body runs from the `else if (claimsSendWithoutSend...` to the next `} else if`
  // (widened 2026-06-22 KT #372: the cross-turn self-recall block precedes the stage arm)
  const region = i >= 0 ? SASA.slice(i, i + 2600) : "";
  if (!region) fail("S1 the claimsSendWithoutSend arm must still exist");
  else if (!/extractSendTarget\(/.test(region)) fail("S1 the arm must derive the intended send target (extractSendTarget)");
  else if (!/kind:\s*"send_message"/.test(region)) fail("S1 the arm must stage a send_message pending_action so 'yes' can commit it");
  else if (!/status:\s*"awaiting_confirm"/.test(region)) fail("S1 the staged send must be awaiting_confirm (rides the existing confirm gate)");
  else if (!/to_name:\s*tgt\.to|to_name:\s*[^,]*\bto\b/.test(region)) fail("S1 the staged payload must carry the recipient (to_name)");
  else if (!/text:\s*tgt\.text|text:\s*[^,]*\btext\b/.test(region)) fail("S1 the staged payload must carry the exact text to send");
  else if (!/\$\{tgt\.to\}[\s\S]{0,80}\$\{tgt\.text\}/.test(region)) fail("S1 the reply must preview BOTH the recipient and the exact text, so Nur confirms knowingly");
  else if (!/owner["'\s)]|founder/.test(region)) fail("S1 auto-send staging must be owner/founder only (a team member's stray claim must not stage a send)");
  else ok("S1 honesty-wall arm stages a send_message (owner/founder) with a previewed recipient + text");
}

// ---- S2: extractSendTarget behaviour (mirror) ----
{
  if (!/function extractSendTarget\(/.test(SASA)) fail("S2 extractSendTarget helper must exist");
  else {
    // mirror the helper's contract — SINGLE newest-first pass (KT #357 skeptic #4)
    const pick = (toolRuns) => {
      if (!Array.isArray(toolRuns)) return null;
      const ops = new Set(["nur", "taona"]);
      for (let i = toolRuns.length - 1; i >= 0; i--) {
        const r = toolRuns[i];
        if (r?.name === "message_person") {
          const okSend = r?.result?.ok === true && !r?.result?.detail?.unresolved && !r?.result?.detail?.ambiguous && !r?.result?.detail?.deduped;
          if (okSend) return null;
          const to = String(r?.input?.to || "").trim();
          const text = String(r?.input?.text || "").trim();
          if (to && text) return { to, text };
        } else if (r?.name === "create_task" && r?.result?.ok === true) {
          const who = String(r?.input?.assignee || r?.input?.assignee_name || "").trim();
          const title = String(r?.input?.title || "").trim();
          if (who && title && !ops.has(who.toLowerCase())) return { to: who, text: title };
        }
      }
      return null;
    };
    // a tried-but-unresolved message_person carries the real composed text
    const t1 = pick([{ name: "message_person", input: { to: "Mark", text: "Can you start the place hunting?" }, result: { ok: false, detail: { unresolved: true } } }]);
    if (!t1 || t1.to !== "Mark" || !/place hunting/.test(t1.text)) fail("S2 a tried-but-unresolved message_person must yield its own to+text");
    // an ambiguous message_person (duplicate contacts) is still a real target
    else if (!pick([{ name: "message_person", input: { to: "Cynthia", text: "STP report due today" }, result: { ok: false, detail: { ambiguous: true } } }])) fail("S2 an ambiguous (duplicate-contact) message_person must still yield a target");
    // a create_task to a non-operator notifies them with the title
    else if ((() => { const r = pick([{ name: "create_task", input: { assignee: "Violet", title: "Send the STP reminder" }, result: { ok: true } }]); return !r || r.to !== "Violet" || !/STP reminder/.test(r.text); })()) fail("S2 a create_task to a non-operator must yield {assignee, title}");
    // a task assigned to the operator herself notifies NO ONE (no stray send)
    else if (pick([{ name: "create_task", input: { assignee: "Nur", title: "Review the portal" }, result: { ok: true } }])) fail("S2 a task assigned to the operator themselves must NOT stage a send");
    // a message_person that actually SENT yields nothing to stage
    else if (pick([{ name: "message_person", input: { to: "Mark", text: "hi" }, result: { ok: true } }])) fail("S2 a message_person that truly sent must yield null (nothing to re-send)");
    // nothing relevant -> null (no staging, no regression)
    else if (pick([{ name: "list_tasks", input: {}, result: { ok: true } }])) fail("S2 an unrelated turn must yield null");
    // KT #357 skeptic #4: the MOST RECENT action wins. A failed message_person to Mark
    // FOLLOWED BY a create_task to Violet must stage Violet (recency), not Mark.
    else if ((() => { const r = pick([
      { name: "message_person", input: { to: "Mark", text: "old intent" }, result: { ok: false, detail: { unresolved: true } } },
      { name: "create_task", input: { assignee: "Violet", title: "the newer thing" }, result: { ok: true } },
    ]); return !r || r.to !== "Violet"; })()) fail("S2 the MOST RECENT action must win (later create_task Violet over earlier failed message_person Mark)");
    else ok("S2 extractSendTarget: single newest-first pass (recency wins), never the operator, never a real send");
  }
}

// ---- S3: confirm gate commits the send for real ----
{
  const i = W.indexOf('p.kind === "send_message"');
  const region = i >= 0 ? W.slice(i - 40, i + 2900) : "";
  if (!region) fail("S3 the confirm gate must handle kind==='send_message'");
  else if (!/runSmartTool\("message_person"/.test(region)) fail("S3 send commit must reuse message_person (single send path, idempotency), not a forked sender");
  else if (!/detail\?\.unresolved/.test(region) || !/detail\?\.ambiguous/.test(region)) fail("S3 the send result must be VERIFIED (a non-resolved/ambiguous result is NOT a send)");
  else if (!/okItem = false/.test(region)) fail("S3 a failed send must mark the item failed (stay staged, honest, never claim sent)");
  else if (!/sent\.push|done\.push/.test(region)) fail("S3 a real send must be recorded for the confirmation summary");
  else ok("S3 confirm gate sends via message_person, verifies the result, reports truthfully");
  // the summary must say "Sent" for a real send (not "Logged", which means queued)
  if (i >= 0 && !/Sent to \$\{/.test(W)) fail("S3 the confirmation must say 'Sent to <name>' for a completed send (not 'Logged')");
  else if (i >= 0) ok("S3 a completed send confirms as 'Sent to <name>'");
}

// ---- S4: HONEST-OFFER staging (skeptic #1) — an honest offer must also stage ----
{
  if (!/const SEND_OFFER =/.test(SASA)) fail("S4 SEND_OFFER regex must exist (detect the bot's honest offer to message someone)");
  else if (!/HONEST-OFFER staging/.test(SASA)) fail("S4 the honest-offer staging hook must exist");
  else {
    // the hook must be gated: not-already-staged + owner/founder + SEND_OFFER + a derivable target
    const i = SASA.indexOf("HONEST-OFFER staging");
    const region = i >= 0 ? SASA.slice(i, i + 1400) : "";
    if (!/!sendAlreadyStaged/.test(region)) fail("S4 the offer hook must NOT double-stage when the lie-path already staged");
    else if (!/operatorRank === "owner" \|\| opts\.operatorRank === "founder"/.test(region)) fail("S4 the offer hook must be owner/founder only");
    else if (!/extractSendTarget\(/.test(region)) fail("S4 the offer hook must require a derivable target (over-fire guard)");
    else if (!/kind:\s*"send_message"/.test(region)) fail("S4 the offer hook must stage a send_message");
    else {
      // behavioural: SEND_OFFER fires on honest offers, NOT on unrelated text
      const SEND_OFFER = /\b(?:want me to|shall i|should i|do you want me to|would you like me to|want me to go ahead and|i can|let me)\b[^.?!]{0,45}?\b(?:message|text|tell|notify|remind|ping|let\s+(?:him|her|them|\w+)\s+know|reach\s+out\s+to|drop\s+(?:him|her|them)\s+a|send\s+(?:it|them|him|her|a\s+(?:message|text|note|reminder|heads.?up))\s+to)\b/i;
      if (!SEND_OFFER.test("I logged it. Want me to message Wahome now?")) fail("S4 'Want me to message Wahome now?' must match SEND_OFFER");
      else if (!SEND_OFFER.test("Logged for Mark. Shall I tell him?")) fail("S4 'Shall I tell him?' must match");
      else if (!SEND_OFFER.test("Done. I can let her know if you want.")) fail("S4 'I can let her know' must match");
      else if (SEND_OFFER.test("I have logged the task on Mark's board.")) fail("S4 a plain log confirmation (no offer) must NOT match");
      else if (SEND_OFFER.test("What would you like me to do next?")) fail("S4 an unrelated question must NOT match");
      else ok("S4 honest-offer hook stages too (owner/founder, target-guarded); SEND_OFFER fires on offers, not on plain confirmations");
    }
  }
}

// ---- S5: deduped is NOT a fresh 'Sent' (skeptic #2 honesty) ----
{
  const i = W.indexOf('p.kind === "send_message"');
  const region = i >= 0 ? W.slice(i - 40, i + 2900) : "";
  if (!/detail\?\.deduped/.test(region)) fail("S5 the gate must special-case a deduped result (it means nothing NEW went out)");
  else if (!/already sent to \$\{to\}/.test(region)) fail("S5 a deduped send must be reported honestly as already-sent, never a fresh 'Sent to X'");
  else ok("S5 a deduped (nothing-new-sent) result is reported honestly, not as a fresh send");
}

// ---- S6: the gate re-checks the LIVE operator rank (skeptic #3 authz) ----
{
  const i = W.indexOf('p.kind === "send_message"');
  const region = i >= 0 ? W.slice(i - 40, i + 2900) : "";
  if (!/opRank === "owner" \|\| opRank === "founder"/.test(region)) fail("S6 the send branch must re-derive authority from the LIVE operator (opRank), not trust payload.rank");
  else if (!/Only Nur or Taona can send/.test(region)) fail("S6 a non-owner/founder confirming must be refused honestly, not silently sent");
  else if (!/rank:\s*\(opRank as any\)/.test(region)) fail("S6 the message_person call must pass the LIVE opRank, not the staged payload.rank");
  else ok("S6 the privileged send re-checks the live operator's rank (no trust in the staged payload)");
}

// ---- S7: extractSendTarget is a SINGLE recency pass, not type-priority (skeptic #4) ----
{
  const i = SASA.indexOf("function extractSendTarget(");
  const body = i >= 0 ? SASA.slice(i, i + 1100) : "";
  // there must be exactly ONE backward loop now (the old version had two)
  const loops = (body.match(/for \(let i = toolRuns\.length - 1/g) || []).length;
  if (loops !== 1) fail(`S7 extractSendTarget must be a single newest-first pass (found ${loops} loops; the two-loop version mis-prioritised message_person over a more recent create_task)`);
  else ok("S7 extractSendTarget is a single recency pass (most-recent action wins)");
}

// ---- S8: non-silent expiry (skeptic #5) — a late 'yes' is told, not ignored ----
{
  const i = W.indexOf("NON-SILENT EXPIRY");
  const region = i >= 0 ? W.slice(i - 80, i + 1700) : "";
  if (!region) fail("S8 the non-silent-expiry branch must exist");
  else if (!/status",\s*"superseded"/.test(region)) fail("S8 it must look for a recently SUPERSEDED send_message (the expired one)");
  else if (!/timed out before you confirmed/.test(region)) fail("S8 a late confirm must get an honest timeout notice, not silence");
  else if (/runSmartTool\("message_person"/.test(region)) fail("S8 the expiry branch must NOT send anything (an expired send can never auto-fire)");
  else if (!/markJobDone\(job\.id\);\s*return;/.test(region)) fail("S8 the expiry notice must markJobDone + return");
  else if (!/affirm\b/.test(region)) fail("S8 it must only fire on an affirmative reply");
  else ok("S8 a late confirm of an expired send gets an honest 'timed out, want me to set it up again?' (never silent, never auto-sends)");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
