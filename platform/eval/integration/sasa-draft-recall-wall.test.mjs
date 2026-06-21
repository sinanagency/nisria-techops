// Draft-recall wall (2026-06-21, KT #353). Live failure: Nur asked "Are you able to
// share the draft email you prepared earlier?" and the bot replied "I'm not finding a
// draft email queued right now" — WITHOUT calling show_draft (the events show zero
// tool calls that turn). show_draft was deployed and the draft existed; the model
// just ignored the tool and made a confident false claim, then did it again on her
// swipe-reply. Fix: when she asks to SEE/SHARE a draft (or swipe-replies to a draft),
// the worker DETERMINISTICALLY pulls the pending draft from approvals and shows it —
// not left to the model's whim. It yields to edit/send intents and to "draft a new".
//
// Seams:
//   S1  the deterministic draft-recall route exists, reads pending email-reply
//       approvals, sends the draft, markJobDone + return (before the brain)
//   S2  behavioural: the failing case + show variants FIRE; "draft a new", edit, and
//       send-the-email intents do NOT (yielded to the model)
//
// Pure local.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const W = fs.readFileSync(path.resolve(HERE, "..", "..", "app", "api", "whatsapp", "worker", "route.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

// ---- S1 ----
{
  const i = W.indexOf("DRAFT RECALL (KT #353)");
  const region = i >= 0 ? W.slice(i, i + 3800) : "";
  if (!region) fail("S1 the draft-recall route must exist");
  else if (!/from\("approvals"\)[\s\S]*?email_reply[\s\S]*?pending|\.eq\("kind", "email_reply"\)\.eq\("status", "pending"\)/.test(region)) fail("S1 draft-recall must read pending email_reply approvals (source of truth)");
  else if (!/await sendTextAndLog\(db, from, msg/.test(region)) fail("S1 draft-recall must send the draft directly");
  else if (!/markJobDone\(job\.id\);\s*return;/.test(region)) fail("S1 draft-recall must markJobDone + return (deterministic, skips the brain)");
  else if (!(i < W.indexOf("let reply: string | undefined;"))) fail("S1 draft-recall must run BEFORE the brain");
  else ok("S1 deterministic draft-recall route present, before the brain");
}

// ---- S2: behavioural (mirror the route's gates, KT #354 tightened) ----
{
  const fires = (command, swipeAnchorNote = "") => {
    const sendEmailVerb = /\b(?:send it|send the email|send that|send this|fire it|email it|go ahead and send)\b/i.test(command || "");
    const editVerb = /\b(?:change|edit|reword|rewrite|shorten|lengthen|add|remove|update|make it|fix|correct|adjust|tweak|rephrase|delete|cancel)\b/i.test(command || "");
    const showDraftIntent = (/\b(?:show|share|see|pull|read|view|open|bring\s+up|send\s+me|resend|what(?:'?s| is| was)?|where(?:'?s| is)?)\b[\s\S]{0,40}\bdrafts?\b/i.test(command || ""))
      && !/\bdrafts?\s+(?:an?|me\s+an?|a\s+new|up\s+an?|out)\b/i.test(command || "");
    const bareRef = /^\s*(?:this(?:\s+one)?|that(?:\s+one)?|it|the\s+draft|yes|yeah|show(?:\s+me)?(?:\s+it|\s+this|\s+that)?|see(?:\s+it|\s+this|\s+that)?|read(?:\s+it|\s+this|\s+that)?|share(?:\s+it|\s+this|\s+that)?|pull(?:\s+it|\s+this|\s+that)?(?:\s+up)?)\s*[.!?]*\s*$/i.test(command || "");
    const swipedDraft = !!swipeAnchorNote && /here'?s the draft/i.test(swipeAnchorNote);
    return !sendEmailVerb && !editVerb && (showDraftIntent || (swipedDraft && bareRef));
  };
  const DRAFT_ANCHOR = `Nur is replying to your prior message: "Here's the draft to x@y.com: Subject: Our Call body...". Her reply is: `;
  const NONDRAFT_ANCHOR = `Nur is replying to your prior message: "I drafted the policy note, subject: governance, take a look". Her reply is: `;
  // MUST fire (explicit show of THE draft)
  if (!fires("Are you able to share the draft email you prepared earlier?")) fail("S2 the live failing case must FIRE");
  else if (!fires("show me the draft")) fail("S2 'show me the draft' must fire");
  else if (!fires("can you show me the draft you made")) fail("S2 'show me the draft you made' must fire");
  else if (!fires("read me the draft again")) fail("S2 'read me the draft again' must fire");
  else if (!fires("This one", DRAFT_ANCHOR)) fail("S2 swipe-reply 'This one' on a REAL draft bubble must fire");
  else if (!fires("show me", DRAFT_ANCHOR)) fail("S2 swipe-reply 'show me' on a draft must fire");
  // MUST NOT fire — create
  else if (fires("draft an email to x@y.com about the call")) fail("S2 'draft a new email' must NOT fire");
  else if (fires("draft me a reply to the bank")) fail("S2 'draft me a reply' must NOT fire");
  // MUST NOT fire — KT #354 over-fire fixes (bare 'the draft' removed)
  else if (fires("the draft is wrong")) fail("S2 'the draft is wrong' must NOT fire (no show verb)");
  else if (fires("did you send the draft")) fail("S2 'did you send the draft' must NOT fire (status question)");
  else if (fires("approve the draft")) fail("S2 'approve the draft' must NOT fire (it's an action)");
  else if (fires("the draft policy document for the board")) fail("S2 'the draft policy document' must NOT fire (different doc)");
  else if (fires("the draft looks good")) fail("S2 'the draft looks good' must NOT fire (an ack)");
  else if (fires("is the draft ready")) fail("S2 'is the draft ready' must NOT fire (status)");
  // MUST NOT fire — swipe to a NON-draft message that just mentions 'draft'/'subject:'
  else if (fires("yes", NONDRAFT_ANCHOR)) fail("S2 swipe 'yes' to a non-draft message must NOT dump a draft (KT #354 leak)");
  else if (fires("this one", NONDRAFT_ANCHOR)) fail("S2 swipe to a 'policy note' message must NOT fire");
  // MUST NOT fire — edit/send on a swipe
  else if (fires("make it shorter", DRAFT_ANCHOR)) fail("S2 a swipe-reply EDIT must NOT be intercepted");
  else if (fires("change the subject to Meeting", DRAFT_ANCHOR)) fail("S2 a swipe-reply edit must NOT fire");
  else if (fires("send it", DRAFT_ANCHOR)) fail("S2 'send it' must NOT be intercepted");
  else if (fires("what's on my calendar today")) fail("S2 an unrelated question must NOT fire");
  else ok("S2 explicit show fires; over-fires (bare 'the draft', non-draft swipe, status/action) all yield");
}

// ---- S3: admin-only gate (KT #354 — pending drafts are NGO-wide donor PII) ----
{
  const i = W.indexOf("DRAFT RECALL (KT #353)");
  const region = i >= 0 ? W.slice(i, i + 3800) : "";
  if (!/if \(contactId && \(opRank === "owner" \|\| opRank === "founder"\)/.test(region)) fail("S3 the draft-recall route must be gated to owner/founder (no team-tier draft leak)");
  else ok("S3 draft-recall is admin-only (team-tier cannot pull NGO email drafts)");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
