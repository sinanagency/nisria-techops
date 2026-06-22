// Cross-turn self-recall wall (2026-06-22 → hardened, KT #372). LIVE 11:40pm: Sasa sent to
// Malieng, then 6s later said "I have not actually messaged them" and re-offered → it re-sent.
// Fix: before crying no-send, recentlySentTo() consults the REAL outbound log and, if the
// claim is verified, skips the lie + re-offer. A SKEPTIC demolished the first cut (it read the
// messages table, which includes the bot's own REPLIES to the operator → a reply counted as a
// relay → it would launder a lie). Hardened: (1) PROACTIVE sends only (whatsapp.message_out /
// sasa.relayed_colleague EVENTS, never messages); (2) a CONTENT TIE — the matched send's body
// must share a distinctive word with the claim, so a stale/prefix-colliding send to a
// different topic cannot suppress a NEW false claim; (3) an 8-min window. A false-suppress
// (silent lie) is worse than the loud redo, so when in doubt it does NOT suppress.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recallMatch, isNameVariant, sharesDistinctiveToken } from "../../lib/name-variant.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SASA = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "agents", "sasa.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);
const T = (got, want, m) => (got === want ? ok(m) : fail(`${m} (got ${JSON.stringify(got)}, want ${want})`));

// Pure mirror of recentlySentTo's decision (name match + content tie). `sends` = proactive
// send EVENTS only [{to, text}]; claimText = reply + command.
function wouldSuppress(sends, claimedNames, command, claimText) {
  const matched = recallMatch(sends.map((s) => s.to), claimedNames, command);
  if (!matched) return null;
  const send = sends.find((s) => s.to === matched);
  const exclude = [...claimedNames, ...matched.split(/\s+/)].map((x) => String(x).toLowerCase());
  if (!send || !sharesDistinctiveToken(claimText, send.text, exclude)) return null;
  return matched;
}

const SIKKA_SEND = { to: "Malieng", text: "Hi Malek, proposal for the Sikka 2027 Open Call, a Maisha Art Installation, deadline August 17. https://dubaiculture.gov.ae" };
const SIKKA_CLAIM = "Done. Messaged Malek with the Sikka 2027 Open Call brief, Maisha Art Installation, due August 17.";

// ---- S1: the exact live bug — sent to Malieng (proactive), claim about Malek, same topic ----
T(wouldSuppress([SIKKA_SEND], ["Malek"], "Send it to Malek", SIKKA_CLAIM), "Malieng",
  "S1a a proactive send to 'Malieng' about Sikka verifies a 'Messaged Malek about Sikka' claim → no lie/re-offer");
T(wouldSuppress([SIKKA_SEND], [], "Send it to Malek as well", SIKKA_CLAIM), "Malieng",
  "S1b unnamed claim falls back to the command's 'to Malek' and still recalls the Sikka send");

// ---- S2: skeptic A — a STALE/DIFFERENT-TOPIC send must NOT suppress a new false claim ----
{
  const clinicSend = { to: "Malieng", text: "Hi Malek, reminder the clinic rota changed to Tuesday mornings." };
  T(wouldSuppress([clinicSend], ["Malek"], "tell Malek about the gala", "Done. Messaged Malek about the gala budget."), null,
    "S2a a 23-min-old clinic-rota send does NOT verify a NEW 'messaged Malek about the gala' claim (content tie fails)");
}

// ---- S3: skeptic C — a prefix-3 collision (Mark/Martha) is blocked by the content tie ----
{
  const marthaSend = { to: "Martha", text: "Hi Martha, the venue walkthrough is confirmed for 3pm." };
  T(wouldSuppress([marthaSend], ["Mark"], "tell Mark", "Done. Messaged Mark the budget figures."), null,
    "S3a a send to Martha does NOT verify a 'messaged Mark the budget' claim (different topic) even though mar==mar");
  // same topic is the only way a prefix collision could pass — and then they're plausibly coordinating
  if (!isNameVariant("Mark", "Martha")) ok("S3b (note) Mark/Martha share a 3-prefix — the content tie is what saves it");
  else ok("S3b Mark/Martha share a 3-prefix — the content tie is the real guard");
}

// ---- S4: must NOT recall a different person, or nothing ----
T(wouldSuppress([{ to: "Grace", text: "Sikka 2027 Maisha installation August 17" }], ["Malek"], "Send it to Malek", SIKKA_CLAIM), null,
  "S4a a send to Grace does NOT verify a Malek claim (no name variant) even if the topic matches");
T(wouldSuppress([], ["Malek"], "Send it to Malek", SIKKA_CLAIM), null,
  "S4b no proactive sends at all → null (honest no-send path runs)");

// ---- S5: content-tie primitive ----
{
  if (!sharesDistinctiveToken(SIKKA_CLAIM, SIKKA_SEND.text, ["malek", "malieng"])) fail("S5a the Sikka claim and the Sikka send must share a distinctive word");
  else ok("S5a claim and matching send share a distinctive word (sikka/maisha/august)");
  if (sharesDistinctiveToken("Done. Messaged Malek about the gala budget.", SIKKA_SEND.text, ["malek", "malieng"])) fail("S5b a gala claim must NOT tie to the Sikka send body");
  else ok("S5b an unrelated-topic claim does not tie (name excluded)");
}

// ---- S6: the deployed branch is wired to the HARDENED source (seam) ----
{
  if (!/import \{ recallMatch, sharesDistinctiveToken \} from "\.\.\/name-variant\.mjs";/.test(SASA))
    fail("S6a sasa.ts must import recallMatch + sharesDistinctiveToken (shared, zero drift)");
  else ok("S6a sasa.ts imports the shared matchers");
  const i = SASA.indexOf("async function recentlySentTo");
  const fn = i >= 0 ? SASA.slice(i, i + 2300) : "";
  if (/from\("messages"\)/.test(fn)) fail("S6b recentlySentTo must NOT read the messages table (reply pollution) — events only");
  else ok("S6b recentlySentTo does not read the polluted messages table");
  if (!/eq\("type", "whatsapp\.message_out"\)/.test(fn) || !/eq\("type", "sasa\.relayed_colleague"\)/.test(fn))
    fail("S6c recentlySentTo must read PROACTIVE send events (message_out + relayed_colleague)");
  else ok("S6c recentlySentTo reads proactive send events only");
  if (!/sharesDistinctiveToken\(claimText, send\.text, exclude\)/.test(fn)) fail("S6d recentlySentTo must apply the content tie (name-excluded) before suppressing");
  else ok("S6d recentlySentTo applies the content tie");
  const ci = SASA.indexOf("const alreadySent = await recentlySentTo(");
  const call = ci >= 0 ? SASA.slice(ci, ci + 200) : "";
  if (!/, 8\)/.test(call)) fail("S6e the call must use a tight (8-min) window, not 30");
  else ok("S6e the call uses a tight 8-minute window");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
