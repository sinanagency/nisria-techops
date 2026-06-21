// Group-bot Phase 0 wall (2026-06-22, group-bot-v1 S13/S4/S9). Phase 0 makes the
// group brain SEE STRAIGHT without changing any outward behavior (no migration, no
// new outbound, GROUP_LISTEN_ONLY stays on):
//   S13 — group history is SPEAKER-TAGGED (was anonymous; the brain couldn't tell who
//         said which line, the "stay sane" blind spot).
//   S4  — parseTasksFired is passed into the group runSasa call so the brain is the
//         SOLE task writer (kills the latent two-decider duplicate). One-decider law.
//   S9  — an EXACT reply anchor: the userbot forwards the quoted message's id and the
//         ingest resolves it to messages.external_id (mirrors the reaction path),
//         instead of relying on a fuzzy client-supplied text fragment.
//
// Pure local (source-seam + behavioural mirror). The userbot lives at the REPO ROOT
// (group-bot/index.mjs), not under platform/.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const I = fs.readFileSync(path.resolve(HERE, "..", "..", "app", "api", "group", "ingest", "route.ts"), "utf8");
const U = fs.readFileSync(path.resolve(HERE, "..", "..", "..", "group-bot", "index.mjs"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);

// ---- G1: S13 speaker-tagged history ----
{
  const i = I.indexOf("SPEAKER-TAGGED (S13)");
  const region = i >= 0 ? I.slice(i - 80, i + 1600) : "";
  if (!region) fail("G1 the speaker-tagged history block must exist");
  else if (!/\.select\("body,direction,created_at,contact_id"\)/.test(region)) fail("G1 the history SELECT must add contact_id (was anonymous)");
  else if (!/from\("contacts"\)\.select\("id,name"\)\.in\("id", histContactIds\)/.test(region)) fail("G1 it must resolve sender names via the contacts FK in one batch");
  else if (!/\$\{speaker\}: \$\{content\}/.test(region) || !/: content \} as const/.test(region)) fail("G1 inbound lines must be prefixed 'Name: ', outbound left bare");
  else if (!/m\.direction !== "out" && m\.contact_id/.test(region)) fail("G1 only INBOUND lines with a contact get a speaker (assistant lines stay unprefixed)");
  else if (!/\.limit\(8\)/.test(region)) fail("G1 must keep the same 8-line window (additive, not a behavior change)");
  else ok("G1 S13: group history is speaker-tagged via the contacts FK, same window, outbound unprefixed");
}

// ---- G2: S4 single-writer — HONEST handling (skeptic-corrected) ----
// The group parseTasks block only STAGES a proposal for Nur's approval; it never
// writes a tasks row. The DM `parseTasksFired` flag means "a task ROW was already
// written" and makes the brain claim "Done, logged X". Wiring it into the group's
// stage-only path would be a FALSE completion claim (Law 11). With parse OFF by
// default the brain is already the sole group writer, so Phase 0 deliberately does
// NOT wire the flag; the honest parse-on dedup is Phase 1 consent work.
{
  const i = I.indexOf("casesIntake: isCaseGroup(group)"); // the MAIN group runSasa call
  const region = i >= 0 ? I.slice(i - 100, i + 900) : "";
  if (!region) fail("G2 the main group runSasa call must exist");
  // the flag must NOT be passed into the group runSasa call (object-property form)
  else if (/\n\s*parseTasksFired,\n/.test(region)) fail("G2 parseTasksFired must NOT be wired into the group runSasa (stage-only path would falsely claim 'Done, logged')");
  // the parseTasks staging block must still exist (untouched), and the decision must be documented
  else if (!/let parseTasksFired = false;/.test(I)) fail("G2 the parseTasks staging block must be KEPT (untouched)");
  else if (!/S4 NOTE \(group-bot Phase 0, skeptic-corrected\)/.test(I)) fail("G2 the deliberate not-wired decision must be documented at the call site");
  else ok("G2 S4: parseTasksFired deliberately NOT wired (group stages, never writes — wiring it would be a false completion claim); honest dedup deferred to Phase 1");
}

// ---- G3: S9 ingest — exact quote anchor resolved server-side ----
{
  if (!/const quotedId = String\(body\.quoted_id \|\| ""\)\.trim\(\);/.test(I)) fail("G3 ingest must parse the new quoted_id field");
  const i = I.indexOf("S9 (read side)");
  const region = i >= 0 ? I.slice(i, i + 900) : "";
  if (!region) fail("G3 the S9 quote-anchor block must exist");
  else if (!/from\("messages"\)\.select\("body"\)\.eq\("external_id", quotedId\)/.test(region)) fail("G3 quoted_id must resolve to messages.external_id (mirror the reaction path)");
  else if (!/replying to message \$\{quotedId\}/.test(region)) fail("G3 the exact anchor must reference the resolved message id");
  else if (!/quotedText \? `\[replying to: /.test(region)) fail("G3 the fuzzy quotedText anchor must remain as a FALLBACK");
  else ok("G3 S9 ingest: quoted_id resolved to the exact logged message; fuzzy quotedText kept as fallback");
}

// ---- G4: S9 userbot — captures + forwards the quoted stanza id ----
{
  if (!/const quoted_id = mctx\?\.stanzaId \? String\(mctx\.stanzaId\) : "";/.test(U)) fail("G4 the userbot must capture mctx.stanzaId as quoted_id");
  // it must be in the ingest payload, next to quoted_text
  if (!/quoted_text,\s*\n\s*quoted_id,/.test(U)) fail("G4 quoted_id must be added to the ingest payload (next to quoted_text)");
  else ok("G4 S9 userbot: captures contextInfo.stanzaId and forwards quoted_id in the ingest payload");
}

// ---- G5: behavioural mirror of the speaker-tagging map ----
{
  const nameById = new Map([["c1", "Mark"], ["c2", "Eliza"]]);
  const rows = [
    { direction: "in", contact_id: "c1", body: "the STP is done" },
    { direction: "out", contact_id: null, body: "Noted, thanks." },
    { direction: "in", contact_id: "c2", body: "waiting on the office" },
    { direction: "in", contact_id: "c9", body: "no contact name here" },
  ];
  const history = rows.map((m) => {
    const isOut = m.direction === "out";
    const speaker = !isOut && m.contact_id ? nameById.get(m.contact_id) : null;
    const content = String(m.body || "");
    return { role: isOut ? "assistant" : "user", content: speaker ? `${speaker}: ${content}` : content };
  });
  if (history[0].content !== "Mark: the STP is done") fail("G5 a known inbound sender must be prefixed with their name");
  else if (history[1].content !== "Noted, thanks." || history[1].role !== "assistant") fail("G5 an outbound line must stay unprefixed (assistant)");
  else if (history[2].content !== "Eliza: waiting on the office") fail("G5 a second speaker must be tagged distinctly (no conflation)");
  else if (history[3].content !== "no contact name here") fail("G5 an inbound with no resolvable name must fall back to the bare body");
  else ok("G5 speaker-tag mirror: each inbound line carries its own speaker; outbound bare; unknown falls back");
}

// ---- G6: no-break / no-new-outbound invariants ----
{
  // Phase 0 introduces NO new GROUP outbound (the pre-existing FLAG_NUR escalation
  // sends to Nur's 727, never the group, and fires even in listen-only by design).
  if (!/GROUP_LISTEN_ONLY/.test(I)) fail("G6 GROUP_LISTEN_ONLY must still gate the route");
  else if (/\bgroup\.send\b/.test(I)) fail("G6 Phase 0 must not enqueue a group.send (no new group outbound)");
  else ok("G6 no-break: LISTEN_ONLY intact, no group.send introduced (727 FLAG_NUR escalation is pre-existing + allowed)");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
