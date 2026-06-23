// C2 stage-then-confirm gate wall (2026-06-23, KT #374). Class C2 = the MODEL fires a HIGH
// side-effect, irreversible action (log_payout moves money; delete_* destroy data) on its own
// judgment, ungated. The convergence fix: on WhatsApp, such a tool STAGES a pending_actions
// confirm_action and asks "reply yes"; the confirm gate runs the REAL tool with a verified
// result. One generic kind so every future risky tool plugs in without a migration. This
// iteration wires the highest-blast tool (log_payout) end-to-end as the proven pattern.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ST = fs.readFileSync(path.resolve(HERE, "..", "..", "lib", "smart-tools.ts"), "utf8");
const W = fs.readFileSync(path.resolve(HERE, "..", "..", "app", "api", "whatsapp", "worker", "route.ts"), "utf8");
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };
const ok = (m) => console.log("PASS:", m);
const flat = (s) => s.replace(/\s+/g, " ");

// ---- A1: log_payout STAGES on the WhatsApp surface, never fires on model judgment ----
{
  const i = ST.indexOf('name === "log_payout"');
  const region = i >= 0 ? ST.slice(i, i + 1600) : "";
  if (!region) fail("A1 log_payout must exist");
  // staging branch gated on confirmWrites + contactId, BEFORE the direct write (ref = ...)
  else if (!/if \(ctx\.confirmWrites && ctx\.contactId\) \{/.test(region)) fail("A1a log_payout must stage on the WhatsApp surface (confirmWrites)");
  else if (!/kind: "confirm_action", status: "awaiting_confirm"/.test(flat(region))) fail("A1b must stage a confirm_action pending_action");
  else if (!/payload: \{ tool: "log_payout", args:/.test(flat(region))) fail("A1c the staged payload must carry tool + args for the gate to dispatch");
  else if (!/Reply yes to confirm/.test(region)) fail("A1d a staged payout must ask the operator to confirm with yes");
  else {
    // the staging must come BEFORE the direct insert into payments (so the model can't fire it)
    const stageIdx = region.indexOf("confirm_action");
    const writeIdx = region.indexOf('from("payments").insert');
    if (!(stageIdx > 0 && writeIdx > stageIdx)) fail("A1e the stage branch must precede the direct ledger write");
    else ok("A1 log_payout stages-then-confirms on WhatsApp, before any direct ledger write");
  }
}

// ---- A2: graceful fall-through — never WORSE than today if staging is unavailable ----
{
  const i = ST.indexOf('name === "log_payout"');
  const region = i >= 0 ? ST.slice(i, i + 1600) : "";
  // only RETURN the staged confirmation when the insert did NOT error; otherwise fall through
  if (!/if \(!stErr\) return \{ ok: true, summary: humanize\(`Want me to log/.test(region))
    fail("A2a must only confirm-stage when the insert succeeded (else fall through to the direct write)");
  else ok("A2 staging fails safe: a rejected insert falls through to today's direct write (never worse)");
}

// ---- A3: the confirm gate runs the REAL tool, owner/founder only, verified ----
{
  const i = W.indexOf('else if (p.kind === "confirm_action")');
  const region = i >= 0 ? W.slice(i, i + 2000) : "";
  if (!region) fail("A3 the confirm gate must handle confirm_action");
  // authority re-derived from the LIVE operator, not the staged payload
  else if (!/const liveAdmin = opRank === "owner" \|\| opRank === "founder"/.test(region)) fail("A3a must re-derive authority from the LIVE operator (owner/founder)");
  else if (!/if \(!liveAdmin\)/.test(region)) fail("A3b a non-owner/founder must NOT be able to confirm an irreversible action");
  // runs the real tool with confirmWrites OFF (so it executes, not re-stages)
  else if (!/runSmartTool\(tool, args, \{ contactId, tier: "admin", rank:/.test(region)) fail("A3c must run the REAL tool via runSmartTool(payload.tool, payload.args)");
  else if (/confirmWrites: true/.test(region)) fail("A3d the confirm-time run must NOT pass confirmWrites (or it would re-stage forever)");
  // verified: only report success on r.ok===true, else it stays failed/staged
  else if (!/if \(r\?\.ok === true\) \{ notes\.push/.test(region)) fail("A3e must report the tool's OWN verified summary on success");
  else if (!/else \{ okItem = false; failed\.push/.test(region)) fail("A3f a failed confirm leaves the action un-committed (retryable), never a fake done");
  // skeptic C: an allowlist — only a whitelisted tool may be dispatched by "yes"
  else if (!/const CONFIRMABLE_TOOLS = new Set\(\["log_payout"/.test(region)) fail("A3g must allowlist confirm-able tools (no arbitrary payload.tool dispatch)");
  else if (!/!CONFIRMABLE_TOOLS\.has\(tool\)/.test(region)) fail("A3h must refuse a tool not on the allowlist");
  else ok("A3 confirm gate: live-authority-gated, allowlisted, runs the real tool, verified, no fabricated done");
}

// ---- A5: skeptic E — an irreversible/money confirm requires a STRICT yes (no soft praise) ----
{
  if (!/const hasIrreversible = \(pend \|\| \[\]\)\.some\(\(p: any\) => p\.kind === "confirm_action"\)/.test(W))
    fail("A5a the gate must detect when an irreversible confirm_action is staged");
  else ok("A5a gate detects a staged irreversible action");
  if (!/const strictYes = /.test(W)) fail("A5b must define a STRICT yes for irreversible confirms");
  else ok("A5b defines a strict yes");
  if (!/const effectiveYes = hasIrreversible \? strictYes : yes;/.test(W)) fail("A5c an irreversible confirm must require strictYes, not the broad conversational yes");
  else ok("A5c irreversible confirm requires strictYes (soft 'perfect'/'great' never commits money)");
  if (!/if \(effectiveYes\) \{/.test(W)) fail("A5d the commit branch must gate on effectiveYes");
  else ok("A5d commit branch gates on effectiveYes");
  // belt: the strict set must NOT include the soft praise words that the broad set has
  const sm = W.match(/const strictYes = \/([^\n]*?)\/\.test\(t\)/);
  if (sm && /\bperfect\b|\bgreat\b|sounds good|lgtm|\bfine\b|\bsure\b/.test(sm[1])) fail("A5e strictYes must EXCLUDE soft praise words (perfect/great/sounds good/lgtm/fine/sure)");
  else ok("A5e strictYes excludes the soft praise words (the 🙏-class lesson, applied to money)");
}

// ---- A4: 'yes' / 'no' vocab + the gate is reached for any awaiting_confirm kind ----
{
  if (!/eq\("status", "awaiting_confirm"\)/.test(W)) fail("A4a the gate must load awaiting_confirm pending_actions");
  else ok("A4a confirm gate loads awaiting_confirm rows (confirm_action included)");
  if (!/const no = /.test(W)) fail("A4b a 'no' must cancel the staged action");
  else ok("A4b 'no' cancels the staged action (nothing fires)");
}

// ---- A6: the DELETE family (permanent data loss) is gated by ONE interceptor ----
{
  // the interceptor sits at the TOP of runAction (before the tool dispatch) so it covers all 5
  const i = ST.indexOf("C2 STAGE-THEN-CONFIRM for the DELETE family");
  const region = i >= 0 ? ST.slice(i, i + 1400) : "";
  if (!region) fail("A6 the delete-family stage interceptor must exist");
  else if (!/const DELETE_TOOLS = new Set\(\["delete_event", "delete_contact", "delete_case", "delete_document", "delete_payment"\]\)/.test(region))
    fail("A6a all five delete tools must be gated");
  else if (!/if \(ctx\.confirmWrites && ctx\.contactId && DELETE_TOOLS\.has\(name\)\)/.test(region))
    fail("A6b the interceptor must fire only on the WhatsApp surface (confirmWrites)");
  else if (!/kind: "confirm_action"/.test(region)) fail("A6c a delete must stage a confirm_action");
  else if (!/permanently deletes/.test(region)) fail("A6d the confirm prompt must warn it is permanent/irreversible");
  else ok("A6 the delete family (5 tools) is gated by one stage-then-confirm interceptor with an irreversibility warning");
  // it must run BEFORE the tool dispatch (so the model can't reach the delete) — interceptor is
  // above the first `if (name === "create_task")`
  const interceptIdx = ST.indexOf("DELETE_TOOLS.has(name)");
  const firstToolIdx = ST.indexOf('if (name === "create_task")');
  if (!(interceptIdx > 0 && interceptIdx < firstToolIdx)) fail("A6e the interceptor must precede the tool dispatch");
  else ok("A6e interceptor runs before any tool logic (model never reaches the delete)");
}

// ---- A7: the gate allowlist now includes the delete family ----
{
  if (!/const CONFIRMABLE_TOOLS = new Set\(\["log_payout", "delete_event", "delete_contact", "delete_case", "delete_document", "delete_payment"\]\)/.test(W))
    fail("A7a the confirm-gate allowlist must include the 5 delete tools");
  else ok("A7a the gate allowlists log_payout + the 5 delete tools");
}

if (process.exitCode) console.error("\nWALL RED.");
else console.log("\nWALL GREEN.");
