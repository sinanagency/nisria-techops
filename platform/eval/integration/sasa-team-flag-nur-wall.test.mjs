// Team flag-to-Nur wall (2026-06-22). Pins the capability: a team member sends a
// document/photos → it is saved on file → the bot flags it to Nur on WhatsApp for a
// keep-or-flag decision, and NEVER tells the team member to forward it themselves.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ST = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "smart-tools.ts"), "utf8");
const SA = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "agents", "sasa.ts"), "utf8");
const WK = fs.readFileSync(path.resolve(HERE, "..", "..", "app", "api", "whatsapp", "worker", "route.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

// ---- N1: the tool exists, is a read-side tool, and is in the TEAM toolset ----
{
  if (!/name: "flag_to_nur"/.test(ST)) fail("N1a flag_to_nur tool schema must exist");
  if (!/"flag_for_clarity", "flag_to_nur"/.test(ST)) fail("N1b flag_to_nur must be registered in READ_TOOLS");
  if (!/TEAM_TOOL_NAMES = new Set\(\[[^\]]*"flag_to_nur"/.test(SA)) fail("N1c flag_to_nur must be in TEAM_TOOL_NAMES (team members can use it)");
  else ok("N1 flag_to_nur exists, read-tool, available to the team tier");
}

// ---- N2: the impl reaches Nur canonically + is honest on failure ----
{
  const i = ST.indexOf('if (name === "flag_to_nur")');
  const region = i >= 0 ? ST.slice(i, i + 2400) : "";
  if (!region) fail("N2 the flag_to_nur impl must exist");
  else if (!/ops\.find\(\(k\) => !owners\.includes\(k\)\) \|\| null/.test(region)) fail("N2a Nur is the operator who is not the owner; refuse rather than fall back to the owner");
  else if (!/pushOperatorUpdate\(db, nurWa, "Nur", body, \{ needsReply: true \}\)/.test(region)) fail("N2b it must WhatsApp Nur via the reply template (survives the 24h window)");
  else if (!/sasa\.flagged_to_nur/.test(region)) fail("N2c it must emit an observable event");
  else if (!/if \(!r\.ok\) return \{ ok: false[\s\S]{0,120}?have not flagged it/.test(region)) fail("N2d it must be HONEST when Nur could not be reached (no false 'flagged')");
  else if (!/keep it on file/.test(region)) fail("N2e it must offer Nur the keep-or-flag choice");
  // skeptic #1: dedup so a multi-photo intake is not N pings
  else if (!/eq\("type", "sasa\.flagged_to_nur"\)\.eq\("subject_id", contactId\)[\s\S]{0,300}?deduped: true/.test(region)) fail("N2f it must dedup repeat flags to Nur (no spam on a multi-photo intake)");
  // skeptic #3: a quiet-hours deferral is queued, not failed
  else if (!/if \(r\.deferredQuietHours\) return \{ ok: true[\s\S]{0,140}?morning/.test(region)) fail("N2g a quiet-hours deferral must be reported as queued-for-morning, not a failure");
  else ok("N2 flag_to_nur: canonical Nur, keep/flag, honest-on-fail, deduped, quiet-hours honest");
}

// ---- N3: the deflection is gone; the document clause is in ----
{
  if (/draft a message for \$\{who\} to send via Nur/.test(SA)) fail("N3a the old deflection ('draft a message for them to send via Nur') must be removed");
  if (!/DOCUMENTS AND PHOTOS FROM \$\{who\}/.test(SA)) fail("N3b the team prompt must instruct: a team document is saved + flagged to Nur");
  if (!/NEVER tell \$\{who\} to forward the document to Nur themselves/.test(SA)) fail("N3c the prompt must forbid telling the team member to forward it themselves");
  else ok("N3 team prompt: no deflection, documents are saved + flagged to Nur");
}

// ---- N4: the worker hands a team-framed command on a team member's document ----
{
  if (!/command = role === "team"/.test(WK)) fail("N4a the worker media command must branch on role=team");
  if (!/use flag_to_nur with a short summary/.test(WK)) fail("N4b the team-framed command must point at flag_to_nur");
  if (!/Do NOT ask the sender to forward it to Nur themselves/.test(WK)) fail("N4c the team command must forbid the forward-it-yourself deflection");
  else ok("N4 worker: a team member's document gets a team-framed command (save + flag Nur)");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
