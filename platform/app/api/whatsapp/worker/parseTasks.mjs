// parseTasks — pure regex pre-processor for task-shaped WhatsApp messages.
//
// Sasa 727 v1. The 727 worker and the group ingest route both call this BEFORE
// they wake the model, so a task lands in the database deterministically, never
// at the model's discretion. The model still gets the original body verbatim,
// plus a one-line context note describing what was parsed, so it can narrate
// what code has already made true. KT #110.
//
// Pure: no DB, no API, no I/O, no Date.now() reads beyond the optional `today`
// argument. Same input deterministically produces the same output. Tested by
// `platform/eval/01-priority-task-delegation.test.mjs` (10 golden cases) plus
// the new cases 11..16 in v1.
//
// Returns:
//   { tasks: ParsedTask[],
//     context_note: string,           // one-line summary for runSasa
//     raw_body_unchanged: string }    // exact input body
//
// See FROZEN-SPEC.md §4 and ADR-001 for the contract and the alternatives
// considered. See `data/_schemas.json` for the production tasks columns.

// ────────────────────────────────────────────────────────────────────────────
// VERBS — the words that turn a sentence into a task request.
// "thanks" / "hi" / "good" deliberately excluded. Order doesn't matter; this
// is checked as a word-boundary lookup, never substring.
// ────────────────────────────────────────────────────────────────────────────
const TASK_VERBS = new Set([
  "handle","arrange","pick","sort","prepare","message","call","send","get",
  "take","make","schedule","draft","write","build","create","fix","follow",
  "organize","organise","look","setup","check","find","share","finish",
  "complete","ship","deliver","file","save","post","upload","download",
  "transfer","deposit","withdraw","pay","log","do","action","review",
  "approve","decline","reach","contact","forward","update","add","remove",
  "set","cancel","reschedule","reassign","move","close","open","start",
  "stop","track","record","collect","gather","compile","clean","clear",
  "audit","prep","ping","email","escalate","resolve",
  // v1.3.4: workplace imperatives surfaced by Taona's "Order 50 new chairs"
  // miss. Pattern G's hasVerbShape check rejected the bullet because "order"
  // was not in this set. Expand to the common ops vocabulary so we do not
  // need an LLM to validate that an imperative is task-shaped.
  "order","buy","purchase","procure","rent","lease","return","refund",
  "hire","fire","recruit","train","onboard","offboard","lead","mentor",
  "plan","design","launch","release","publish","print","cut","mint",
  "test","demo","present","host","attend","join","invite","brief","debrief",
  "research","investigate","explore","analyze","analyse","summarize",
  "summarise","report","verify","validate","confirm","reconcile","close",
  "remind","notify","alert","push","pull","install","deploy","rollback",
  "deactivate","activate","enable","disable","grant","revoke","approve",
  "assign","unassign","tag","label","prioritize","prioritise","defer",
  "replace","swap","rotate","store","stock","restock","ship","fetch",
  "merge","split","duplicate","copy","clone","draft","draft up","spin up",
]);

// Phrases at the front of a sentence that signal a request even before a verb,
// e.g. "@Cynthia please pick up the package". Lowercased.
const REQUEST_PREFIXES = [
  "please","pls","can you","could you","would you","will you",
  "kindly","mind","mind if you","need you to","ineed you to",
  "i need you to","help me","help with","let's","lets",
];

// Words that DISQUALIFY an @-mention from being a task (acknowledgement shape).
const ACKNOWLEDGEMENT_PREFIXES = [
  "thanks","thank","thx","ty","ta","cheers","appreciate","appreciated",
  "good","great","nice","well done","welldone","awesome","amazing",
  "hi","hello","hey","yo","sup","morning","afternoon","evening","gm","gn",
];

// Words at the very start of a body that mean DELETE/CANCEL, not CREATE.
// Used to skip messages like "Cancel the calls with Edith".
const DELETE_PREFIXES = ["cancel","delete","remove","scratch","drop","undo","unassign"];

// Recurrence keywords. The migration adds these to the tasks.recurrence enum
// already; this set is what the regex looks for inside the body.
const RECURRENCE_KEYWORDS = {
  daily: ["every day","daily","each day"],
  weekdays: ["every weekday","weekdays","each weekday"],
  weekly: ["every week","weekly","each week"],
  biweekly: ["every two weeks","biweekly","every other week","fortnightly"],
  monthly: ["every month","monthly","each month","of every month","of each month"],
};

// Common bullet markers we strip from a list item.
const BULLET_RE = /^\s*(?:[-•*]\s+|\d+[.)]\s+)/;

// Default for sender_role / sender_rank. parseTasks defaults to admin/founder
// when not set so the eval (which passes only body + roster + message ids)
// gets the same answer the production caller would.
function defaultSenderRole(s) { return s === "team" ? "team" : "admin"; }

// v1.3.12: "me" / "myself" / "my own board" resolve to the sender's
// team_members row in Patterns A, B, C, F. Closes the 2026-06-10 ghost-
// confirm class: Pattern A returned assignee_id=null for "Assign these tasks
// to me", the worker silently skipped every row at the assignee_unresolved
// gate, the model still narrated "Logged seven" because recent activity from
// the previous turn had flipped parseTasksFired=true and stripped create_task.
// KT #274 (2026-06-15): also accept connector-prefixed self-targets
// ("for me" / "to me" / "on me" / "for myself") so the parser still wins when
// Pattern A's regex captures the connector along with the pronoun. Same
// surface as smart-tools' SELF_PRONOUNS; both walls now match. The 2026-06-14
// 17:07 Nur incident ("Assign this tasks for me: Brainstorming with Ashraf")
// failed Pattern A because the regex required "to", not "for"; the parser fell
// through and the LLM had to recover. Both the regex AND isSelfTarget now
// cover for/to/on so a regression in either still ends with the right resolve.
function isSelfTarget(name) {
  if (!name) return false;
  const v = String(name).trim().toLowerCase().replace(/[.,;:!?]+$/, "");
  if (v === "me" || v === "myself" || v === "my self" || v === "my own board" || v === "my board") return true;
  if (v === "for me" || v === "to me" || v === "on me") return true;
  if (v === "for myself" || v === "to myself" || v === "for my self" || v === "to my self") return true;
  return false;
}

// ────────────────────────────────────────────────────────────────────────────
// MATCH a name to a team_members row. Returns a discriminated union so the
// caller can surface ambiguity instead of swallowing it:
//   { kind: 'unique', member }
//   { kind: 'ambiguous', candidates: [...] }
//   { kind: 'none' }
// Exact full-name match (case-insensitive on the full stored name) ALWAYS
// wins as 'unique' even when a first-name prefix would collide. Single-word
// search that hits 2+ active members becomes 'ambiguous' (KT #275, 2026-06-15:
// "Lucy" matching both Lucy Wangare and Lucy Wanjiku silently picked the
// first row — the wall is to refuse the pick and ask Nur which Lucy).
// ────────────────────────────────────────────────────────────────────────────
function findMember(name, roster) {
  if (!name) return { kind: "none" };
  const want = String(name).trim().toLowerCase();
  if (!want) return { kind: "none" };
  // 1. exact full-name match (case-insensitive). Wins outright — even if a
  // first-name prefix would otherwise be ambiguous ("Lucy Wangare" beats the
  // "Lucy" collision and resolves uniquely).
  for (const m of roster) {
    if (String(m.name || "").toLowerCase() === want) return { kind: "unique", member: m };
  }
  // 2. member's first word matches the single-word search (Violet matches
  // "Violet Otieno"). Single-word search only, so we don't bleed into the
  // mixed-bullet two-word probe case where "Cynthia handle" must NOT match.
  if (!want.includes(" ")) {
    const hits = [];
    for (const m of roster) {
      const first = String(m.name || "").trim().split(/\s+/)[0]?.toLowerCase();
      if (first && first === want) hits.push(m);
    }
    if (hits.length === 1) return { kind: "unique", member: hits[0] };
    if (hits.length > 1) return { kind: "ambiguous", candidates: hits };
  }
  // 3. multi-word search where the member's name STARTS WITH the search
  // (so "Violet Otieno" matches member "Violet Otieno-Smith"). Strict
  // prefix so "Cynthia handle" never wins against member "Cynthia".
  if (want.includes(" ")) {
    const hits = [];
    for (const m of roster) {
      const n = String(m.name || "").toLowerCase();
      if (n.startsWith(want + " ")) hits.push(m);
    }
    if (hits.length === 1) return { kind: "unique", member: hits[0] };
    if (hits.length > 1) return { kind: "ambiguous", candidates: hits };
  }
  return { kind: "none" };
}

// Backward-compatible thin wrapper that returns the member row only on a
// UNIQUE hit. Use this when the caller does NOT want to expose ambiguity to
// the user (e.g. legacy "Nur" fallback, "is this line a member-prefixed
// bullet" boolean probes). Ambiguous and none both collapse to null.
function pickUniqueMember(name, roster) {
  const r = findMember(name, roster);
  return r.kind === "unique" ? r.member : null;
}

// Build a metadata payload describing the ambiguity for downstream callers
// (the route handler surfaces "did you mean X or Y?" to Nur).
function ambiguityMeta(name, candidates) {
  return {
    name: String(name || "").trim(),
    candidates: candidates.map((m) => String(m.name || "")).filter(Boolean),
  };
}

// Filter the roster so the eval / production agree on who's targetable.
// Team-tier senders cannot target Taona (CORRECTIONS §7.1). Inactive members
// are dropped silently. Other roles see the full active roster.
function visibleRoster(roster, senderRole) {
  const active = (roster || []).filter((m) => (m.status || "active") === "active");
  if (senderRole === "team") {
    return active.filter((m) => String(m.name || "").trim().toLowerCase() !== "taona");
  }
  return active;
}

// ────────────────────────────────────────────────────────────────────────────
// TEXT helpers.
// ────────────────────────────────────────────────────────────────────────────
function stripBullet(line) {
  return String(line || "").replace(BULLET_RE, "").trim();
}

function sanitizeTitle(text) {
  let t = String(text || "").trim();
  // v1.3.12: strip Unicode invisibles WhatsApp injects on bulleted lists
  // (word joiner U+2060, ZWSP U+200B, ZWNJ U+200C, ZWJ U+200D, formatting
  // controls U+2068-U+2069). Without this they leak into task titles and
  // ruin dedup, search, and display.
  t = t.replace(/[​-‍⁠⁦-⁩﻿]/g, "").trim();
  // strip leading/trailing quotes and full-stops; collapse internal whitespace
  t = t.replace(/^['"`“”‘’]+|['"`“”‘’]+$/g, "").trim();
  t = t.replace(/\s*[.!?]+\s*$/g, "").trim();
  // strip trailing courtesy phrases (". thanks", ". thx", ". please")
  t = t.replace(/\s*[,.;:]?\s*(?:thanks?(?:\s+you)?|thx|ty|please|pls)\s*[!.?]?\s*[^\w]*$/i, "").trim();
  // collapse runs of whitespace, including bare emojis at the tail
  t = t.replace(/\s+[\p{Emoji_Presentation}\p{Extended_Pictographic}]+\s*$/u, "").trim();
  return t.slice(0, 200);
}

function hasVerbShape(phrase) {
  const p = String(phrase || "").trim().toLowerCase();
  if (!p) return false;
  // acknowledgement prefix → not a task
  for (const ack of ACKNOWLEDGEMENT_PREFIXES) {
    if (p.startsWith(ack + " ") || p === ack) return false;
  }
  // explicit request prefix → task
  for (const pref of REQUEST_PREFIXES) {
    if (p.startsWith(pref + " ") || p === pref) return true;
  }
  // imperative verb at the start
  const firstWord = p.split(/[\s,.!?]+/)[0] || "";
  if (TASK_VERBS.has(firstWord)) return true;
  // first two words of a slightly-conjugated imperative
  // (e.g. "set up", "look into") — already captured because we test the first word
  return false;
}

function startsWithDelete(body) {
  const p = String(body || "").trim().toLowerCase();
  if (!p) return false;
  // pattern matchers below only trigger on @ / assign / remind, so a bare
  // "cancel" survives this check; we use this guard to skip explicitly.
  for (const w of DELETE_PREFIXES) {
    if (p.startsWith(w + " ")) return true;
  }
  return false;
}

// ────────────────────────────────────────────────────────────────────────────
// DUE-DATE extraction. We handle the small set of phrases that show up in
// Nur's actual delegations, never more. Anything past this returns null and
// the model can refine later.
//
// today is an ISO date string the caller passes in (defaults to today via
// Date(NOW), but the eval always passes its own to keep determinism).
// ────────────────────────────────────────────────────────────────────────────
function isoDate(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function parseTodayArg(today) {
  if (typeof today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(today)) return new Date(`${today}T00:00:00Z`);
  return new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
}

function nextMonday(today) {
  // ISO weekday: Mon=1..Sun=7. JS getUTCDay: Sun=0..Sat=6.
  const day = today.getUTCDay(); // 0..6
  const delta = day === 0 ? 1 : (8 - day); // Sun->Mon = 1, Mon->Mon = 7, Tue->Mon = 6...
  const d = new Date(today.getTime() + delta * 86400000);
  return isoDate(d);
}

function nextDayOfMonth(today, dayOfMonth) {
  const t = today;
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth();
  const candidate = new Date(Date.UTC(y, m, dayOfMonth));
  if (candidate.getTime() > t.getTime()) return isoDate(candidate);
  return isoDate(new Date(Date.UTC(y, m + 1, dayOfMonth)));
}

function extractDueAndRecurrence(text, today) {
  const t = String(text || "").toLowerCase();
  let due_on = null;
  let recurrence = "none";

  // recurrence — must come before the once-off phrases because "every X" can
  // overlap with "on the X" otherwise.
  for (const [rule, phrases] of Object.entries(RECURRENCE_KEYWORDS)) {
    for (const p of phrases) {
      if (t.includes(p)) { recurrence = rule; break; }
    }
    if (recurrence !== "none") break;
  }
  // v1.3.4: "every <weekday>" maps to weekly recurrence and seeds due_on to the
  // next occurrence of that weekday. Without this, "remind me every Monday at
  // 10am to review the cash position" was creating a one-off task with no
  // recurrence and no due date.
  const everyWeekday = t.match(/\bevery\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (everyWeekday) {
    recurrence = "weekly";
    const map = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
    const want = map[everyWeekday[1]];
    const day = today.getUTCDay();
    let delta = (want - day + 7) % 7;
    if (delta === 0) delta = 7;
    due_on = isoDate(new Date(today.getTime() + delta * 86400000));
  }

  // "on the Nth (of every month)" → recurring monthly, due_on=next Nth
  const dom = t.match(/on\s+the\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+of\s+(?:every|each)\s+month)?/);
  if (dom) {
    const n = parseInt(dom[1], 10);
    if (n >= 1 && n <= 31) {
      due_on = nextDayOfMonth(today, n);
      if (/of\s+(?:every|each)\s+month/.test(t)) recurrence = "monthly";
    }
  }
  // "next week" → next Monday
  if (/\bnext\s+week\b/.test(t)) due_on = nextMonday(today);
  // "tomorrow"
  if (/\btomorrow\b/.test(t)) { const d = new Date(today.getTime() + 86400000); due_on = isoDate(d); }
  // "next Monday" / "next Friday"
  const weekdayMatch = t.match(/\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (weekdayMatch) {
    const map = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
    const want = map[weekdayMatch[1]];
    const day = today.getUTCDay();
    let delta = (want - day + 7) % 7;
    if (delta === 0) delta = 7;
    due_on = isoDate(new Date(today.getTime() + delta * 86400000));
  }
  // "by Friday" / "this Friday" / "on Friday" → next occurrence of that weekday
  const onWeekday = t.match(/\b(?:on|by|this)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (onWeekday && !due_on) {
    const map = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
    const want = map[onWeekday[1]];
    const day = today.getUTCDay();
    let delta = (want - day + 7) % 7;
    if (delta === 0) delta = 7;
    due_on = isoDate(new Date(today.getTime() + delta * 86400000));
  }
  return { due_on, recurrence };
}

// Self-reminder phrasing strips "to", trailing date phrases, and a few
// "this/next" suffixes so the title ends up describing the action.
function cleanReminderTitle(raw) {
  let t = String(raw || "").trim();
  // Strip a LEADING time-of-day ("at 2PM", "at 2:00 PM", "at 14:00", "by 3 pm") and any "to"
  // that follows it (KT #392): "Remind me at 2PM to contact Snoopy" must title "contact Snoopy",
  // NOT "at 2PM to contact Snoopy" (the live L83→L135 bug). Requires a digit after at/by, so a
  // real title like "at the office, call John" is never touched.
  t = t.replace(/^\s*(?:at|by|around|@)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s+(?:to\s+)?/i, "");
  t = t.replace(/^\s*to\s+/i, "");
  t = t.replace(/\s+(?:next\s+(?:week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|month)|by\s+\w+|on\s+the\s+\d+(?:st|nd|rd|th)?(?:\s+of\s+(?:every|each)\s+month)?|every\s+\w+|tomorrow|this\s+week)\s*[.!?]?\s*$/i, "");
  return sanitizeTitle(t);
}

// ────────────────────────────────────────────────────────────────────────────
// PATTERNS
//
// Each pattern function takes (input, roster, today) and returns an array of
// ParsedTask objects (possibly empty). The dispatcher runs them in priority
// order and returns the first non-empty result.
// ────────────────────────────────────────────────────────────────────────────

// Pattern A: "Assign these tasks to X: - a - b - c"
// v1.3.12: also matches singular variants ("Assign this to X", "Assign this
// task to X") with bullets following on the next line, with or without the
// colon. The 2026-06-10 audit found "Assign this to me\n- meeting with Eliza
// at 2 PM" fell through every pattern and Sasa ghost-confirmed it. The colon
// is now optional when bullets follow, and "this"/"these"/"those" all accept.
// KT #274 (2026-06-15): connector relaxed from "to" to "(?:to|for|on)" so
// "Assign this tasks for me: ..." now matches. The 2026-06-14 17:07 Nur
// incident fell through Pattern A because of the connector word; smart-tools'
// SELF_PRONOUNS catches "for me" downstream but only if the LLM routes the
// call through smart-tools instead of the deterministic parser. Pattern A
// owns the deterministic path; this fix closes it at the regex layer too.
function matchAssignedBulletList(body, roster, today, senderTeamMember) {
  const re = /^assign\s+(?:these|those|this|the)\s+tasks?\s+(?:to|for|on)\s+(\w+(?:\s+\w+)*?)\s*:\s*\n((?:.+\n?)+?)$/im;
  const reLoose = /^assign\s+(?:this|these|those)\s+(?:to|for|on)\s+(\w+(?:\s+\w+)*?)\s*:?\s*\n((?:\s*[-•*]\s+[^\n]+\n?)+?)$/im;
  const m = body.match(re) || body.match(reLoose);
  if (!m) return [];
  const res = findMember(m[1], roster);
  let member = res.kind === "unique" ? res.member : null;
  if (!member && isSelfTarget(m[1]) && senderTeamMember) member = senderTeamMember;
  // KT #275 (2026-06-15): if findMember returned ambiguous (e.g. "Lucy" with
  // two active Lucys on the roster), leave assignee_id null AND attach the
  // ambiguity metadata so the caller can ask "did you mean Lucy Wangare or
  // Lucy Wanjiku?" instead of silently picking the first row.
  const amb = res.kind === "ambiguous" && !member ? ambiguityMeta(m[1], res.candidates) : null;
  const lines = m[2].split(/\n/).map(stripBullet).filter((s) => s.length >= 3);
  const offset = m.index || 0;
  return lines.map((title, i) => ({
    assignee_name: member?.name || m[1].trim(),
    assignee_id: member?.id || null,
    title: sanitizeTitle(title),
    due_on: extractDueAndRecurrence(title, today).due_on,
    recurrence: extractDueAndRecurrence(title, today).recurrence,
    source_pattern: "bullet_item",
    source_offset: offset + i,
    ...(amb ? { _ambiguous_assignee: amb } : {}),
  })).filter((t) => t.title.length >= 5);
}

// Pattern B: mixed-assignee bullet list. The intro line is anything ending
// with ':' and we then look at each bullet: if its FIRST WORD is a team member
// name AND followed by a verb-shape, it becomes a task assigned to that name.
// At least 2 bullets must match before we accept the pattern (one is too easy
// to misfire on a header like "Notes:" with one stray bullet underneath).
function matchMixedBulletList(body, roster, today) {
  const re = /^([^\n]{1,120}):\s*\n((?:\s*[-•*]\s+[^\n]+\n?){2,})/im;
  const m = body.match(re);
  if (!m) return [];
  // skip if the header is the "Assign these tasks to X" shape; pattern A owns it
  if (/^\s*assign\s+(?:these|those)\s+tasks?\s+to/i.test(m[1])) return [];
  const lines = m[2].split(/\n/).map((l) => l.replace(BULLET_RE, "").trim()).filter((s) => s.length >= 3);
  const offset = m.index || 0;
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // first word(s) is/are a team_member name
    const tokens = line.split(/\s+/);
    let nameMatched = null;
    let probeName = "";
    let ambCandidates = null;
    let rest = "";
    // try two-word match first (Violet Otieno), then single-word
    if (tokens.length >= 2) {
      const two = `${tokens[0]} ${tokens[1]}`;
      const mm = findMember(two, roster);
      if (mm.kind === "unique") { nameMatched = mm.member; probeName = two; rest = tokens.slice(2).join(" "); }
      else if (mm.kind === "ambiguous") { ambCandidates = mm.candidates; probeName = two; rest = tokens.slice(2).join(" "); }
    }
    if (!nameMatched && !ambCandidates && tokens.length >= 1) {
      const mm = findMember(tokens[0], roster);
      if (mm.kind === "unique") { nameMatched = mm.member; probeName = tokens[0]; rest = tokens.slice(1).join(" "); }
      else if (mm.kind === "ambiguous") { ambCandidates = mm.candidates; probeName = tokens[0]; rest = tokens.slice(1).join(" "); }
    }
    if (!nameMatched && !ambCandidates) continue;
    if (!hasVerbShape(rest)) continue;
    const dueRec = extractDueAndRecurrence(rest, today);
    out.push({
      assignee_name: nameMatched ? nameMatched.name : probeName,
      assignee_id: nameMatched ? nameMatched.id : null,
      title: sanitizeTitle(rest),
      due_on: dueRec.due_on,
      recurrence: dueRec.recurrence,
      source_pattern: "bullet_item",
      source_offset: offset + i,
      ...(ambCandidates ? { _ambiguous_assignee: ambiguityMeta(probeName, ambCandidates) } : {}),
    });
  }
  // require at least 2 bullets to lock the pattern, else it's noise
  return out.length >= 2 ? out : [];
}

// Pattern C: "Assign this task to X: Y"
// v1.3.12: senderTeamMember falls back when assignee is "me".
function matchImperative(body, roster, today, senderTeamMember) {
  const re = /^assign\s+(?:this|the)\s+task\s+to\s+(\w+(?:\s+\w+)*?)\s*:\s*(.+?)$/im;
  const m = body.match(re);
  if (!m) return [];
  const res = findMember(m[1], roster);
  let member = res.kind === "unique" ? res.member : null;
  if (!member && isSelfTarget(m[1]) && senderTeamMember) member = senderTeamMember;
  const amb = res.kind === "ambiguous" && !member ? ambiguityMeta(m[1], res.candidates) : null;
  const title = sanitizeTitle(m[2]);
  if (title.length < 5) return [];
  const dueRec = extractDueAndRecurrence(m[2], today);
  return [{
    assignee_name: member?.name || m[1].trim(),
    assignee_id: member?.id || null,
    title,
    due_on: dueRec.due_on,
    recurrence: dueRec.recurrence,
    source_pattern: "imperative",
    source_offset: m.index || 0,
    ...(amb ? { _ambiguous_assignee: amb } : {}),
  }];
}

// Pattern D: "Send a reminder on the 5th of every month to upload all bank
// statements". The sender becomes the assignee (Nur in production).
function matchRecurringSelfReminder(body, roster, today, senderTeamMember) {
  const re = /(?:^|\s)send\s+(?:a\s+|me\s+a\s+)?reminder\s+(.+?)\s+to\s+(.+?)(?:[.!?]|$)/i;
  const m = body.match(re);
  if (!m) return [];
  const sched = m[1];
  const titleRaw = m[2];
  const title = sanitizeTitle(titleRaw);
  if (title.length < 5) return [];
  // Recurrence + due_on extracted from the schedule phrase (e.g. "on the 5th
  // of every month") - the title fragment itself is just the action verb.
  const dueRec = extractDueAndRecurrence(sched, today);
  // "me" resolves to the sender. Legacy callers that don't pass the sender
  // fall back to Nur as the founder (preserves old eval-fixture behavior).
  const owner = senderTeamMember || pickUniqueMember("Nur", roster) || roster[0];
  return [{
    assignee_name: owner?.name || "Nur",
    assignee_id: owner?.id || null,
    title,
    due_on: dueRec.due_on,
    recurrence: dueRec.recurrence,
    source_pattern: "reminder_self",
    source_offset: m.index || 0,
  }];
}

// Pattern E: "Remind me to X (next week / on Friday / by Tuesday)"
function matchSelfReminder(body, roster, today, senderTeamMember) {
  const re = /^remind\s+me\s+(?:to\s+)?(.+?)\s*$/im;
  const m = body.match(re);
  if (!m) return [];
  // Avoid double-firing with pattern D ("send me a reminder ...").
  if (/^\s*send\s+(?:a\s+|me\s+a\s+)?reminder/i.test(body)) return [];
  const titleRaw = cleanReminderTitle(m[1]);
  if (titleRaw.length < 5) return [];
  const dueRec = extractDueAndRecurrence(m[1], today);
  // "me" resolves to the sender, with the same legacy fallback as Pattern D.
  const owner = senderTeamMember || pickUniqueMember("Nur", roster) || roster[0];
  return [{
    assignee_name: owner?.name || "Nur",
    assignee_id: owner?.id || null,
    title: titleRaw,
    due_on: dueRec.due_on,
    recurrence: dueRec.recurrence,
    source_pattern: "reminder_self",
    source_offset: m.index || 0,
  }];
}

// Pattern F: "@X verb-phrase" in a DM. The body must start with the @-mention
// (after optional whitespace) so we don't misfire on a quoted "@X" deep in a
// long message — the eval cases all front-load the mention.
function matchAtMentionDm(body, roster, today) {
  const re = /^\s*@(\w+)\s+(.+?)\s*$/im;
  const m = body.match(re);
  if (!m) return [];
  const res = findMember(m[1], roster);
  // 'none' bails. 'ambiguous' produces a task with no assignee_id + ambiguity
  // metadata so the route handler can ask Nur which @-mention she meant.
  if (res.kind === "none") return [];
  const member = res.kind === "unique" ? res.member : null;
  const amb = res.kind === "ambiguous" ? ambiguityMeta(m[1], res.candidates) : null;
  if (!hasVerbShape(m[2])) return [];
  // strip the verb-phrase prefix from the title so the action verb survives
  // ("@Cynthia please pick up the package" → "pick up the package").
  let rest = m[2].trim();
  for (const pref of REQUEST_PREFIXES) {
    const re2 = new RegExp(`^${pref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`, "i");
    if (re2.test(rest)) { rest = rest.replace(re2, ""); break; }
  }
  const title = sanitizeTitle(rest);
  if (title.length < 5) return [];
  const dueRec = extractDueAndRecurrence(rest, today);
  return [{
    assignee_name: member ? member.name : String(m[1]).trim(),
    assignee_id: member ? member.id : null,
    title,
    due_on: dueRec.due_on,
    recurrence: dueRec.recurrence,
    source_pattern: "mention_in_dm",
    source_offset: m.index || 0,
    ...(amb ? { _ambiguous_assignee: amb } : {}),
  }];
}

// Pattern G: self-assigned bullet list. The intro line ends with ":" and the
// bullets are verb-led ("Pay X", "Draft Y") with NO team-member prefix, which
// means Pattern A (assigned-to-X) and Pattern B (mixed-assignee) both pass.
// These are the sender's own todo items. Each bullet becomes a task assigned
// to the sender. Requires at least 2 bullets so a header like "Notes:\n-
// one stray bullet" doesn't misfire.
function matchSelfAssignedBulletList(body, roster, today, senderTeamMember) {
  if (!senderTeamMember) return [];
  const re = /^([^\n]{1,120}):\s*\n((?:\s*[-•*]\s+[^\n]+\n?){2,})/im;
  const m = body.match(re);
  if (!m) return [];
  // skip if Pattern A's preamble shape ("Assign these tasks to X:") would own it
  if (/^\s*assign\s+(?:these|those)\s+tasks?\s+to/i.test(m[1])) return [];
  const lines = m[2].split(/\n/).map((l) => l.replace(BULLET_RE, "").trim()).filter((s) => s.length >= 3);
  const offset = m.index || 0;
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // skip a bullet that starts with a team member name; Pattern B already
    // got a shot at the mixed-assignee shape and returned empty if so.
    // KT #275: ambiguous first-word ("Lucy" hitting two Lucys) ALSO counts
    // as targeting a member — we still skip so this bullet doesn't land on
    // the sender's own board.
    const firstTwo = line.split(/\s+/).slice(0, 2).join(" ");
    const probeTwo = findMember(firstTwo, roster);
    const probeOne = findMember(line.split(/\s+/)[0], roster);
    if (probeTwo.kind !== "none" || probeOne.kind !== "none") continue;
    if (!hasVerbShape(line)) continue;
    const dueRec = extractDueAndRecurrence(line, today);
    out.push({
      assignee_name: senderTeamMember.name,
      assignee_id: senderTeamMember.id,
      title: sanitizeTitle(line),
      due_on: dueRec.due_on,
      recurrence: dueRec.recurrence,
      source_pattern: "bullet_item",
      source_offset: offset + i,
    });
  }
  return out.length >= 2 ? out : [];
}

// Pattern H: "Remind <RosterName> to <action> by <date>". A roster-target
// reminder, distinct from Pattern E ("Remind me to ..."). Added 2026-06-09
// after the harness caught the model interpreting "Remind Wahome to submit the
// donor report by Friday" as message_person (which then fails because the
// 24-hour WhatsApp window is closed). The deterministic parser routes it to
// create_task with assignee = the named roster member.
function matchTeamReminder(body, roster, today) {
  // Anchor to start of line / message. Don't match "remind me" (Pattern E owns
  // that). Require "to" as the splitter so multi-word names ("Wahome Jerry")
  // match greedily, and the action phrase starts cleanly.
  const re = /^remind\s+(?!me\b)([A-Z][A-Za-z .'\-]{1,40})\s+to\s+(.+?)\s*$/im;
  const m = body.match(re);
  if (!m) return [];
  // Greedy match may have grabbed too much (e.g. "Wahome Jerry to submit the
  // donor report" — name="Wahome Jerry"). Walk back token-by-token until we
  // find a roster hit, so single-word names ("Cynthia") still resolve cleanly
  // when the full phrase isn't on the roster.
  const fullName = m[1].trim();
  const tokens = fullName.split(/\s+/);
  let member = null;
  let ambCandidates = null;
  let usedName = fullName;
  for (let n = tokens.length; n >= 1; n--) {
    const candidate = tokens.slice(0, n).join(" ");
    const hit = findMember(candidate, roster);
    if (hit.kind === "unique") { member = hit.member; usedName = candidate; break; }
    if (hit.kind === "ambiguous") { ambCandidates = hit.candidates; usedName = candidate; break; }
  }
  if (!member && !ambCandidates) return [];
  // Whatever the greedy regex picked up as name but isn't part of the resolved
  // member's name belongs to the action phrase.
  const leftover = fullName.slice(usedName.length).trim();
  const rest = (leftover ? leftover + " " : "") + m[2].trim();
  if (rest.length < 3) return [];
  const title = sanitizeTitle(rest);
  if (title.length < 5) return [];
  const dueRec = extractDueAndRecurrence(rest, today);
  const amb = ambCandidates ? ambiguityMeta(usedName, ambCandidates) : null;
  return [{
    assignee_name: member ? member.name : usedName,
    assignee_id: member ? member.id : null,
    title,
    due_on: dueRec.due_on,
    recurrence: dueRec.recurrence,
    source_pattern: "remind_team_member",
    source_offset: m.index || 0,
    ...(amb ? { _ambiguous_assignee: amb } : {}),
  }];
}

// ────────────────────────────────────────────────────────────────────────────
// DISPATCHER
// ────────────────────────────────────────────────────────────────────────────
export function parseTasks(input) {
  const body = String(input?.body || "");
  const team_members = Array.isArray(input?.team_members) ? input.team_members : [];
  const senderRole = defaultSenderRole(input?.sender_role);
  const today = parseTodayArg(input?.today);
  const roster = visibleRoster(team_members, senderRole);
  // Sender's own team_members row. Self-reminder and self-assigned bullet
  // patterns route "remind me" / "my todo" to THIS member, not to a hardcoded
  // default. The worker resolves it from sender_contact_id; the eval may pass
  // it directly. Falls back to Nur for legacy callers that never resolved it.
  const senderTeamMember = input?.sender_team_member
    || pickUniqueMember(input?.sender_team_member_name, roster)
    || null;

  const empty = { tasks: [], context_note: "", raw_body_unchanged: body };

  if (!body || body.trim().length < 3) return empty;

  // Delete-shape blocker: a body that opens with "cancel/delete/remove" and
  // contains no @-mention shouldn't fire any of the create patterns. The eval
  // exercises this with "Cancel the calls with Edith".
  if (startsWithDelete(body) && !/^\s*@/m.test(body)) return empty;

  // Run patterns in priority order. First non-empty wins.
  const dispatchers = [
    (b, r, t) => matchAssignedBulletList(b, r, t, senderTeamMember),      // A
    matchMixedBulletList,                                                 // B
    (b, r, t) => matchImperative(b, r, t, senderTeamMember),              // C
    (b, r, t) => matchRecurringSelfReminder(b, r, t, senderTeamMember),   // D
    (b, r, t) => matchSelfReminder(b, r, t, senderTeamMember),            // E
    matchAtMentionDm,                                                     // F
    (b, r, t) => matchSelfAssignedBulletList(b, r, t, senderTeamMember),  // G
    matchTeamReminder,                                                    // H
  ];

  for (const fn of dispatchers) {
    const tasks = fn(body, roster, today);
    if (tasks && tasks.length > 0) {
      const valid = tasks.filter((t) => t.title && t.title.length >= 5);
      if (valid.length === 0) continue;
      const context_note = describeForContextNote(valid);
      return { tasks: valid, context_note, raw_body_unchanged: body };
    }
  }

  return empty;
}

function describeForContextNote(tasks) {
  if (tasks.length === 0) return "";
  if (tasks.length === 1) {
    const t = tasks[0];
    const due = t.due_on ? ` due ${t.due_on}` : "";
    const rec = t.recurrence && t.recurrence !== "none" ? ` (${t.recurrence})` : "";
    return `parsed_task: "${t.title}" for ${t.assignee_name}${due}${rec}`;
  }
  const owner = tasks.every((t) => t.assignee_name === tasks[0].assignee_name) ? `for ${tasks[0].assignee_name}` : "split by assignee";
  return `parsed_tasks (${tasks.length}) ${owner}: ${tasks.map((t) => `"${t.title}"`).join(", ")}`;
}

// Default export for ergonomic import sugar; some consumers prefer it.
export default parseTasks;
