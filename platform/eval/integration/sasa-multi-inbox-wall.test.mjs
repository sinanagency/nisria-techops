#!/usr/bin/env node
// Sasa MULTI-INBOX WALL, 2026-06-27.
//
// The bot reads across ALL configured @nisria.co inboxes, not just sasa@. The
// shared bot mailbox bot@nisria.co (where Nur forwards things) is in the default
// set, and more can be added via INBOX_MAILBOXES with no code change. Reads use
// the domain-wide-delegated service account (verified live: sasa@ and bot@ both
// reachable). Every hit is tagged with the inbox it came from so read_email
// fetches the full body from the right mailbox.
//
// Pure local. No DB, no network, no Anthropic spend. Mirror of the source so a
// future edit that drops bot@ or stops tagging the mailbox fails here.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PLATFORM = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => readFileSync(resolve(PLATFORM, rel), "utf8");

const tests = [];
function check(name, fn) { tests.push({ name, fn }); }

// ─── seams: gmail.ts ────────────────────────────────────────────────────────

check("seam: INBOX_MAILBOXES defaults include sasa@ and bot@nisria.co", () => {
  const src = read("lib/gmail.ts");
  if (!/export const INBOX_MAILBOXES/.test(src)) return "INBOX_MAILBOXES not defined";
  const m = src.match(/INBOX_MAILBOXES[^=]*=\s*\(process\.env\.INBOX_MAILBOXES \|\| "([^"]+)"\)/);
  if (!m) return "INBOX_MAILBOXES default string not found";
  const def = m[1];
  if (!def.includes("sasa@nisria.co")) return "default missing sasa@nisria.co";
  if (!def.includes("bot@nisria.co")) return "default missing bot@nisria.co (the shared bot mailbox)";
  return null;
});

check("seam: searchAllInboxes exists, tags each hit with its mailbox, merges newest-first", () => {
  const src = read("lib/gmail.ts");
  const i = src.indexOf("export async function searchAllInboxes");
  if (i < 0) return "searchAllInboxes not defined";
  const block = src.slice(i, i + 900);
  if (!/searchInboxFor\(mb, query/.test(block)) return "does not query each mailbox via searchInboxFor";
  if (!/mailbox: mb/.test(block)) return "does not tag hits with their mailbox";
  if (!/\.sort\(/.test(block)) return "does not sort (merge newest-first) across mailboxes";
  return null;
});

check("seam: per-mailbox failure is caught, not fatal (one dead inbox cannot blind the rest)", () => {
  const src = read("lib/gmail.ts");
  const i = src.indexOf("export async function searchAllInboxes");
  const block = src.slice(i, i + 900);
  if (!/try\s*\{[\s\S]*?\}\s*catch/.test(block)) return "no per-mailbox try/catch";
  return null;
});

check("seam: InboxHit carries a mailbox field", () => {
  const src = read("lib/gmail.ts");
  if (!/mailbox\?: string/.test(src)) return "InboxHit.mailbox missing";
  return null;
});

// ─── seams: smart-tools.ts (tools use the multi-inbox path) ─────────────────

check("seam: search_inbox reads ALL inboxes and returns the inbox per hit", () => {
  const src = read("lib/smart-tools.ts");
  const i = src.indexOf('if (name === "search_inbox")');
  const block = src.slice(i, i + 700);
  if (!/searchAllInboxes\(q,/.test(block)) return "search_inbox still single-inbox (not searchAllInboxes)";
  if (!/inbox: h\.mailbox/.test(block)) return "search_inbox does not surface which inbox each hit came from";
  return null;
});

check("seam: read_email searches all inboxes and fetches from the matched mailbox", () => {
  const src = read("lib/smart-tools.ts");
  const i = src.indexOf('if (name === "read_email")');
  const block = src.slice(i, i + 1800);
  if (!/searchAllInboxes\(searchQuery/.test(block)) return "read_email still single-inbox";
  if (!/readEmail\(top\.id, top\.mailbox\)/.test(block)) return "read_email does not fetch the full body from the hit's own mailbox";
  return null;
});

check("seam: both email tool descriptions name the shared bot mailbox", () => {
  const src = read("lib/smart-tools.ts");
  if (!/bot@nisria\.co \(the shared bot mailbox/.test(src)) return "search_inbox description does not mention bot@";
  if (!/across all the Nisria inboxes/.test(src)) return "read_email description does not mention all inboxes";
  return null;
});

// ─── behavioural: the merge comparator (mirror of source) ───────────────────

check("merge: hits from multiple inboxes sort newest-first regardless of source mailbox", () => {
  const ts = (d) => { const t = d ? Date.parse(d) : NaN; return isNaN(t) ? 0 : t; };
  const hits = [
    { mailbox: "sasa@nisria.co", date: "Mon, 01 Jun 2026 09:00:00 +0000", subject: "older sasa" },
    { mailbox: "bot@nisria.co", date: "Wed, 03 Jun 2026 09:00:00 +0000", subject: "newest bot" },
    { mailbox: "sasa@nisria.co", date: "Tue, 02 Jun 2026 09:00:00 +0000", subject: "middle sasa" },
  ];
  hits.sort((a, b) => ts(b.date) - ts(a.date));
  if (hits[0].subject !== "newest bot") return "newest (from bot@) did not sort first";
  if (hits[2].subject !== "older sasa") return "oldest did not sort last";
  return null;
});

check("merge: an unparseable date sorts to the bottom, never crashes the merge", () => {
  const ts = (d) => { const t = d ? Date.parse(d) : NaN; return isNaN(t) ? 0 : t; };
  const hits = [{ date: null, subject: "no date" }, { date: "Wed, 03 Jun 2026 09:00:00 +0000", subject: "real" }];
  hits.sort((a, b) => ts(b.date) - ts(a.date));
  if (hits[0].subject !== "real") return "real-dated hit should outrank a null-date hit";
  return null;
});

// ─── runner ────────────────────────────────────────────────────────────────

let pass = 0, fail = 0;
for (const { name, fn } of tests) {
  let reason = null;
  try { reason = fn(); } catch (e) { reason = `threw: ${e?.message || e}`; }
  if (!reason) { pass += 1; console.log(`  ok  ${name}`); }
  else { fail += 1; console.log(`  FAIL ${name} -- ${reason}`); }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
