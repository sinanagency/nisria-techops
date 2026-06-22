// Pure name-variant matching (2026-06-22, KT #369/#372). Two people are the SAME when one
// name contains the other or they share a >=3-char prefix — so "Malek" matches a contact
// stored as "Malieng" (full name "Malek Malieng"), a nickname matches a first name, etc.
// Shared by the send-honesty guard (claimsSendWithoutSend) and the cross-turn self-recall
// (recentlySentTo) so both use ONE rule (zero drift). Deliberately conservative: a >=3
// shared prefix, never a blind match, so genuinely different people (Grace vs Malieng) do
// NOT collide.
function sharedPrefix(a, b) {
  let n = 0; const m = Math.min(a.length, b.length);
  while (n < m && a[n] === b[n]) n++;
  return n;
}

export function isNameVariant(a, b) {
  const x = String(a || "").toLowerCase(), y = String(b || "").toLowerCase();
  if (!x || !y) return false;
  return x === y || x.startsWith(y) || y.startsWith(x) || sharedPrefix(x, y) >= 3;
}

// Tokenize a stored contact name into its individual name words (first, last, ...).
export function nameTokens(s) {
  return String(s || "").toLowerCase().replace(/[^\p{L}\s]/gu, " ").split(/\s+/).filter((w) => w.length >= 2);
}

// Distinctive (identity-bearing) tokens of a text: words >=4 chars that are not generic
// scaffold. Used to TIE a send-claim to the actual sent body, so a stale/unrelated proactive
// send to the same person cannot suppress a NEW false claim about a different thing.
const CONTENT_STOP = new Set([
  "this","that","with","from","your","you","our","the","and","for","have","has","been","will",
  "would","could","should","about","there","here","what","when","them","they","their","then",
  "done","sent","message","messaged","please","want","need","into","over","just","also","more",
  "send","tell","told","note","task","link","here's","heres","reply","yes","now","once","still",
]);
export function contentTokens(s, exclude = []) {
  const ex = new Set(exclude.map((x) => String(x).toLowerCase()));
  return new Set(
    String(s || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/)
      .filter((w) => w.length >= 4 && !CONTENT_STOP.has(w) && !ex.has(w)),
  );
}
// TOPIC overlap, excluding the recipient name(s) — the person's name appears in both the
// claim and the send body, so it must NOT count as a topic match (else any claim about the
// right person ties regardless of subject). Pass the claimed + matched names to exclude.
export function sharesDistinctiveToken(a, b, exclude = []) {
  const A = contentTokens(a, exclude); if (!A.size) return false;
  const B = contentTokens(b, exclude);
  for (const t of B) if (A.has(t)) return true;
  return false;
}

// Given the names actually messaged recently and the names the operator/model referenced
// (or, if none, the "to <Name>" in the command), return the matched recent name or null.
export function recallMatch(recentNames, claimedNames, command = "") {
  let claims = (claimedNames || []).map((c) => String(c).toLowerCase());
  if (!claims.length) {
    const m = String(command || "").match(/\b(?:tell|message|send(?:\s+(?:it|this|that))?\s+to|to)\s+([A-Z][a-z]{2,})/);
    if (m) claims = [m[1].toLowerCase()];
  }
  if (!claims.length) return null;
  for (const recName of recentNames || []) {
    for (const tok of nameTokens(recName)) {
      for (const c of claims) if (isNameVariant(tok, c)) return recName;
    }
  }
  return null;
}
