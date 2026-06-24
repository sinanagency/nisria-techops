// mcp-bridge-wall — pins the PURE honesty + safety logic of the Claude↔Portal
// MCP bridge (Spec 001 / ADR-0013). Imports the SAME module the tool layer uses
// (zero-drift). Exits 0 only if every seam holds, so run-walls gates a deploy.
import assert from "node:assert";
import {
  FINANCIAL_FIELDS,
  stripFinancials,
  projectBeneficiary,
  claudeDriveFileId,
  validateSaveDocument,
  sendDedupeKey,
  isRecentDuplicate,
  documentDeepLink,
  documentHandoffText,
  bearerMatches,
  failedResult,
  sentResult,
  stagedResult,
  okResult,
  notFoundResult,
  needsTargetResult,
  statusOf,
  scrubOrFilter,
} from "../../lib/mcp-bridge.mjs";

let n = 0;
const ok = (cond, msg) => { n++; assert.ok(cond, msg); };

// P1 — financials never leave the portal (Honesty/ADR #6).
ok(FINANCIAL_FIELDS.includes("goal_amount") && FINANCIAL_FIELDS.includes("funded_amount"), "P1 financial list");
const strip = stripFinancials({ full_name: "A", goal_amount: 500, funded_amount: 10, needs: "x" });
ok(!("goal_amount" in strip ? strip : { goal_amount: undefined }).goal_amount && strip.goal_amount === undefined, "P1 goal stripped");
ok(strip.funded_amount === undefined, "P1 funded stripped");
ok(strip.full_name === "A" && strip.needs === "x", "P1 non-financial kept");

// P2 — projectBeneficiary whitelists, drops unknown + financial fields even if present.
const proj = projectBeneficiary({ full_name: "B", needs: "food", goal_amount: 9, secret_col: "leak", ref_code: "R1" });
ok(proj.full_name === "B" && proj.needs === "food" && proj.ref_code === "R1", "P2 whitelist kept");
ok(proj.goal_amount === undefined, "P2 financial dropped");
ok(proj.secret_col === undefined, "P2 unknown column not leaked");

// P3 — synthetic drive_file_id is self-identifying + unique-shaped.
ok(claudeDriveFileId("abc").startsWith("claude:"), "P3 claude prefix");
ok(claudeDriveFileId("x") !== claudeDriveFileId("y"), "P3 distinct ids");

// P4 — save validation refuses thin input, accepts real input.
ok(validateSaveDocument({ title: "x", content: "short" }).ok === false, "P4 reject short title");
ok(validateSaveDocument({ title: "Contract", content: "hi" }).ok === false, "P4 reject short content");
const good = validateSaveDocument({ title: "Service Contract", content: "This is the full agreement body." });
ok(good.ok === true && good.title === "Service Contract", "P4 accept good");

// P5 — dedupe key stable + discriminating.
ok(sendDedupeKey("+971501168462", "doc1") === sendDedupeKey("971501168462", "doc1"), "P5 phone-normalized equal");
ok(sendDedupeKey("971", "doc1") !== sendDedupeKey("971", "doc2"), "P5 different doc differs");
ok(sendDedupeKey("971", null, "Hello") === sendDedupeKey("971", null, "hello"), "P5 text case-insensitive equal");
ok(sendDedupeKey("971", null, "a") !== sendDedupeKey("971", null, "b"), "P5 different text differs");

// P6 — recent-duplicate window: inside true, outside false, other key false.
const NOW = 1_000_000;
const prior = [{ key: "doc:111:d1", atMs: NOW - 10_000 }];
ok(isRecentDuplicate(prior, "doc:111:d1", 90_000, NOW) === true, "P6 within window dup");
ok(isRecentDuplicate(prior, "doc:111:d1", 5_000, NOW) === false, "P6 outside window not dup");
ok(isRecentDuplicate(prior, "doc:111:dX", 90_000, NOW) === false, "P6 other key not dup");
ok(isRecentDuplicate([], "k", 90_000, NOW) === false, "P6 empty not dup");

// P7 — deep-link + handoff text (Phase 1 sends a link, never a media blob).
ok(documentDeepLink("https://command.nisria.co/", "abc") === "https://command.nisria.co/documents/abc", "P7 deep link");
ok(documentHandoffText("Letter", "L").includes("Letter") && documentHandoffText("Letter", "L").includes("L"), "P7 handoff text");

// P8 — bearer compare: equal true, unequal/length/empty false.
ok(bearerMatches("secret123", "secret123") === true, "P8 equal");
ok(bearerMatches("secret123", "secretXYZ") === false, "P8 unequal");
ok(bearerMatches("short", "longersecret") === false, "P8 length mismatch");
ok(bearerMatches("", "x") === false && bearerMatches("x", "") === false, "P8 empty");

// P9 — result shapers carry an explicit, honest status; failed is flagged isError.
ok(statusOf(okResult({})) === "ok", "P9 ok");
ok(statusOf(sentResult({})) === "sent", "P9 sent");
ok(statusOf(stagedResult({})) === "staged", "P9 staged");
ok(statusOf(notFoundResult("d")) === "not_found", "P9 not_found");
ok(statusOf(needsTargetResult("to", "hint")) === "needs_target", "P9 needs_target");
const f = failedResult("boom");
ok(statusOf(f) === "failed" && f.isError === true, "P9 failed isError");

// P10 — PostgREST .or() filter-injection is neutralized (C1 regression guard).
// The comma + parens + colon that would inject a new filter clause MUST be gone.
const inj = scrubOrFilter("x,national_id.not.is.null,contact_phone.ilike.*");
ok(!inj.includes(","), "P10 comma stripped (no clause injection)");
ok(!inj.includes("(") && !inj.includes(")"), "P10 parens stripped");
ok(!inj.includes(":") && !inj.includes("*"), "P10 colon + star stripped");
ok(!inj.includes("%") && !inj.includes("_"), "P10 ilike wildcards stripped");
ok(scrubOrFilter("Amina Hassan").length > 0, "P10 ordinary name survives scrub");

console.log(`WALL GREEN: mcp-bridge ${n} checks passed`);
