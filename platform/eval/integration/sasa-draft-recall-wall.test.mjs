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
  const region = i >= 0 ? W.slice(i, i + 3000) : "";
  if (!region) fail("S1 the draft-recall route must exist");
  else if (!/from\("approvals"\)[\s\S]*?email_reply[\s\S]*?pending|\.eq\("kind", "email_reply"\)\.eq\("status", "pending"\)/.test(region)) fail("S1 draft-recall must read pending email_reply approvals (source of truth)");
  else if (!/await sendTextAndLog\(db, from, msg/.test(region)) fail("S1 draft-recall must send the draft directly");
  else if (!/markJobDone\(job\.id\);\s*return;/.test(region)) fail("S1 draft-recall must markJobDone + return (deterministic, skips the brain)");
  else if (!(i < W.indexOf("let reply: string | undefined;"))) fail("S1 draft-recall must run BEFORE the brain");
  else ok("S1 deterministic draft-recall route present, before the brain");
}

// ---- S2: behavioural (mirror the route's gates) ----
{
  const fires = (command, swipeAnchorNote = "") => {
    const sendEmailVerb = /\b(?:send it|send the email|send that|send this|fire it|email it|go ahead and send)\b/i.test(command || "");
    const editVerb = /\b(?:change|edit|reword|rewrite|shorten|lengthen|add|remove|update|make it|fix|correct|adjust|tweak|rephrase|delete|cancel)\b/i.test(command || "");
    const showDraftIntent = (/\b(?:show|share|see|pull|read|view|open|send\s+me|resend|what(?:'?s| is| was)?|where(?:'?s| is)?)\b[\s\S]{0,40}\bdrafts?\b|\bthe\s+drafts?\b/i.test(command || ""))
      && !/\bdrafts?\s+(?:an?|me\s+an?|a\s+new|up\s+an?|out)\b/i.test(command || "");
    const bareRef = /^\s*(?:this(?:\s+one)?|that(?:\s+one)?|it|the\s+draft|yes|yeah|show(?:\s+me)?(?:\s+it|\s+this|\s+that)?|see(?:\s+it|\s+this|\s+that)?|read(?:\s+it|\s+this|\s+that)?|share(?:\s+it|\s+this|\s+that)?|pull(?:\s+it|\s+this|\s+that)?(?:\s+up)?)\s*[.!?]*\s*$/i.test(command || "");
    const swipedDraft = !!swipeAnchorNote && /\bdraft\b|\bsubject:/i.test(swipeAnchorNote);
    return !sendEmailVerb && !editVerb && (showDraftIntent || (swipedDraft && bareRef));
  };
  const DRAFT_ANCHOR = `Nur is replying to your prior message: "Here's the draft to x@y.com: Subject: Our Call body...". Her reply is: `;
  // MUST fire
  if (!fires("Are you able to share the draft email you prepared earlier?")) fail("S2 the live failing case must FIRE");
  else if (!fires("show me the draft")) fail("S2 'show me the draft' must fire");
  else if (!fires("can you show me the draft you made")) fail("S2 'show me the draft you made' must fire");
  else if (!fires("read me the draft again")) fail("S2 'read me the draft again' must fire");
  else if (!fires("This one", DRAFT_ANCHOR)) fail("S2 swipe-reply 'This one' on a draft must fire");
  else if (!fires("show me", DRAFT_ANCHOR)) fail("S2 swipe-reply 'show me' on a draft must fire");
  // MUST NOT fire (yield to the model)
  else if (fires("draft an email to x@y.com about the call")) fail("S2 'draft a new email' must NOT fire (it's a create)");
  else if (fires("draft me a reply to the bank")) fail("S2 'draft me a reply' must NOT fire");
  else if (fires("make it shorter", DRAFT_ANCHOR)) fail("S2 a swipe-reply EDIT must NOT be intercepted (model handles it)");
  else if (fires("change the subject to Meeting", DRAFT_ANCHOR)) fail("S2 a swipe-reply edit must NOT fire");
  else if (fires("send it", DRAFT_ANCHOR)) fail("S2 'send it' must NOT be intercepted (it's a send, not a show)");
  else if (fires("what's on my calendar today")) fail("S2 an unrelated question must NOT fire");
  else ok("S2 show-draft variants + swipe fire; create/edit/send/unrelated all yield");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
