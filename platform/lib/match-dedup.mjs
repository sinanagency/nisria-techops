// Duplicate-collapse for fragment resolvers (2026-06-23, KT #375, the ambiguity-loop class).
// LIVE: a resolver matched two records identical except letter-case ("Contact Jensen..." vs
// "contact Jensen...") via a case-insensitive ilike, returned "which one?", and the operator
// could NOT break the loop — "lowercase" re-ran the same match → still 2 → asked again forever.
//
// THE INVARIANT (one node, every resolver): when multiple fragment matches are DUPLICATES (the
// same normalized name/title, differing only by case or whitespace), they are the SAME record,
// so "act on one of them" is unambiguous — pick ONE and proceed. Only GENUINELY different
// records still trigger the "which one?" ask. This is the inverse direction of the over-action
// class: over-CAUTION that strands the operator.
//
// pickFromMatches(cands, getKey): returns the record to act on, or null if genuinely ambiguous.
//   - 0 matches -> null
//   - 1 match -> that one
//   - N matches, all duplicates (one distinct normalized key) -> ONE of them (the LAST; when the
//     caller ordered newest-first that is the OLDEST, so deleting/acting keeps the freshest copy)
//   - N matches, >1 distinct key -> null (the caller asks "which one?")
export function normalizeKey(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function pickFromMatches(cands, getKey = (c) => c && c.title) {
  if (!Array.isArray(cands) || cands.length === 0) return null;
  if (cands.length === 1) return cands[0];
  const distinct = new Set(cands.map((c) => normalizeKey(getKey(c))));
  return distinct.size === 1 ? cands[cands.length - 1] : null;
}

// True when the match set is all-duplicates (so the caller can word the reply "removed the
// duplicate, kept the other copy" honestly).
export function isAllDuplicates(cands, getKey = (c) => c && c.title) {
  if (!Array.isArray(cands) || cands.length <= 1) return false;
  return new Set(cands.map((c) => normalizeKey(getKey(c)))).size === 1;
}
