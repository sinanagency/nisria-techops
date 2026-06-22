// Send name-variant honesty wall (2026-06-22, KT #369). LIVE 22 Jun 10:26pm: Nur asked
// Sasa to "Send it to Malek as well." The bot DID send (Malek received it), but the
// contact resolved as "Malieng" while the model narrated "Messaged Malek" — the honesty
// guard matched recipients by EXACT token, so "malek" != "malieng" → it falsely corrected
// a DELIVERED send into HONEST_NO_SEND. Nur thought it failed; the bot re-sent 3× and
// spammed Malek ("Malek did receive the message whats this about lol aftr all that work").
//
// Fix: a claimed name with no exact match is covered ONLY by a real send this turn to a
// SPELLING VARIANT of it (one contains the other, or a ≥3-char shared prefix). A send to a
// genuinely DIFFERENT person does NOT cover it (skeptic: "Messaged Grace" over a send to
// Malieng must STILL flag). Each real recipient covers at most one claim, so the multi-send
// LIE still trips ("Sent to Violet. Cynthia has it." with only Violet sent → Cynthia flags).
//
// The mirror below replicates the deployed claimsSendWithoutSend matching exactly; the prod
// /api/gym guardcheck proves the same on the live bundle. V-seam pins the code shape.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SASA = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "agents", "sasa.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

const SEND_CLAIM = /\b(?:sent|messaged|texted|pinged|notified|told|let\b.*\bknow|reached out|shared it with)\b/i;
const SEND_HAS = /\b\w+\s+(?:has|have|received|got)\s+(?:the\s+(?:task|message|reminder|note)|it now)\b/i;
const sharedPrefix = (a, b) => { let n = 0; const m = Math.min(a.length, b.length); while (n < m && a[n] === b[n]) n++; return n; };
const isVariant = (r, c) => r === c || r.startsWith(c) || c.startsWith(r) || sharedPrefix(r, c) >= 3;
const STOP = ["done","sent","messaged","told","texted","whatsapp","with","the","link","and","context","also","hi","still","yo","who"];
function flagged(reply, sentNames /* delivered named recipients */, namelessSends = 0) {
  const remaining = sentNames.map((s) => s.toLowerCase());
  let spare = namelessSends;
  const named = []; let unnamed = 0;
  for (const s of String(reply).split(/[.!?]+\s+/).filter((x) => x.trim())) {
    if (!(SEND_CLAIM.test(s) || SEND_HAS.test(s))) continue;
    if (/\b(i will|i'?ll|want me to|haven'?t|have not|not yet)\b/i.test(s)) continue;
    const claimed = (s.match(/\b[A-Z][a-z]{2,}\b/g) || []).map((w) => w.toLowerCase()).filter((w) => !STOP.includes(w));
    if (claimed.length === 0) { unnamed++; continue; }
    for (const c of claimed) named.push(c);
  }
  const unresolved = [];
  for (const c of named) { const i = remaining.indexOf(c); if (i >= 0) remaining.splice(i, 1); else unresolved.push(c); }
  for (const c of unresolved) { const vi = remaining.findIndex((r) => isVariant(r, c)); if (vi >= 0) remaining.splice(vi, 1); else return true; }
  for (let k = 0; k < unnamed; k++) { if (remaining.length) remaining.shift(); else if (spare > 0) spare--; else return true; }
  return false;
}
const T = (got, want, m) => (got === want ? ok(m) : fail(`${m} (got ${got}, want ${want})`));

// ---- V1: the exact live bug — a real send to "Malieng" narrated as "Malek" ----
T(flagged("Done. Messaged Malek on WhatsApp with the link and context.", ["Malieng"]), false,
  "V1a 'Messaged Malek' over a real send to Malieng is NOT flagged (the live bug, prefix 'mal')");
T(flagged("Done. Messaged Malieng on WhatsApp with the link and context.", ["Malieng"]), false,
  "V1b exact-name match is fine");
T(flagged("I have shared it with them.", ["Malieng"]), false,
  "V1c an unnamed claim over a real send is fine");

// ---- V2: the multi-send LIE must STILL be caught ----
T(flagged("Sent it to Violet. Cynthia has the message.", ["Violet"]), true,
  "V2a 'Sent Violet, Cynthia has it' with ONLY Violet sent → still flagged (Cynthia lie)");
T(flagged("Messaged Mark and Grace.", []), true, "V2b a send claim with ZERO sends → flagged");
T(flagged("Messaged Mark and Grace.", ["Mark", "Grace"]), false, "V2c both named, both sent → not flagged");

// ---- V3: skeptic KT #369 — a DIFFERENT person must NOT be laundered by a real send ----
T(flagged("Messaged Grace.", ["Malieng"]), true,
  "V3a 'Messaged Grace' over a send to Malieng → STILL flagged (different person, not a variant)");
T(flagged("Done. I messaged Wahome about the clinic visit.", ["Malieng"]), true,
  "V3b 'messaged Wahome' over a send to Malieng → flagged (wrong-person laundering blocked)");
T(flagged("Messaged Malek and Bob.", ["Malieng", "Grace"]), true,
  "V3c two real sends but a claim to Bob (no variant among recipients) → flagged");
T(flagged("Sent. Told Bob.", ["Mark"]), true,
  "V3d unnamed 'Sent.' consumes the Mark send, then 'Told Bob' has no recipient → flagged");
T(flagged("Messaged Malek and Grace.", ["Malieng"]), true,
  "V3e Malek covered by the one send (variant), Grace has none → flagged");

// ---- V4: the deployed guard carries the variant contract (seam) ----
{
  const i = SASA.indexOf("function claimsSendWithoutSend");
  const region = i >= 0 ? SASA.slice(i, i + 5200) : "";
  if (!/const sentNames: string\[\] = \[\];/.test(region)) fail("V4a must collect resolved recipient names (not just a count)");
  else ok("V4a collects resolved recipient names");
  if (!/const isVariant = \(r: string, c: string\) =>/.test(region)) fail("V4b must define a spelling-variant test");
  else ok("V4b defines the spelling-variant test");
  if (!/sharedPrefix\(r, c\) >= 3/.test(region)) fail("V4c variant must require a >=3-char shared prefix (Malek/Malieng) — not a blind pool");
  else ok("V4c variant requires a >=3-char shared prefix");
  if (!/remaining\.findIndex\(\(r\) => isVariant\(r, cl\.c\)\)/.test(region)) fail("V4d an unmatched claim must seek a VARIANT among the real recipients, not any spare send");
  else ok("V4d unmatched claim seeks a variant among real recipients");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
