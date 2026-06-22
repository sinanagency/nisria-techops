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
