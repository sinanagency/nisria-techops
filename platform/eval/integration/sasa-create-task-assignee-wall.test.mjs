// create_task assignee wall (2026-06-20, KT #318). #7: create_task routed a
// NAMED assignee through resolveAssignee->findMember, which silently first-matches
// on ambiguity and returns null on a miss, then writes assignee_id:null and
// reports success ("unassigned" / "assigned to <wrong>"). So "give it to Mark"
// could land on nobody. The strict resolver (findMemberUnion: unique/ambiguous/
// none) was wired only to team-admin tools, never to task creation.
//
// Fix: in create_task, a NAMED assignee goes through findMemberUnion and STOPS to
// ask ("which Lucy?") on ambiguous, or "I could not find X" on none — never a
// silent null. Self-pronoun ("me") still resolves via senderPhone.
//
// Seams (checked in the create_task region, between its dedup guard and insert):
//   S1  named assignee routed through findMemberUnion (not bare resolveAssignee)
//   S2  ambiguous -> ok:false with memberAmbiguityQuestion
//   S3  none -> ok:false, does NOT create the task (honest "could not find")
//   S4  self-pronoun still resolves via senderPhone (findMemberByPhone)
//
// Pure local.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SMART = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "smart-tools.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

// Isolate the create_task region: from the tool head through assignee resolution.
// (Re-anchored 2026-06-23 KT #378: the open-dup guard moved BELOW assignee resolution,
// so anchor on the tool head, not the dedup message.)
const start = SMART.indexOf('if (name === "create_task")');
const region = start >= 0 ? SMART.slice(start, start + 3000) : "";

if (!region) { fail("could not locate create_task region"); }
else {
  // ---- S1: routed through findMemberUnion ----
  if (!/findMemberUnion\(/.test(region)) fail("S1 create_task must resolve a named assignee via findMemberUnion");
  else ok("S1 create_task uses findMemberUnion for a named assignee");

  // ---- S2: ambiguous -> ask ----
  if (!/ambiguous/.test(region) || !/memberAmbiguityQuestion/.test(region)) fail("S2 ambiguous assignee -> memberAmbiguityQuestion (ok:false)");
  else ok("S2 ambiguous assignee asks 'which one?'");

  // ---- S3: none -> refuse, don't silently null ----
  if (!/"none"|kind === "none"/.test(region) || !/could not find|couldn'?t find/i.test(region)) fail("S3 unknown assignee -> ok:false 'could not find', not a silent null");
  else ok("S3 unknown assignee refuses, not silent-null");

  // ---- S4: self still via phone ----
  if (!/isSelfPronoun/.test(region) || !/findMemberByPhone/.test(region)) fail("S4 self-pronoun resolves via senderPhone");
  else ok("S4 self-pronoun resolves via senderPhone");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
