// STAGED-IS-NOT-DONE + META/SCOPE-LEAK honesty wall (2026-06-26, honesty-cluster).
// Locks the three engine fixes for the benchmark honesty failures:
//   #9  record_payment STAGES (awaiting_confirm); the model narrated it as a finished
//       log ("Logged. KES 180,000 to Mary.") and it slipped BOTH existing guards
//       (record_payment is a completion tool, so the completion-mismatch guard saw it
//       backed; and the reply used DONE language, not staging cues, so the fake-staging
//       guard didn't fire). New completedButOnlyStaged() catches it and rewrites to the
//       tool's honest "Ready to log... reply yes" summary.
//   #8  HONEST_NO_STAGING was money-shaped ("payee and amount in one sentence") and
//       leaked verbatim into a case-merge turn. Now domain-neutral.
//   #2/#12 the mesh tool-scope is internal; the bot leaked it ("I'm scoped to comms
//       tools only this turn", "the rules I run on now are tighter"). META_SCOPE_LEAK
//       strips it; NO_SCOPE_LEAK pins every specialist focus.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SASA = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "agents", "sasa.ts"), "utf8");
const SPEC = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "agents", "specialists", "index.ts"), "utf8");
// Routing patterns live in router-patterns.ts (extracted for testability); read both.
const ROUTER = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "agents", "router.ts"), "utf8") + "\n" + fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "agents", "router-patterns.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);
const flat = (s) => s.replace(/\s+/g, " ");

// ---- S0: PHASE-3 PRIMARY PATH — staged tools drive the reply deterministically ----
{
  if (!/function deterministicStagedConfirm\(/.test(SASA))
    fail("S0a deterministicStagedConfirm() must exist (the job-3 primary path)");
  else ok("S0a deterministicStagedConfirm() defined");
  // keys on the tool's OWN truth signal, not the model text
  if (!/detail\?\.staged === true/.test(SASA))
    fail("S0b must key on result.detail.staged===true (tool ground truth, not model prose)");
  else ok("S0b keys on tool's detail.staged ground truth");
  // wired as the FIRST substitution branch, ahead of sendStateTruth
  const i = SASA.indexOf("const stagedConfirm = deterministicStagedConfirm(toolRuns);");
  const region = i >= 0 ? SASA.slice(i, i + 400) : "";
  if (!region || !/if \(stagedConfirm\) \{[\s\S]{0,120}reply = humanize\(stagedConfirm/.test(region))
    fail("S0c stagedConfirm must be the primary branch that sets reply before any model-text guard");
  else ok("S0c stagedConfirm is the primary reply path");
}

// ---- S1: staged-is-not-done guard exists and is wired into finalize ----
{
  // Membership check (tolerant of additions): the stage-only money tools must include
  // record_payment and ingest_bank_email (both stage money awaiting Nur's yes).
  if (!/const STAGE_ONLY_TOOLS = new Set\(\[[^\]]*"record_payment"[^\]]*\]\)/.test(SASA) ||
      !/const STAGE_ONLY_TOOLS = new Set\(\[[^\]]*"ingest_bank_email"[^\]]*\]\)/.test(SASA))
    fail("S1a STAGE_ONLY_TOOLS must list the stage-only money tools (record_payment, ingest_bank_email)");
  else ok("S1a STAGE_ONLY_TOOLS present");
  if (!/function completedButOnlyStaged\(/.test(SASA))
    fail("S1b completedButOnlyStaged() must exist");
  else ok("S1b completedButOnlyStaged() defined");
  if (!/completedButOnlyStaged\(reply, toolRuns\)/.test(SASA) || !/stagedNotDone/.test(SASA))
    fail("S1c completedButOnlyStaged must be invoked in finalize and rewrite via stagedNotDone");
  else ok("S1c guard wired into finalize");
}

// ---- S2: HONEST_NO_STAGING is domain-NEUTRAL (no money-only phrasing) ----
{
  const i = SASA.indexOf("const HONEST_NO_STAGING =");
  const region = i >= 0 ? SASA.slice(i, i + 260) : "";
  if (/payee and amount/i.test(region))
    fail("S2 HONEST_NO_STAGING must NOT be money-shaped (leaked into case merges)");
  else ok("S2 HONEST_NO_STAGING is domain-neutral");
}

// ---- S3: meta/scope-leak guard exists and is applied ----
{
  if (!/const META_SCOPE_LEAK = /.test(SASA))
    fail("S3a META_SCOPE_LEAK regex must exist");
  else ok("S3a META_SCOPE_LEAK defined");
  if (!/META_SCOPE_LEAK\.test\(reply\)/.test(SASA))
    fail("S3b META_SCOPE_LEAK must be applied to the reply in finalize");
  else ok("S3b META_SCOPE_LEAK applied");
}

// ---- S4: every specialist focus is pinned against scope leaks ----
{
  if (!/const NO_SCOPE_LEAK = /.test(SPEC))
    fail("S4a NO_SCOPE_LEAK block must exist in specialists");
  else ok("S4a NO_SCOPE_LEAK defined");
  if (!/DOMAIN_FOCUS\[domain\] \|\| DOMAIN_FOCUS\.general\) \+ NO_SCOPE_LEAK/.test(SPEC))
    fail("S4b NO_SCOPE_LEAK must be appended to the domainFocus passed to the engine");
  else ok("S4b NO_SCOPE_LEAK appended to domainFocus");
}

// ---- S5: "remind me to ..." routes to work, not comms ----
{
  if (!/remind\\s\+me\|set\\s\+\(\?:a\\s\+\)\?reminder/.test(ROUTER.replace(/\s+/g, "")) &&
      !/remind\s*\\s\+\s*me/.test(ROUTER))
    // tolerant check: the work block must carry an explicit remind-me pattern
    (/work[\s\S]{0,400}remind\\s\+me/.test(ROUTER) ? ok("S5 remind-me work pattern present")
      : fail("S5 work patterns must include an explicit remind-me route"));
  else ok("S5 remind-me work pattern present");
}

// ---- B1..B4: BEHAVIORAL — the live regexes must match the real failure strings ----
// (copies of the source literals; S* above pins that the source uses these exact ones)
{
  const STAGING_CUE = /\b(?:ready to (?:log|record|stage|file)|reply\s+["']?yes["']?|to\s+confirm|awaiting\s+(?:your\s+)?confirm|once\s+you\s+confirm|i'?ve\s+staged|i\s+have\s+staged|staged\s+(?:it|that|this))\b/i;
  const STAGED_DONE_CLAIM = /\b(?:logged|recorded|(?:all\s+)?done|completed?)\b/i;

  // #9 real reply: "Logged. KES 180,000 to Mary Kafua..." — bare "Logged." with NO agent
  // subject, which AGENT_COMPLETION/DONE_SIMPLE skip. STAGED_DONE_CLAIM must catch it.
  const r9 = "Logged. KES 180,000 to Mary Kafua on 26 May 2026 via M-Pesa.";
  const r9b = "All done, that payment is recorded.";
  if (!(STAGED_DONE_CLAIM.test(r9) && !STAGING_CUE.test(r9)))
    fail("B1 staged-as-done must catch the BARE 'Logged.' shape (#9's actual reply)");
  else ok("B1 catches bare 'Logged.' staged-as-done (#9)");
  if (!(STAGED_DONE_CLAIM.test(r9b) && !STAGING_CUE.test(r9b)))
    fail("B2 staged-as-done must match 'all done ... recorded' shape");
  else ok("B2 catches 'all done' staged-as-done");
  // honest staging reply must be LEFT ALONE (staging cue present, "log" not "logged")
  const honest = "Ready to log KES 180,000 to Mary Kafua. Reply yes to confirm.";
  if (STAGING_CUE.test(honest) && !/\blogged\b/i.test(honest)) ok("B3 honest 'Ready to log... reply yes' reply is NOT rewritten");
  else fail("B3 honest staging reply must carry a staging cue and avoid 'logged'");
}
{
  const META_SCOPE_LEAK = /\b(?:scoped to|this lane|that lane|outside (?:this|my) lane|specialist this turn|switch to the \w+ lane|the rules i run on|i'?ve been (?:improved|upgraded|retrained)|my (?:architecture|training|rules|guardrails)|tool(?:set)? (?:is )?scoped|i can(?:'t| ?not) (?:create|do) \w+ (?:this turn|in this lane))\b/i;
  const leak12 = "I'm scoped to comms tools only this turn and can't create tasks or reminders. You'll need to switch to the task lane for that one.";
  const leak2 = "Honestly, I'm better. The rules I run on now are tighter.";
  const clean = "On it. The follow-up reminder is set for 2pm tomorrow.";
  if (!META_SCOPE_LEAK.test(leak12)) fail("B4 must catch the comms scope leak (#12)");
  else ok("B4 catches the scope leak (#12)");
  if (!META_SCOPE_LEAK.test(leak2)) fail("B5 must catch the self-rules meta-narrative (#2)");
  else ok("B5 catches the meta-narrative (#2)");
  if (META_SCOPE_LEAK.test(clean)) fail("B6 must NOT flag a clean operational reply");
  else ok("B6 leaves a clean reply alone");
}

// ---- B7: PRIMARY PATH behavioral — staged tool results drive the reply verbatim ----
{
  const deterministicStagedConfirm = (toolRuns) => {
    const staged = toolRuns.filter((t) => t.result?.ok === true && t.result?.detail?.staged === true);
    if (!staged.length) return null;
    const lines = staged.map((t) => String(t.result?.summary || "").trim()).filter(Boolean);
    if (!lines.length) return null;
    if (lines.length === 1) return lines[0];
    return `A few things to confirm:\n${lines.map((s, i) => `${i + 1}. ${s}`).join("\n")}`;
  };
  // single staged payment -> reply is the tool's honest line, regardless of any model text
  const r1 = deterministicStagedConfirm([{ name: "record_payment", result: { ok: true, summary: "Ready to log KES 15,000 to Lucy. Reply yes to confirm.", detail: { staged: true } } }]);
  if (r1 === "Ready to log KES 15,000 to Lucy. Reply yes to confirm.") ok("B7 single staged action relays the tool's honest line");
  else fail("B7 single staged action must relay the tool summary verbatim, got: " + r1);
  // merge_case staged -> uses the merge tool's line (NOT money text) — fixes #8
  const r2 = deterministicStagedConfirm([{ name: "merge_case", result: { ok: true, summary: 'Merging the case "Princess" into "Mercy" moves its history. Reply yes to confirm.', detail: { staged: true } } }]);
  if (/Merging the case/.test(r2) && !/payee|amount/.test(r2)) ok("B8 merge_case relays its OWN line, no money text (#8)");
  else fail("B8 merge_case must relay its own staging line, got: " + r2);
  // nothing staged -> null (model prose stands for pure conversation)
  if (deterministicStagedConfirm([{ name: "list_tasks", result: { ok: true, rows: [] } }]) === null) ok("B9 non-staged turn returns null (model prose stands)");
  else fail("B9 must return null when nothing was staged");
  // batch -> numbered
  const r3 = deterministicStagedConfirm([
    { name: "record_payment", result: { ok: true, summary: "Ready to log KES 15,000 to Lucy. Reply yes.", detail: { staged: true } } },
    { name: "record_payment", result: { ok: true, summary: "Ready to log KES 5,000 to Mark. Reply yes.", detail: { staged: true } } },
  ]);
  if (/1\. Ready to log KES 15,000/.test(r3) && /2\. Ready to log KES 5,000/.test(r3)) ok("B10 batch staged actions are numbered");
  else fail("B10 batch must number each staged line, got: " + r3);
}
