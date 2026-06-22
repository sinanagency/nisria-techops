// Team-to-team relay wall (2026-06-22, Bug 4 / KT #368). A team member could reach Nur
// (flag_to_nur) but had NO way to pass a message to a COLLEAGUE — message_person is
// admin-only and not in the team toolset. New relay_to_colleague tool: resolves a
// TEAMMATE only, attributes the sender ("From <name>: ..."), honors the 24h window with a
// held relay, dedups, verified send. Operators (Nur/owner) are REFUSED and pointed at
// flag_to_nur; outside contacts/donors/beneficiaries are never reachable.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SASA = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "agents", "sasa.ts"), "utf8");
const ST = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "smart-tools.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);
const flat = (s) => s.replace(/\s+/g, " ");

// ---- R1: the tool is available to TEAM members (the whole point) ----
{
  if (!/TEAM_TOOL_NAMES = new Set\(\[[^\]]*"relay_to_colleague"/.test(flat(SASA)))
    fail("R1a relay_to_colleague must be in TEAM_TOOL_NAMES (team members must be able to use it)");
  else ok("R1a relay_to_colleague is a team tool");
  if (!/SEND_TOOLS = new Set\(\[[^\]]*"relay_to_colleague"/.test(flat(SASA)))
    fail("R1b relay_to_colleague must be in SEND_TOOLS (so 'Passed it to X' is honesty-verified)");
  else ok("R1b relay_to_colleague is a send tool (honesty-guarded)");
  // the team prompt must teach it AND keep the flag_to_nur boundary
  if (!/relay_to_colleague/.test(SASA.slice(SASA.indexOf("TEAM-TO-TEAM"))) ) fail("R1c the team prompt must teach relay_to_colleague");
  else ok("R1c team prompt teaches relay_to_colleague");
}

// ---- R2: the tool schema exists (to + message) ----
{
  const i = ST.indexOf('name: "relay_to_colleague"');
  const def = i >= 0 ? ST.slice(i, i + 1200) : "";
  if (!def) fail("R2a relay_to_colleague tool def must exist");
  else if (!/required: \["to", "message"\]/.test(def)) fail("R2b schema must require to + message");
  else if (!/NOT for Nur or the owner/i.test(def)) fail("R2c the description must steer Nur-bound items to flag_to_nur");
  else ok("R2 relay_to_colleague schema: to+message, with the flag_to_nur boundary in the description");
}

// ---- R3: the impl is a SEND in runAction with the team-safety properties ----
{
  const i = ST.indexOf('if (name === "relay_to_colleague")');
  const region = i >= 0 ? ST.slice(i, i + 5200) : "";
  if (!region) fail("R3 relay_to_colleague impl must exist");
  // must run as an ACTION (after the runAction boundary), not a read
  else if (!(i > ST.indexOf("async function runAction"))) fail("R3a relay must live in runAction (it sends), not runRead");
  // resolve TEAM ROSTER ONLY
  else if (!/from\("team_members"\)/.test(region)) fail("R3b must resolve against team_members ONLY (never the contacts book)");
  // attribute the sender
  else if (!/const body = `From \$\{senderName\}: \$\{message\}`/.test(region)) fail("R3c must attribute the sender ('From <name>: ...')");
  // REFUSE operators -> flag_to_nur
  else if (!/recipRole === "admin" \|\| recipRank === "owner" \|\| recipRank === "founder"/.test(region)) fail("R3d must REFUSE relaying to an operator (Nur/owner)");
  else if (!/suggest: "flag_to_nur"/.test(region)) fail("R3e an operator recipient must be pointed at flag_to_nur");
  // refuse self
  else if (!/number === senderKey/.test(region)) fail("R3f must refuse relaying to the sender's own number");
  // verified send + held relay on window
  else if (!/const res: any = await sendText\(number, body\)/.test(region)) fail("R3g must actually send via sendText");
  else if (!/triggerType: "window_open"/.test(region)) fail("R3h must hold the relay for an off-window colleague (window_open intent)");
  else if (!/registerIntent\(/.test(region)) fail("R3i held relay must register a durable intent");
  // dedup
  else if (!/sasa\.relayed_colleague/.test(region)) fail("R3j must emit sasa.relayed_colleague (dedup + audit)");
  else ok("R3 relay impl: runAction send, team-only resolve, sender-attributed, operator-refused→flag_to_nur, self-refused, verified, held-relay, deduped");
}

// ---- R4: never claim delivery it did not get (verified) ----
{
  const i = ST.indexOf('if (name === "relay_to_colleague")');
  const region = i >= 0 ? ST.slice(i, i + 5200) : "";
  // the only ok:true 'Passed it to' delivered:true return must be AFTER a successful send
  const passedIdx = region.indexOf("Passed it to");
  const sendIdx = region.indexOf("await sendText(number, body)");
  if (!(sendIdx > 0 && passedIdx > sendIdx)) fail("R4a the 'Passed it to' confirmation must come AFTER the real send (never before)");
  else ok("R4a 'Passed it' is only claimed after a real send");
  if (!/queued: true, to: toName/.test(region)) fail("R4b an off-window relay must report queued, not delivered");
  else ok("R4b off-window relay reports queued (honest, not a false 'sent')");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
