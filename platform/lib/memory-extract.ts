// SALIENCE AUTO-CAPTURE (the memorae-class "it just remembers" win, doctrine-safe).
//
// The curation philosophy (lib/CLAUDE.md, brain rules) is sacred: the curated
// brain (kind org_fact) must NEVER be polluted by a model guess. So this does NOT
// write org_facts. It writes to a SEPARATE, lower-trust lane (kind "auto_fact")
// that recall() surfaces ONLY when query-relevant, never in the always-on org
// grounding. The curated facts always win their guaranteed slot; auto-facts just
// give Sasa a longer memory for the rest. Reversible by construction: a bad
// auto-fact is one query-arm row, not a corrupted org truth.
//
// It also honors the PRIVACY WALL: a durable fact overheard on the OWNER's (Taona's)
// line is stored owner-private, so auto-capture can never leak Taona's content to
// Nur (which is exactly what a naive "remember everything to the shared brain"
// would do). Founder/Nur facts land in the shared auto_fact lane.
//
// Best-effort and OFF the reply path: the caller fires this AFTER the user already
// got their answer, wrapped so a failure never touches the turn.
import { claude, HAIKU } from "./anthropic";
import { rememberUpsert } from "./memory";
import { OWNER_PRIVATE_KIND } from "./privacy";
import { emit } from "./events";

type Extracted = { topic: string; fact: string };

const SYSTEM = `You are the memory of an operations assistant for a nonprofit. Read ONE message from an operator and the assistant's reply, and extract only DURABLE facts worth remembering for FUTURE conversations.

A durable fact is a stable truth about the organisation, its people, accounts, policies, vendors, schedules, decisions, or the operator's stated preferences. Examples: "the venue moved to Youngsfield", "Mary left the team", "we bank with FNB", "Nur prefers updates in the morning", "the board meets monthly".

DO NOT capture: one-off tasks or to-dos (those are tracked elsewhere), payments or money amounts, anything time-bound for today only, questions, greetings, chit-chat, or anything you are unsure is durable. When in doubt, leave it out. Most messages contain NOTHING to remember, and returning none is the correct, common answer.

Return STRICT JSON: {"facts":[{"topic":"<2-4 word label>","fact":"<one clear sentence, no dashes>"}]}. At most 3. If nothing qualifies, return {"facts":[]}.`;

// Tolerant parse: Haiku sometimes appends a sentence after the JSON (which a
// strict JSON.parse rejects, silently dropping a real fact). Grab the first
// balanced {...} that contains a facts array, so a valid extraction is never lost
// to a stray trailing line. Returns [] on anything genuinely unparseable.
function parseFacts(raw: string): Extracted[] {
  const cleaned = (raw || "").replace(/```json|```/gi, "").trim();
  const tryParse = (s: string): Extracted[] | null => {
    try { const o = JSON.parse(s); return Array.isArray(o?.facts) ? o.facts : null; } catch { return null; }
  };
  let facts = tryParse(cleaned);
  if (!facts) {
    const m = cleaned.match(/\{[\s\S]*"facts"[\s\S]*\}/);
    if (m) facts = tryParse(m[0]);
  }
  return facts || [];
}

// Pull durable facts from one exchange. Returns [] on anything uncertain or on
// any failure. Uses Haiku (cheap) since this runs on every operator turn.
export async function extractDurableFacts(command: string, reply: string): Promise<Extracted[]> {
  const c = (command || "").trim();
  // Cheap guards: skip confirmations and trivially short turns before spending a call.
  if (c.length < 12) return [];
  if (/^(y|yes|yep|yeah|ok(ay)?|no|nope|thanks?|thank you|cool|great|got it|sawa|ndio|hapana)\b[.! ]*$/i.test(c)) return [];
  try {
    const raw = await claude(`${SYSTEM}\n\nRespond with ONLY the JSON object.`, `OPERATOR: ${c}\n\nASSISTANT: ${(reply || "").trim().slice(0, 600)}`, 400, HAIKU);
    const facts = parseFacts(raw).filter((f) => f && typeof f.fact === "string" && f.fact.trim().length > 4).slice(0, 3);
    return facts.map((f) => ({ topic: String(f.topic || "").trim().slice(0, 40), fact: String(f.fact).trim().slice(0, 300) }));
  } catch {
    return [];
  }
}

// Extract + write. Founder facts -> shared "auto_fact"; owner facts -> owner-private
// (wall). Upsert-by-slug dedupes a repeated topic in place. Never throws.
export async function autoCapture(opts: {
  command: string;
  reply: string;
  rank?: "owner" | "founder" | "member" | null;
  operatorName?: string;
  sourceMessageId?: string | null;
  toolsRan?: string[];
}): Promise<{ captured: number; skipped?: string }> {
  // BRAIN-DEDUPE GUARD (2026-06-09). When the operator explicitly used
  // `remember_fact` this turn, the explicit lane already wrote a curated row
  // with a `chat:*` slug. autoCapture's `auto:*` slug never collides with that,
  // so without this guard two near-identical rows land per turn. The explicit
  // lane is canonical; skip auto-capture entirely when it ran successfully.
  if (Array.isArray(opts.toolsRan) && opts.toolsRan.includes("remember_fact")) {
    return { captured: 0, skipped: "remember_fact_ran" };
  }
  try {
    const facts = await extractDurableFacts(opts.command, opts.reply);
    if (!facts.length) return { captured: 0 };
    const owner = opts.rank === "owner";
    const kind = owner ? OWNER_PRIVATE_KIND : "auto_fact";
    let captured = 0;
    for (const f of facts) {
      const base = (f.topic || f.fact).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
      const slug = `${owner ? "owner:auto" : "auto"}:${base}`;
      const id = await rememberUpsert({
        kind,
        title: f.topic || null,
        content: f.fact,
        source_type: "auto",
        slug,
        metadata: { provenance: "auto", source_message_id: opts.sourceMessageId || null, by: opts.operatorName || null },
      });
      if (id) captured++;
    }
    if (captured) {
      await emit({
        type: "brain.auto_captured", source: "agent:sasa", actor: opts.operatorName || "Sasa",
        subject_type: "memory", subject_id: null,
        payload: { count: captured, private: owner, topics: facts.map((f) => f.topic).filter(Boolean) },
      });
    }
    return { captured };
  } catch {
    return { captured: 0 };
  }
}
