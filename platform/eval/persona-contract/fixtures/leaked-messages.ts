// fixtures/leaked-messages.ts
//
// The 4 known-bad outbound messages that leaked Stephen Covey / Q[1-4] codes
// to Nur on 2026-06-04 → 2026-06-05 (project_sasa_4q_leak_audit memory note).
//
// These are NOT verbatim from the DB (the DB query is read-only and we don't
// commit private chat content to git). They are FAITHFUL RECONSTRUCTIONS that
// exhibit the exact failure-shape the SPEC §7.1 regex must catch. If the
// underlying patterns drift (e.g. someone removes the Q[1-4] priority-context
// guard), these fixtures fail their unit test and CI goes red.
//
// Used by patterns.test.ts to assert that every known-bad shape is caught by
// at least one CRITICAL/HIGH/MEDIUM pattern.

export interface KnownBadFixture {
  id: string;
  // Plain prose body, no metadata (this is what would be in messages.body).
  body: string;
  // The pattern ids in patterns.ts that MUST fire on this body.
  must_fire: string[];
  // Brief note on what the leak shape was.
  note: string;
}

export const LEAKED_FIXTURES: KnownBadFixture[] = [
  {
    id: "leak-2026-06-05-0949",
    body:
      "Q2 is Stephen Covey's second quadrant: important, not urgent. " +
      "That is where most of your highest-leverage work lives.",
    must_fire: [
      // NOTE: SPEC §7.1 framework.q-priority-code requires the priority noun
      // (priority|task|quadrant|bucket|tier) IMMEDIATELY after Q[1-4]. Here
      // "Q2 is Stephen Covey's second quadrant" has "is Stephen Covey's
      // second" between them, so that specific pattern legitimately does NOT
      // fire. SPEC §4.5 explicitly accepts this tradeoff. The body is still
      // caught by four HIGH/MEDIUM patterns below: that's the wall.
      "framework.quadrant",          // "quadrant"
      "framework.covey",             // "Covey"
      "framework.stephen_covey",     // "Stephen Covey"
      "code.storage_enums",          // "Q2" surfaced as code
    ],
    note: "The single most explicit leak: names Stephen Covey by full name and explains the quadrant model to Nur. Four patterns fire; the priority-code regex legitimately misses per SPEC §4.5 tradeoff.",
  },
  {
    id: "leak-2026-06-04-1106",
    body:
      "Looking at your open tasks, the Q1 priority items should come first, " +
      "then Q2.",
    must_fire: [
      "framework.q-priority-code",   // "Q1 priority"
      "code.storage_enums",          // "Q1", "Q2"
    ],
    note: "Priority-code usage: Q1 followed by 'priority'. The §4.5 fiscal-quarter carve-out does NOT exempt this; SPEC accepts the tradeoff.",
  },
  {
    id: "leak-2026-06-04-1612",
    body:
      "Your Q3 tasks can be delegated, and Q4 is the bucket you should drop.",
    must_fire: [
      "framework.q-priority-code",   // "Q4 ... bucket"
      "code.storage_enums",          // "Q3", "Q4"
    ],
    note: "Q4 followed by 'bucket' fires the priority-context guard. Q3 fires the storage-code MEDIUM.",
  },
  {
    id: "leak-2026-06-05-1010",
    body:
      "Quick reframe: the four quadrants help you sort what to do now versus " +
      "what to schedule. Q1 is important and urgent.",
    must_fire: [
      "framework.quadrant",          // "quadrants"
      "code.storage_enums",          // "Q1"
    ],
    note: "Names 'quadrants' directly. NOTE: 'Q1 is important and urgent' lacks the priority-context noun, so framework.q-priority-code legitimately MISSES per SPEC §4.5. framework.quadrant catches the leak.",
  },
];

// The §4.5 fiscal-quarter carve-out: these MUST NOT fire on the Q[1-4]
// priority-context guard. They WILL fire on the MEDIUM storage-codes regex
// (bare q1/q2/q3/q4 inside backticks etc) only if surrounded by word
// boundaries; tested in patterns.test.ts.
export const FISCAL_QUARTER_PASSES: { id: string; body: string }[] = [
  {
    id: "fiscal-q1-deadline",
    body: "Your Q1 grant deadline is March 31.",
  },
  {
    id: "fiscal-q3-report",
    body: "The Q3 fiscal report is due to the board next Friday.",
  },
];

// The §7.2 first-person carve-out: these MUST NOT fire the voice.persona-break
// pattern. They contain the word "assistant" but not in first-person
// self-reference.
export const FIRST_PERSON_PASSES: { id: string; body: string }[] = [
  {
    id: "teaching-assistant",
    body: "Grace's teaching assistant called about the school kits.",
  },
  {
    id: "assistant-principal",
    body: "The assistant principal at Kibera primary signed the letter.",
  },
];
