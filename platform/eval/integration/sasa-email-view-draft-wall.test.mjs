// Email view + draft-as-next-bubble wall (2026-06-21, KT #350). Two asks:
//   (1) DRAFT BUBBLE: when the bot drafts an email, the next WhatsApp bubble must
//       show the FULL draft (subject + body) inline — the Dorje/jensen-pa mail-sweep
//       pattern — not just "it's in Needs You". She still approves in the portal.
//   (2) VIEW EMAILS: the bot could only snippet-search the inbox (search_inbox), with
//       no way to read a FULL email. Added read_email (Gmail format=full + body decode)
//       so the bot can read an email to Nur in WhatsApp.
//
// Seams:
//   S1  draft_email's reply embeds the draft (Subject + body), not only a queue note
//   S2  read_email tool def + handler exist, return the full body, admin-only
//   S3  gmail.ts exposes readEmail (format=full) + a body extractor
//   S4  the draft preview is read-only (never auto-sends; still gated to Needs You)
//
// Pure local (source-seam).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const R = (p) => fs.readFileSync(path.resolve(HERE, "..", "..", p), "utf8");
const SMART = R("lib/smart-tools.ts");
const GMAIL = R("lib/gmail.ts");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

// ---- S1: draft bubble ----
{
  const i = SMART.indexOf('name === "draft_email"');
  const region = i >= 0 ? SMART.slice(i, i + 4200) : "";
  if (!/draftBubble\s*=/.test(region)) fail("S1 draft_email must build a draftBubble that shows the draft inline");
  else if (!/\*Subject:\*\s*\$\{subjectFinal\}/.test(region)) fail("S1 the draft bubble must include the Subject");
  else if (!/`,\s*\n\s*body,/.test(region) && !/\n\s*body,\s*\n/.test(region)) fail("S1 the draft bubble must include the email body");
  else if (!/const msg = created \? draftBubble/.test(region)) fail("S1 a newly-created draft must reply with the draft bubble");
  else ok("S1 draft_email shows the full draft (subject + body) in the reply bubble");
}

// ---- S2: read_email tool ----
{
  if (!/\{ name: "read_email"/.test(SMART)) fail("S2 read_email tool def must exist");
  else {
    const i = SMART.indexOf('name === "read_email"');
    const region = i >= 0 ? SMART.slice(i, i + 1500) : "";
    if (!region) fail("S2 read_email handler missing");
    else if (!/await readEmail\(/.test(region)) fail("S2 read_email must call readEmail() for the full body");
    else if (!/tier === "team"/.test(region)) fail("S2 read_email must be admin-only (refuse team tier)");
    else if (!/body:\s*body/.test(region) || !/subject:\s*top\.subject/.test(region)) fail("S2 read_email must return the full body + subject");
    else ok("S2 read_email returns the full email body, admin-only");
  }
}

// ---- S3: gmail readEmail ----
{
  if (!/export async function readEmail\(/.test(GMAIL)) fail("S3 gmail.ts must export readEmail");
  else if (!/format=full/.test(GMAIL)) fail("S3 readEmail must fetch the FULL message (format=full), not metadata");
  else if (!/function extractGmailBody\(/.test(GMAIL)) fail("S3 gmail.ts must decode the body (extractGmailBody)");
  else ok("S3 gmail.ts readEmail fetches + decodes the full body");
}

// ---- S4: the draft is read-only / still gated ----
{
  const i = SMART.indexOf('name === "draft_email"');
  const region = i >= 0 ? SMART.slice(i, i + 4200) : "";
  if (!/sent:\s*false/.test(region)) fail("S4 the draft must stay ungated/unsent (sent:false) — preview only, never auto-send");
  else if (!/Review in Needs You/.test(region)) fail("S4 the draft must still route to Needs You for approval");
  else ok("S4 draft preview is read-only; approval still required in Needs You");
}

// ---- S5: show_draft tool ("show me the draft you made") ----
{
  if (!/\{ name: "show_draft"/.test(SMART)) fail("S5 show_draft tool def must exist");
  else {
    const i = SMART.indexOf('name === "show_draft"');
    const region = i >= 0 ? SMART.slice(i, i + 1400) : "";
    if (!region) fail("S5 show_draft handler missing");
    else if (!/from\("approvals"\)[\s\S]*email_reply[\s\S]*status[\s\S]*pending|\.eq\("kind", "email_reply"\)\.eq\("status", "pending"\)/.test(region)) fail("S5 show_draft must read the pending email draft from approvals");
    else if (!/body:\s*String\(p\.body/.test(region)) fail("S5 show_draft must return the full draft body");
    else if (!/tier === "team"/.test(region)) fail("S5 show_draft must be admin-only");
    else ok("S5 show_draft returns the pending draft (to/subject/full body) from the source of truth");
  }
}

// ---- S6: swipe-reply to a draft bubble surfaces the quoted draft to the model ----
{
  const W = R("app/api/whatsapp/worker/route.ts");
  if (!/const quotedExcerpt = String\(quotedRow\.body/.test(W)) fail("S6 the swipe anchor must read the quoted message body");
  else if (!/Nur is replying to your prior message: "\$\{quotedExcerpt\}"/.test(W)) fail("S6 a swipe-reply must surface the quoted draft text so the model knows what she means");
  else ok("S6 swipe-reply to a draft bubble surfaces the quoted draft to the model");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
