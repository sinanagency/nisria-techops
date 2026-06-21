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
  const region = i >= 0 ? SASA.slice(i, i + 1600) : "";
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
    // mirror the helper's contract
    const pick = (toolRuns) => {
      if (!Array.isArray(toolRuns)) return null;
      for (let i = toolRuns.length - 1; i >= 0; i--) {
        const r = toolRuns[i];
        if (r?.name !== "message_person") continue;
        const okSend = r?.result?.ok === true && !r?.result?.detail?.unresolved && !r?.result?.detail?.ambiguous && !r?.result?.detail?.deduped;
        if (okSend) return null;
        const to = String(r?.input?.to || "").trim();
        const text = String(r?.input?.text || "").trim();
        if (to && text) return { to, text };
      }
      const ops = new Set(["nur", "taona"]);
      for (let i = toolRuns.length - 1; i >= 0; i--) {
        const r = toolRuns[i];
        if (r?.name !== "create_task" || r?.result?.ok !== true) continue;
        const who = String(r?.input?.assignee || r?.input?.assignee_name || "").trim();
        const title = String(r?.input?.title || "").trim();
        if (!who || !title || ops.has(who.toLowerCase())) continue;
        return { to: who, text: title };
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
    else ok("S2 extractSendTarget: prefers the model's own composed message, else the task assignee, never the operator, never a real send");
  }
}

// ---- S3: confirm gate commits the send for real ----
{
  const i = W.indexOf('p.kind === "send_message"');
  const region = i >= 0 ? W.slice(i - 40, i + 1500) : "";
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

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
