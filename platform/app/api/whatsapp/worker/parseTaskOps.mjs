// Deterministic pre-parsers for task OPERATIONS (state transitions, comments,
// dependencies). Same architectural pattern as parseTasks.mjs: pure regex that
// extracts INTENT + title fragment(s) from the body. The worker resolves the
// fragment against the tasks table (fuzzy match + recency tiebreak) and writes
// the change directly, bypassing the model + the smart-tool layer entirely.
//
// Returns null when no pattern matches; the worker falls through to runSasa as
// it always did.
//
// All exported functions are pure: no DB, no API, no I/O.

const STATUS_WORDS = {
  in_review: ["in review", "in_review", "review", "ready for review", "for review"],
  done: ["done", "complete", "completed", "finished"],
  blocked: ["blocked", "stuck", "on hold", "waiting"],
  abandoned: ["abandoned", "dropped", "cancelled", "canceled"],
  todo: ["todo", "to do", "back to todo", "open", "reopen"],
  in_progress: ["in progress", "in_progress", "started", "working on"],
};

function findStatusFromText(text) {
  const t = text.toLowerCase().trim();
  for (const [status, words] of Object.entries(STATUS_WORDS)) {
    for (const w of words) {
      const re = new RegExp(`(?:\\bas\\s+)?\\b${w.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b`, "i");
      if (re.test(t)) return status;
    }
  }
  return null;
}

function cleanFrag(s) {
  return String(s || "")
    .replace(/^(?:and|or|also|then|but|so|now)\s+/i, "")
    .replace(/^the\s+/i, "")
    .replace(/^(?:and|or|also|then|but|so|now)\s+/i, "")
    .replace(/\s+task\s*$/i, "")
    .replace(/\s+now\s*$/i, "")
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, "")
    .replace(/\s*[.,;:!]+\s*$/g, "")
    .trim();
}

// PATTERN 1: "mark X as in review", "mark X as done", "set X to blocked"
function matchMarkAs(body) {
  const re = /^\s*(?:mark|set|move|put)\s+(?:the\s+)?(.+?)\s+(?:as|to)\s+(.+?)\s*$/im;
  const m = body.match(re);
  if (!m) return null;
  const titleFrag = cleanFrag(m[1]);
  const status = findStatusFromText(m[2]);
  if (!titleFrag || titleFrag.length < 3 || !status) return null;
  return { intent: "transition_status", title_fragment: titleFrag, status, reason: null };
}

// PATTERN 2: "abandon X (because/since/reason: Y)"
function matchAbandon(body) {
  const re = /^\s*(?:abandon|drop|cancel|kill)\s+(?:the\s+)?(.+?)(?:\s*[,.]\s*(?:because|since|reason[:\s]|cause)\s+(.+?))?\s*$/im;
  const m = body.match(re);
  if (!m) return null;
  const titleFrag = cleanFrag(m[1]);
  if (!titleFrag || titleFrag.length < 3) return null;
  const reason = m[2] ? String(m[2]).trim().slice(0, 600) : null;
  return { intent: "transition_status", title_fragment: titleFrag, status: "abandoned", reason };
}

// PATTERN 3: "X is done", "X is blocked", "Y has been done" — past-state claims
function matchIsStatus(body) {
  const re = /^\s*(.+?)\s+(?:is|has\s+been)\s+(done|complete|completed|finished|blocked|abandoned|in\s+review|on\s+hold)\s*$/im;
  const m = body.match(re);
  if (!m) return null;
  const titleFrag = cleanFrag(m[1]);
  const status = findStatusFromText(m[2]);
  if (!titleFrag || titleFrag.length < 3 || !status) return null;
  return { intent: "transition_status", title_fragment: titleFrag, status, reason: null };
}

// PATTERN 4 (v1.3.6): verb-less "X as STATUS" — the second segment of a batch
// drops the imperative ("mark X as done AND Y as blocked" -> seg2 is "Y as
// blocked"). Specific enough not to overmatch ordinary prose: requires the
// trailing word to be a known status word AND the connector to be "as".
function matchTitleAsStatus(body) {
  const re = /^\s*(?:the\s+)?(.+?)\s+as\s+(.+?)\s*$/im;
  const m = body.match(re);
  if (!m) return null;
  const titleFrag = cleanFrag(m[1]);
  const status = findStatusFromText(m[2]);
  if (!titleFrag || titleFrag.length < 3 || !status) return null;
  return { intent: "transition_status", title_fragment: titleFrag, status, reason: null };
}

// Public: state-transition parser. Returns null if no match.
export function parseStateTransition(body) {
  const b = String(body || "").trim();
  if (b.length < 5) return null;
  return matchMarkAs(b) || matchAbandon(b) || matchIsStatus(b) || matchTitleAsStatus(b) || null;
}

// PATTERN 4: "add a comment on X: Y" / "note on X: Y" / "comment on X that Y"
export function parseTaskComment(body) {
  const b = String(body || "").trim();
  if (b.length < 10) return null;
  // "add a comment on the X task: Y" or with hyphen/dash separator
  const re = /^\s*(?:add\s+a\s+|please\s+add\s+a\s+)?(?:comment|note)\s+(?:on|to|for|about)\s+(?:the\s+)?(.+?)(?:\s+task)?[:,\-–]\s*(.+?)\s*$/im;
  const m = b.match(re);
  if (!m) return null;
  const titleFrag = cleanFrag(m[1]);
  const comment = String(m[2] || "").trim().slice(0, 4000);
  if (!titleFrag || titleFrag.length < 3 || !comment || comment.length < 2) return null;
  return { intent: "add_comment", title_fragment: titleFrag, comment_body: comment };
}

// PATTERN 5: "X blocks Y" / "Y depends on X" / "X before Y"
export function parseTaskDependency(body) {
  const b = String(body || "").trim();
  if (b.length < 10) return null;
  // "X blocks Y"
  let m = b.match(/^\s*(?:the\s+)?(.+?)\s+blocks\s+(?:the\s+)?(.+?)\s*$/im);
  if (m) {
    const left = cleanFrag(m[1]);
    const right = cleanFrag(m[2]);
    if (left.length >= 3 && right.length >= 3) {
      return { intent: "link_dependency", blocker_fragment: left, blocked_fragment: right };
    }
  }
  // "Y depends on X" (inverse — X is blocker, Y is blocked)
  m = b.match(/^\s*(?:the\s+)?(.+?)\s+depends\s+on\s+(?:the\s+)?(.+?)\s*$/im);
  if (m) {
    const right = cleanFrag(m[1]);
    const left = cleanFrag(m[2]);
    if (left.length >= 3 && right.length >= 3) {
      return { intent: "link_dependency", blocker_fragment: left, blocked_fragment: right };
    }
  }
  // "X comes before Y"
  m = b.match(/^\s*(?:the\s+)?(.+?)\s+(?:comes?\s+)?before\s+(?:the\s+)?(.+?)\s*$/im);
  if (m) {
    const left = cleanFrag(m[1]);
    const right = cleanFrag(m[2]);
    if (left.length >= 3 && right.length >= 3) {
      return { intent: "link_dependency", blocker_fragment: left, blocked_fragment: right };
    }
  }
  // "and X blocks Y" — handle the cycle-test inverse with leading conjunction
  m = b.match(/^\s*and\s+(?:the\s+)?(.+?)\s+blocks\s+(?:the\s+)?(.+?)\s*$/im);
  if (m) {
    const left = cleanFrag(m[1]);
    const right = cleanFrag(m[2]);
    if (left.length >= 3 && right.length >= 3) {
      return { intent: "link_dependency", blocker_fragment: left, blocked_fragment: right };
    }
  }
  return null;
}

// Shared: substring-then-word-overlap fuzzy matcher. Lifted from
// smart-tools.ts complete_task so behavior matches operator expectations.
// Returns up to N hits, best-match-first. Empty array means no candidate.
export function fuzzyMatchTasks(frag, openRows) {
  if (!frag) return [];
  const f = String(frag).toLowerCase().trim();
  if (!f) return [];
  const open = Array.isArray(openRows) ? openRows : [];
  // 1) substring (case-insensitive)
  let hits = open.filter((t) => String(t.title || "").toLowerCase().includes(f));
  if (hits.length) return hits;
  // 2) word-overlap fallback
  const words = f.split(/\s+/).filter((w) => w.length >= 3);
  if (!words.length) return [];
  const scored = open
    .map((t) => {
      const title = String(t.title || "").toLowerCase();
      const score = words.filter((w) => title.includes(w)).length;
      return { t, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  const best = scored.length ? scored[0].score : 0;
  // Require real overlap: ≥2 matched words, or all of a single-word phrase.
  if (best >= 2 || (best >= 1 && words.length === 1)) {
    return scored.filter((x) => x.score === best).map((x) => x.t);
  }
  return [];
}

// Recency tiebreak: when multiple tasks fuzzy-match, prefer the MOST RECENT
// one. Useful for "mark X as in review" after a fresh delegation. Pass the
// resolved hits (post-fuzzyMatchTasks) and the same open list (for stable
// created_at ordering, which we already have from the worker's query).
export function pickMostRecent(hits) {
  if (!Array.isArray(hits) || !hits.length) return null;
  return [...hits].sort((a, b) => {
    const at = a.created_at ? Date.parse(a.created_at) : 0;
    const bt = b.created_at ? Date.parse(b.created_at) : 0;
    return bt - at;
  })[0];
}

// PATTERN 6: priority shifts. tasks.priority is enum (high|medium|low). Three
// shapes the operator naturally uses:
//   "make X high priority" / "make X urgent"
//   "set X priority to high" / "set X to high priority"
//   "X is urgent" / "X is critical"
//   "drop priority on X"  ->  medium
// urgent/critical/top map to high; normal -> medium; minor -> low.
const PRIORITY_WORDS = {
  high: ["high", "urgent", "critical", "top"],
  medium: ["medium", "normal"],
  low: ["low", "minor"],
};

function findPriorityFromText(text) {
  const t = String(text || "").toLowerCase().trim();
  for (const [p, words] of Object.entries(PRIORITY_WORDS)) {
    for (const w of words) {
      const re = new RegExp(`\\b${w}\\b`, "i");
      if (re.test(t)) return p;
    }
  }
  return null;
}

export function parseTaskPriority(body) {
  const b = String(body || "").trim();
  if (b.length < 5) return null;
  // "make X high/urgent (priority)?" or "set X high/urgent (priority)?"
  let m = b.match(/^\s*(?:make|set)\s+(?:the\s+)?(.+?)\s+(high|medium|low|urgent|critical|top|normal|minor)(?:\s+priority)?\s*$/im);
  if (m) {
    const titleFrag = cleanFrag(m[1]);
    const priority = findPriorityFromText(m[2]);
    if (titleFrag.length >= 3 && priority) return { intent: "set_priority", title_fragment: titleFrag, priority };
  }
  // "set/change X priority to high"
  m = b.match(/^\s*(?:set|change)\s+(?:the\s+)?(.+?)\s+priority\s+to\s+(high|medium|low|urgent|critical|top|normal|minor)\s*$/im);
  if (m) {
    const titleFrag = cleanFrag(m[1]);
    const priority = findPriorityFromText(m[2]);
    if (titleFrag.length >= 3 && priority) return { intent: "set_priority", title_fragment: titleFrag, priority };
  }
  // "X is urgent" / "X is critical" / "X is high priority"
  m = b.match(/^\s*(?:the\s+)?(.+?)\s+is\s+(urgent|critical|high\s+priority)\s*$/im);
  if (m) {
    const titleFrag = cleanFrag(m[1]);
    if (titleFrag.length >= 3) return { intent: "set_priority", title_fragment: titleFrag, priority: "high" };
  }
  // "drop priority on X" -> medium (the user's intent is "less than now")
  m = b.match(/^\s*drop\s+priority\s+on\s+(?:the\s+)?(.+?)\s*$/im);
  if (m) {
    const titleFrag = cleanFrag(m[1]);
    if (titleFrag.length >= 3) return { intent: "set_priority", title_fragment: titleFrag, priority: "medium" };
  }
  return null;
}

// BATCH: split a body into op-level segments on ` and `, `;`, ` then `, or
// `, then `. Each segment is parsed independently. Returns null when the body
// is single-op (let the dispatcher handle directly) or when ANY segment fails
// to parse (we don't half-execute a batch — drop to runSasa for the model to
// handle the messy mixed case).
function splitSegments(body) {
  return String(body || "")
    .trim()
    .split(/\s*(?:,\s*then|;|then|and)\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseTaskOpsBatch(body) {
  const segments = splitSegments(body);
  if (segments.length < 2) return null;
  const intents = [];
  for (const seg of segments) {
    const st = parseStateTransition(seg);
    if (st) { intents.push({ kind: "state", seg, intent: st }); continue; }
    const ct = parseTaskComment(seg);
    if (ct) { intents.push({ kind: "comment", seg, intent: ct }); continue; }
    const dt = parseTaskDependency(seg);
    if (dt) { intents.push({ kind: "dependency", seg, intent: dt }); continue; }
    const pt = parseTaskPriority(seg);
    if (pt) { intents.push({ kind: "priority", seg, intent: pt }); continue; }
    return null;
  }
  return intents.length >= 2 ? intents : null;
}
