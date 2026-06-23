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

// OPEN-DUPLICATE detection for create_task (KT #378, the multiplicity cell from the 727
// cartography: "Write the weekly newsletter" landed ×3, "Follow up with Mamoun" ×2). A new
// task must NOT duplicate an already-OPEN one for the SAME assignee. Keyed on normalized
// title (case/space-insensitive) AND assignee — two people can hold a same-titled task
// (the identity-before-collapse lesson, [[match-dedup]] / KT #375). Recurrence-safe by
// construction: the caller passes only NON-done rows, so a completed copy still allows a
// fresh instance. assignee null/"" compare equal (both unassigned).
export function isSameOpenTask(rowTitle, rowAssignee, title, assigneeId) {
  return normalizeKey(rowTitle) === normalizeKey(title) &&
    String(rowAssignee || "") === String(assigneeId || "");
}

// Given the OPEN task rows ({title, assignee_id}), return the one that duplicates
// (title, assigneeId), or null. Caller MUST pass only non-done rows (recurrence-safe).
export function findOpenDuplicate(openRows, title, assigneeId) {
  if (!Array.isArray(openRows)) return null;
  return openRows.find((r) => r && isSameOpenTask(r.title, r.assignee_id, title, assigneeId)) || null;
}
