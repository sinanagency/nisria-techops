// Email send-on-confirm wall (2026-06-30, this session). Taona: "if I say send an
// email it happens, just one confirmation, not the portal." draft_email queues an
// email_reply approval; approving it used to REQUIRE the portal "Needs You". The new
// worker block lets an in-chat "send it" / "fire it" / "email it", or a bare "yes"
// right after a draft preview, approve+send via the SAME approveApproval the portal
// calls. ONE in-chat confirm, no portal. Safety: a bare "yes" only sends when the last
// bubble was a draft preview, and several pending drafts with no named recipient ASK
// which (a stray "yes" can never fire the wrong email). These regexes MIRROR the worker
// block (app/api/whatsapp/worker/route.ts); the source-marker checks below fail the
// wall if that block is removed or renamed, bounding the drift.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

// --- mirrors of the worker-block detection (keep byte-identical) ---
const sendEmailConfirm = (c) => /\b(?:send it|send the email|send that email|send this email|fire it|email it|go ahead and send(?: it)?|send the draft|send it now)\b/i.test(c || "");
const bareYesSend = (c) => /^\s*(?:yes|yeah|yep|yup|ok(?:ay)?|sure|go\s*ahead|do it|send|send it|confirm(?:ed)?|approve(?:d)?)\s*[.!]*\s*$/i.test(c || "");
const lastWasDraftPreview = (s) => !!s && /here'?s (?:the|what will go|your)[^\n]*\b(?:draft|email)\b|\*?subject:?\*?/i.test(s);
// fires? = an explicit email send-confirm OR a bare yes right after a draft preview
const fires = (cmd, anchor) => sendEmailConfirm(cmd) || (bareYesSend(cmd) && lastWasDraftPreview(anchor));

const DRAFT_BUBBLE = "Here's the draft to taonac96@gmail.com:\n\n*Subject:* Catch-up this Friday\n\nHi there, hope this finds you well.";

// ---- E1: explicit email send-confirm phrases fire ----
{
  for (const c of ["send it", "send the email", "fire it", "email it", "go ahead and send it", "send the draft", "send it now"])
    if (!sendEmailConfirm(c)) fail(`E1 "${c}" must be a send-confirm`);
  ok("E1 explicit send-confirm phrases fire");
}

// ---- E2: unrelated commands do NOT fire (no stray send) ----
{
  for (const c of ["what's the weather", "draft an email to mwangi about funding", "show me the draft", "read me the latest email", "delete that task"])
    if (fires(c, DRAFT_BUBBLE)) fail(`E2 "${c}" must NOT fire an email send`);
  ok("E2 unrelated / draft / show / read commands do not send");
}

// ---- E3: bare "yes" only sends right after a draft preview ----
{
  if (!fires("yes", DRAFT_BUBBLE)) fail("E3a bare 'yes' AFTER a draft preview must fire");
  if (fires("yes", "I filed that document for reference.")) fail("E3b bare 'yes' after a NON-draft bubble must NOT fire");
  if (fires("yes", null)) fail("E3c bare 'yes' with no prior bubble must NOT fire");
  if (!fires("go ahead", DRAFT_BUBBLE)) fail("E3d 'go ahead' after a draft must fire");
  ok("E3 bare affirmative sends only directly after a draft preview");
}

// ---- E4: recipient narrowing token extraction (mirrors worker STOP set) ----
{
  const STOP = new Set(["send", "it", "the", "email", "draft", "that", "this", "now", "fire", "go", "ahead", "yes", "yeah", "please", "to", "out", "off", "and", "approve", "approved", "confirm", "confirmed", "ok", "okay", "sure"]);
  const toks = (c) => c.toLowerCase().replace(/[^a-z0-9@.]+/g, " ").split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w));
  if (JSON.stringify(toks("send the one to mwangi")) !== JSON.stringify(["mwangi"])) fail("E4a 'send the one to mwangi' must extract ['mwangi']");
  if (toks("send it").length !== 0) fail("E4b bare 'send it' must extract no recipient token (so multiple drafts ASK which)");
  ok("E4 recipient narrowing tokenizer is correct");
}

// ---- E5: the worker block actually exists and reuses approveApproval (anti-drift) ----
{
  const src = readFileSync(resolve(HERE, "../../app/api/whatsapp/worker/route.ts"), "utf8");
  const need = ["sendEmailConfirm", "lastWasDraftPreview", "approveApproval(chosen.id", "sasa.email_sent_on_confirm", 'eq("kind", "email_reply").eq("status", "pending")'];
  for (const m of need) if (!src.includes(m)) fail(`E5 worker block missing marker: ${m}`);
  // admin-only gate present in the block region
  if (!/opRank === "owner" \|\| opRank === "founder"/.test(src)) fail("E5 admin-only gate missing");
  ok("E5 worker block present: in-chat confirm -> approveApproval (portal's own send path), admin-only");
}

if (process.exitCode) console.error("\nsasa-email-send-on-confirm-wall: FAIL");
else console.log("\nsasa-email-send-on-confirm-wall: ALL GREEN");
