// Name→record resolution discipline (KT #385, 727 cartography intake-edit class). Several
// edit tools resolve a person by a fuzzy `ilike('%name%')`, ask only on >1, and act on the
// sole substring hit — so a bare first name ("fund Mary") could write the WRONG child's
// funding bar / public story. These pure helpers add (a) exact-match preference and (b) a
// "bare first name on a sole FUZZY hit must confirm" floor for the child-safeguarding writes.
// Imported by lib/smart-tools.ts AND the wall (zero-drift). No DB, no side effects.

export function normName(n) {
  return String(n || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// A bare first name = a single token (no surname). Risky to act on a sole fuzzy hit.
export function isBareFirstName(query) {
  return normName(query).split(" ").filter(Boolean).length < 2;
}

// Classify a fuzzy candidate set ({...,[field]}) against the query name:
//   { kind:"exact-one",  pick } — exactly one EXACT normalized name match (preferred)
//   { kind:"exact-many", ask  } — >1 exact same-name → identity ambiguity, ask
//   { kind:"fuzzy-one",  pick } — no exact match, a sole substring hit
//   { kind:"fuzzy-many", ask  } — no exact match, several substring hits, ask
//   { kind:"none" }             — nothing matched
// Narrow a fuzzy candidate list to a UNIQUE exact-name match when one exists; otherwise
// return the list unchanged (never worse). Lets a resolver prefer the person the operator
// EXACTLY named over a longer-substring sibling ("Ahmed" over "Ahmed Khan"), instead of
// asking or shadowing. Used by the MED/LOW intake-edit resolvers (KT #386).
export function preferExact(list, query, field = "full_name") {
  const ls = (list || []).filter(Boolean);
  const ex = ls.filter((r) => normName(r[field]) === normName(query));
  return ex.length === 1 ? ex : ls;
}

export function classifyNameMatch(candidates, query, field = "full_name") {
  const cands = (candidates || []).filter(Boolean);
  if (!cands.length) return { kind: "none" };
  const q = normName(query);
  const exact = cands.filter((c) => normName(c[field]) === q);
  if (exact.length === 1) return { kind: "exact-one", pick: exact[0] };
  if (exact.length > 1) return { kind: "exact-many", ask: exact };
  if (cands.length === 1) return { kind: "fuzzy-one", pick: cands[0] };
  return { kind: "fuzzy-many", ask: cands };
}
