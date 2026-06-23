// Group-post veto wall (2026-06-22, KT #370). LIVE 10:27pm: Nur asked Sasa to "Send it to
// Malek" (a PERSON). The model also fired post_to_group and STRAY-posted into the Rescue
// group — a person-send fanned out to a group, broadcasting content where it did not
// belong. Fix (deterministic gate, #206540): post_to_group is legit only when the
// operator's OWN message referenced a group — a distinctive token of THIS group, or an
// explicit group word ("group"/"channel"/"broadcast"/"everyone"/"the team"). Otherwise the
// post is VETOED with an honest line. Fails OPEN if the command can't be read (never blocks
// a legit post on a blank), and never applies on the group surface itself.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { commandReferencesGroup } from "../../lib/group-tokens.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ST = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "smart-tools.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

// Uses the SHARED predicate the tool runs (zero drift). Veto = command can't be tied to a group.
function vetoed(gtext, group, sourceGroup = "") {
  if (!gtext || sourceGroup) return false; // fail-open / group surface
  return !commandReferencesGroup(gtext, group);
}
const T = (got, want, m) => (got === want ? ok(m) : fail(`${m} (got ${got}, want ${want})`));

// ---- P1: the exact live bug — a person-send must NOT post to a group ----
T(vetoed("Send it to Malek as well", "Nisria • Rescue & Rehab"), true,
  "P1a 'Send it to Malek' → post to Rescue is VETOED (the live stray-post bug)");
T(vetoed("Save this and remind me to work on it with Malek. Send it to Malek as well.", "Nisria • Rescue & Rehab"), true,
  "P1b the full Sikka/Malek message → no Rescue reference → vetoed");

// ---- P2: a LEGIT group post must pass (no over-block) ----
T(vetoed("post this to the rescue group: gala on Friday", "Nisria • Rescue & Rehab"), false,
  "P2a 'post to the rescue group' → allowed (names the group + 'group')");
T(vetoed("share with the finances channel", "Nisria • Finances"), false,
  "P2b 'finances channel' → allowed (token + 'channel')");
T(vetoed("tell everyone the office is closed tomorrow", "Nisria • Operations"), false,
  "P2c 'tell everyone' → allowed (broadcast word)");
T(vetoed("post to operations: standup moved to 9", "Nisria • Operations"), false,
  "P2d names the group token 'operations' → allowed");

// ---- P3: fail-open + group-surface safety ----
T(vetoed("", "Nisria • Rescue & Rehab"), false, "P3a empty command → fail OPEN (never block on a blank)");
T(vetoed("Send it to Malek", "Nisria • Rescue & Rehab", "Nisria • Rescue & Rehab"), false,
  "P3b on the group surface itself → no veto");

// ---- P4: the deployed tool carries the veto (seam) ----
{
  const i = ST.indexOf('name === "post_to_group"');
  const region = i >= 0 ? ST.slice(i, i + 2400) : "";
  if (!region) fail("P4 post_to_group must exist");
  else if (!/sasa\.group_post_vetoed/.test(region)) fail("P4a must emit sasa.group_post_vetoed on a stray post");
  else if (!/commandReferencesGroup\(gtext, group\)/.test(region)) fail("P4b must gate on the shared commandReferencesGroup predicate");
  else if (!/if \(gtext && !ctx\.sourceGroup\)/.test(region)) fail("P4c must fail-open on a blank command and skip the group surface");
  else if (!/no_group_reference/.test(region)) fail("P4d a vetoed post must return ok:false with an honest reason");
  else ok("P4 post_to_group carries the deterministic group veto (shared predicate, fail-open, group-surface-safe)");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
