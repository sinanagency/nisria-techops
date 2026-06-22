// Group-send honesty wall (2026-06-22). Pins the fix for the RECURRING "group amnesia":
// the bot posted a message to a WhatsApp group (post_to_group -> job done), then when
// asked / when narrating said it had NOT sent, firing HONEST_NO_SEND over a delivered
// post. Root cause: claimsSendWithoutSend built `sentRecipients` only from a person key
// (detail.to), but post_to_group returns detail.group (no detail.to), so a delivered
// group post contributed NOTHING. A reply naming the group ("Posted to the Finances
// group") then read "Finances" as an un-sent PERSON -> false honesty correction.
//
// Fix: a successful post_to_group contributes the group's DISTINCTIVE tokens to
// sentRecipients (via the shared, pure ../lib/group-tokens.mjs), so the claim matches
// the send and is NOT flagged. The tokenizer is imported by BOTH the guard and this
// wall (zero drift). A FAILED post (ok !== true) still contributes nothing -> honest.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { groupTokens, GROUP_TOKEN_GENERIC } from "../../lib/group-tokens.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SASA = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "agents", "sasa.ts"), "utf8");
const ST = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "smart-tools.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);
const eq = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? ok(m) : fail(`${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`));
const flat = (s) => s.replace(/\s+/g, " ");

// ---- G1: the tokenizer extracts the distinctive group word(s), drops org/generic ----
{
  eq(groupTokens("Nisria • Finances 💵"), ["finances"], "G1a 'Nisria • Finances 💵' -> ['finances']");
  eq(groupTokens("Maisha • Operations"), ["operations"], "G1b 'Maisha • Operations' -> ['operations']");
  eq(groupTokens("Nisria • Rescue & Rehab"), ["rescue", "rehab"], "G1c 'Nisria • Rescue & Rehab' -> ['rescue','rehab']");
  eq(groupTokens("Nisria Group"), [], "G1d a name with only org+generic words yields no distinctive token");
  eq(groupTokens(""), [], "G1e empty name is safe (no token)");
  eq(groupTokens(null), [], "G1f null name is safe (no token)");
  if (!GROUP_TOKEN_GENERIC.has("nisria") || !GROUP_TOKEN_GENERIC.has("group")) fail("G1g generic stoplist must drop org + 'group'");
  else ok("G1g generic stoplist drops org + 'group'");
}

// ---- G2: the matching simulation — a delivered group post is NOT flagged as un-sent ----
// We reproduce the guard's exact matching contract: a claim token set vs a sent token set
// built the FIXED way. This is the behavioural proof the bug is dead.
{
  // sentRecipients built the FIXED way for a successful post_to_group to Finances
  const sent = new Set();
  const postRun = { name: "post_to_group", result: { ok: true, detail: { job_id: "j1", group: "Nisria • Finances 💵" } } };
  if (postRun.result.ok === true && postRun.name === "post_to_group") {
    for (const tok of groupTokens(postRun.result.detail.group)) sent.add(tok);
  }
  // the reply names the group; "Finances" must be covered by the sent set
  const claimed = ["finances"]; // what extractClaimedRecipients would surface, lower-cased
  const uncovered = claimed.filter((c) => !sent.has(c));
  eq(uncovered, [], "G2a delivered post to Finances covers a 'Posted to Finances' claim (no false flag)");

  // G2b NEGATIVE CONTROL: a FAILED post contributes nothing -> the claim is uncovered (honest flag fires)
  const sentFail = new Set();
  const failRun = { name: "post_to_group", result: { ok: false, detail: { group: "Nisria • Finances 💵" } } };
  if (failRun.result.ok === true && failRun.name === "post_to_group") {
    for (const tok of groupTokens(failRun.result.detail.group)) sentFail.add(tok);
  }
  eq(["finances"].filter((c) => !sentFail.has(c)), ["finances"], "G2b a FAILED post leaves the claim uncovered -> honesty correction still fires");

  // G2c a post to a DIFFERENT group does not cover a claim about Finances
  const sentOther = new Set();
  for (const tok of groupTokens("Maisha • Operations")) sentOther.add(tok);
  eq(["finances"].filter((c) => !sentOther.has(c)), ["finances"], "G2c a post to Operations does NOT cover a Finances claim");
}

// ---- G3: the guard is actually wired this way in sasa.ts (seam) ----
{
  const i = SASA.indexOf("function claimsSendWithoutSend");
  const region = i >= 0 ? SASA.slice(i, i + 2100) : "";
  if (!region) fail("G3a claimsSendWithoutSend must exist");
  else ok("G3a claimsSendWithoutSend exists");
  // must gate on a successful send tool BEFORE crediting recipients
  if (!/if \(\(t\.result as any\)\?\.ok !== true\) continue;/.test(region))
    fail("G3b must skip a tool run whose result is not ok (a failed post credits nothing)");
  else ok("G3b skips non-ok tool runs (failed post credits nothing)");
  // must branch on post_to_group and add the group's tokens
  if (!/if \(t\.name === "post_to_group"\)/.test(region))
    fail("G3c must special-case post_to_group when building sentRecipients");
  else ok("G3c special-cases post_to_group");
  if (!/for \(const tok of groupTokens\(\(t\.result as any\)\?\.detail\?\.group \|\| ""\)\) sentGroupTokens\.add\(tok\)/.test(region))
    fail("G3d must add the group's distinctive tokens to the SEPARATE group set");
  else ok("G3d adds the group's distinctive tokens to sentGroupTokens");
  // the tokenizer must be the shared module, not a re-inlined copy (zero drift)
  if (!/import \{ groupTokens \} from "\.\.\/group-tokens\.mjs";/.test(SASA))
    fail("G3e sasa.ts must import groupTokens from the shared module (no drift)");
  else ok("G3e imports groupTokens from the shared module");
}

// ---- G4: post_to_group is a recognised send tool AND it returns detail.group ----
{
  const i = SASA.indexOf("const SEND_TOOLS = new Set(");
  const region = i >= 0 ? SASA.slice(i, i + 200) : "";
  if (!/post_to_group/.test(region)) fail("G4a post_to_group must be in SEND_TOOLS (else the guard never sees it)");
  else ok("G4a post_to_group is in SEND_TOOLS");
  // smart-tools post_to_group must actually echo detail.group (the key the fix reads)
  const j = ST.indexOf('name === "post_to_group"');
  const reg2 = j >= 0 ? ST.slice(j, j + 4000) : "";
  // shorthand `detail: { job_id: …, group }` (or `group, deduped`) — match the key either way
  if (!/detail:\s*\{[^}]*\bgroup\b[\s,}]/.test(flat(reg2))) fail("G4b post_to_group must return detail.group (the canonical group name the fix matches on)");
  else ok("G4b post_to_group returns detail.group");
}

// ---- G5: skeptic hole B — a group named after a PERSON must NOT launder a person lie ----
// Group "Nisria • Mark Updates" -> token "mark". A false "I messaged Mark" (the PERSON,
// never messaged) must STILL be flagged: the group token only covers a GROUP-SHAPED claim.
{
  const GROUP_SHAPED = /\bgroups?\b|\bposted?\b|\bposting\b/i;
  const sentGroup = new Set(groupTokens("Nisria • Mark Updates")); // ["mark","updates"]
  const sentPersons = new Set();                                   // Mark the person: never messaged
  const decide = (claim, claimed) => {
    const gs = GROUP_SHAPED.test(claim);
    return claimed.some((c) => !(sentPersons.has(c) || (gs && sentGroup.has(c)))); // true = flagged
  };
  if (!decide("I messaged Mark", ["mark"]))
    fail("G5a a false 'I messaged Mark' must STILL flag even when a 'Mark Updates' group was posted (no laundering)");
  else ok("G5a person-send lie not laundered by a same-token group post");
  if (decide("Posted to the Mark Updates group", ["mark", "updates"]))
    fail("G5b a real 'Posted to the Mark Updates group' must NOT flag (legit group narration)");
  else ok("G5b legit group-shaped narration covered by group tokens");
  if (decide("I told Mark", ["mark"]) !== true)
    fail("G5c 'I told Mark' (person verb, no group word) must flag");
  else ok("G5c person-verb claim with a colliding token still flags");
}

// ---- G6: the guard actually wires the group-shaped gate (seam) ----
{
  if (!/const GROUP_SHAPED_CLAIM = /.test(SASA)) fail("G6a GROUP_SHAPED_CLAIM regex must exist");
  else ok("G6a GROUP_SHAPED_CLAIM exists");
  const i = SASA.indexOf("function claimsSendWithoutSend");
  const region = i >= 0 ? SASA.slice(i, i + 3200) : "";
  if (!/const sentGroupTokens = new Set/.test(region)) fail("G6b group tokens must be a SEPARATE set from sentRecipients");
  else ok("G6b group tokens kept separate from person recipients");
  if (!/if \(groupShaped && sentGroupTokens\.has\(c\)\) continue;/.test(region)) fail("G6c a group token may only cover a group-shaped claim");
  else ok("G6c group token gated on a group-shaped claim");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
