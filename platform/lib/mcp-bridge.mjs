// mcp-bridge.mjs — PURE logic for the Claude ↔ Portal MCP bridge (Spec 001 / ADR-0013).
//
// Zero-drift pattern (matches whatsapp-format.mjs): every decision that a wall
// needs to assert lives here as a pure function, imported by BOTH the tool layer
// (lib/mcp-tools.ts) and the wall (eval/integration/mcp-bridge-wall.test.mjs).
// No DB, no network, no Date in the shapers that the wall pins — time is passed in.

// Beneficiary financial columns are EXCLUDED from read_brain in v1 (ADR-0013 #6).
// An external LLM does not get a window into money/funding without an explicit
// later decision. Donor/bank tables are simply never queried by the bridge.
export const FINANCIAL_FIELDS = ["goal_amount", "funded_amount"];

// The only beneficiary fields the brain exposes to Claude. Whitelist, not
// blacklist: a new financial column added later cannot leak by default.
export const BRAIN_BENEFICIARY_FIELDS = [
  "id", "ref_code", "full_name", "location", "category", "status",
  "needs", "story_private", "program", "region", "guardian_status",
  "intake_date", "tags",
];

// CRUD safe-list (Phase 1 only saves documents; the list is the Phase 2 contract).
export const CRUD_SAFE_LIST = ["documents", "drafts", "notes", "tasks"];

// Strip financial fields from any brain row before it leaves the portal.
export function stripFinancials(row) {
  if (!row || typeof row !== "object") return row;
  const out = {};
  for (const k of Object.keys(row)) {
    if (FINANCIAL_FIELDS.includes(k)) continue;
    out[k] = row[k];
  }
  return out;
}

// Project a raw beneficiary row down to the whitelisted brain fields (and strip
// financials as a belt-and-braces second pass).
export function projectBeneficiary(row) {
  if (!row) return null;
  const out = {};
  for (const f of BRAIN_BENEFICIARY_FIELDS) {
    if (f in row) out[f] = row[f];
  }
  return stripFinancials(out);
}

// Synthetic, unique drive_file_id for a Claude-authored document. documents.
// drive_file_id is NOT NULL + UNIQUE, so non-Drive docs need a sentinel that is
// (a) unique and (b) self-identifying as Claude-authored.
export function claudeDriveFileId(uuid) {
  return `claude:${uuid}`;
}

// MCP tool-result shapers. Every tool returns { content: [{type:'text', text}] }.
// The text is JSON carrying an explicit `status` so the caller (and the wall)
// can never mistake a staged/failed action for a completed one (KT #357 honesty).
export function mcpResult(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}
export function okResult(data) { return mcpResult({ status: "ok", ...data }); }
export function sentResult(data) { return mcpResult({ status: "sent", ...data }); }
export function stagedResult(data) { return mcpResult({ status: "staged", ...data }); }
export function notFoundResult(what) { return mcpResult({ status: "not_found", what }); }
export function needsTargetResult(field, hint) { return mcpResult({ status: "needs_target", field, hint }); }
export function failedResult(reason, extra = {}) {
  // isError surfaces to the MCP client as a tool error, never a silent success.
  return { content: [{ type: "text", text: JSON.stringify({ status: "failed", reason, ...extra }) }], isError: true };
}

// Parse the JSON status back out of a tool result (used by the wall).
export function statusOf(result) {
  try { return JSON.parse(result.content[0].text).status; } catch { return null; }
}

// Validate a save_document call. Title + non-trivial content required; case_id
// optional in Phase 1 but, when the caller signals a case is required and none
// is given, we return needs_target rather than silently filing it nowhere.
export function validateSaveDocument(args) {
  const title = (args?.title || "").trim();
  const content = (args?.content || "").trim();
  if (title.length < 2) return { ok: false, field: "title", hint: "a document title (>= 2 chars)" };
  if (content.length < 10) return { ok: false, field: "content", hint: "the document body (>= 10 chars)" };
  return { ok: true, title, content };
}

// Scrub PostgREST `.or()`-meta characters from a user-supplied search term.
// The `.or()` mini-language treats comma (clause separator), parentheses
// (grouping), colon, and `*` as syntax, and ILIKE treats `%`/`_` as wildcards.
// Without this, a query like "x,national_id.not.is.null" injects a new filter
// clause and turns a whitelisted search into a PII oracle. Matches the proven
// scrub at lib/smart-tools.ts (the lesson this regressed and now re-applies).
export function scrubOrFilter(s) {
  return String(s || "").replace(/[(),:*%_]/g, "");
}

// Dedup key for a WhatsApp send: same (recipient, document or message body) inside
// a short window is the same logical send. Pure: no time. For free text we key on
// the normalized body itself (capped) rather than a lossy 32-bit hash, so distinct
// messages cannot collide into a false "duplicate". NOTE: this in-window check is
// best-effort and does NOT defend against truly concurrent fires (no lock / unique
// constraint); DB-enforced idempotency is a Phase 2 item (see spec open questions).
export function sendDedupeKey(to, documentId, text) {
  const recipient = String(to || "").replace(/\D/g, "").slice(-12);
  if (documentId) return `doc:${recipient}:${documentId}`;
  const body = String(text || "").trim().replace(/\s+/g, " ").toLowerCase().slice(0, 240);
  return `txt:${recipient}:${body}`;
}

// Given prior send events and a key, is this a duplicate within the window?
// priorEvents: [{ key, atMs }]. Caller supplies nowMs (no Date here).
export function isRecentDuplicate(priorEvents, key, windowMs, nowMs) {
  if (!Array.isArray(priorEvents)) return false;
  return priorEvents.some((e) => e && e.key === key && (nowMs - Number(e.atMs)) >= 0 && (nowMs - Number(e.atMs)) < windowMs);
}

// Build the portal deep-link Phase 1 sends to Nur for a document. She is
// authenticated to the portal, so a login-gated link is fine for her (a media
// push is NOT — Meta cannot fetch a login-gated URL; that is Phase 2).
export function documentDeepLink(origin, docId) {
  const base = String(origin || "https://command.nisria.co").replace(/\/+$/, "");
  return `${base}/documents/${docId}`;
}

// The text body Phase 1 sends for a document hand-off.
export function documentHandoffText(title, deepLink) {
  return `Document ready: ${title}\nOpen it here: ${deepLink}`;
}

// Constant-time-ish bearer compare for Phase 1 secret auth (length-guarded).
export function bearerMatches(provided, expected) {
  if (!provided || !expected) return false;
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
