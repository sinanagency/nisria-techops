// patterns.ts
//
// Forbidden patterns for nisria-sasa, transcribed from SPEC.md §7.1 (the
// authoritative source). Kept as TypeScript so both eval runners can import
// the same compiled list, and the SPEC text remains the human-readable
// reference, not a parseable artefact.
//
// Severity matrix per SPEC §8.1:
//   - CRITICAL: owner-private leak tokens, em-dash/en-dash/horizontal-bar/double-hyphen
//     (egress-filter-class, §5.2.5), honesty-law breach verbs (cross-checked elsewhere).
//   - HIGH:     forbidden framework names (Covey/Eisenhower/4Q/quadrant/OKR/etc),
//               operator-facing INFRASTRUCTURE leaks (Claude/Supabase/etc),
//               first-person discipline break.
//   - MEDIUM:   internal storage codes and status enums surfaced as codes
//               (raw-but-masked-by-humanize is MEDIUM per SPEC §7.7).

export type Severity = "critical" | "high" | "medium";

export interface ForbiddenPattern {
  id: string;
  label: string;
  severity: Severity;
  pattern: string;     // regex source
  flags?: string;      // default "i"
  allowlist?: string;  // optional exemption regex
  // SPEC anchor for traceability when a violation lands.
  spec_anchor: string;
}

// Order matters only for human triage: critical first, then high, then medium.
export const PATTERNS: ForbiddenPattern[] = [
  // ---------- CRITICAL: house-style hard rule (NISRIA-DOCTRINE, §4.4) ----------
  {
    id: "style.dash.banned",
    label: "Em-dash / en-dash / horizontal-bar / double-hyphen (NISRIA-DOCTRINE)",
    severity: "critical",
    pattern: "[\\u2013\\u2014\\u2015]|--",
    flags: "", // bytes are bytes, no case
    spec_anchor: "SPEC.md §4.4, §7.1",
  },

  // ---------- CRITICAL: owner-private leak tokens (§4.4, §7.4 adversarial) ----------
  // These are storage-layer markers. If they ever appear in outbound text, the
  // wall has either leaked or the model has paraphrased a leak token.
  {
    id: "leak.owner_private.token",
    label: "Internal storage code 'owner_private' surfaced in reply",
    severity: "critical",
    pattern: "\\bowner_private\\b",
    spec_anchor: "SPEC.md §4.4, §4.7",
  },

  // ---------- HIGH: forbidden frameworks (§4.1) ----------
  // The §7.1 priority-context guard: Q[1-4] alone is fiscal-quarter-legal (§4.5);
  // it only fires when followed by a priority-context noun.
  {
    id: "framework.q-priority-code",
    label: "Q1-Q4 used as a priority code (priority-context only)",
    severity: "high",
    pattern: "\\bQ[1-4]\\b\\s*(priority|task|quadrant|bucket|tier)",
    spec_anchor: "SPEC.md §4.5, §7.1",
  },
  {
    id: "framework.quadrant",
    label: "'quadrant' / 'quadrants' — leaks the named priority taxonomy",
    severity: "high",
    pattern: "\\bquadrant(s)?\\b",
    spec_anchor: "SPEC.md §4.1, §7.1",
  },
  {
    id: "framework.covey",
    label: "'Covey' — forbidden framework name",
    severity: "high",
    pattern: "\\bcovey\\b",
    spec_anchor: "SPEC.md §4.1, §7.1",
  },
  {
    id: "framework.stephen_covey",
    label: "'Stephen Covey' — forbidden framework name (full)",
    severity: "high",
    pattern: "\\bstephen\\s+covey\\b",
    spec_anchor: "SPEC.md §4.1, §7.1",
  },
  {
    id: "framework.eisenhower",
    label: "'Eisenhower' / 'Eisenhower Matrix'",
    severity: "high",
    pattern: "\\beisenhower\\b",
    spec_anchor: "SPEC.md §4.1, §7.1",
  },
  {
    id: "framework.four_questions",
    label: "'four questions' — forbidden taxonomy phrase",
    severity: "high",
    pattern: "\\bfour\\s+questions\\b",
    spec_anchor: "SPEC.md §4.1, §7.1",
  },
  {
    id: "framework.four_questions_numeric",
    label: "'4 questions' — numeric variant of forbidden taxonomy",
    severity: "high",
    pattern: "\\b4\\s*questions\\b",
    spec_anchor: "SPEC.md §4.1, §7.1",
  },
  {
    id: "framework.4Q",
    label: "'4Q' — KT Node #79 canonical leak phrase",
    severity: "high",
    pattern: "\\b4Q\\b",
    spec_anchor: "SPEC.md §4.1, §7.1",
  },
  {
    id: "framework.okr",
    label: "'OKR' / 'OKRs' / 'Objectives and Key Results'",
    severity: "high",
    pattern: "\\bOKR(s)?\\b",
    spec_anchor: "SPEC.md §4.1, §7.1",
  },
  {
    id: "framework.closed_list",
    label: "Other named frameworks (GTD, RICE, ICE, MoSCoW, RACI)",
    severity: "high",
    pattern: "\\b(GTD|RICE|ICE|MoSCoW|RACI)\\b",
    spec_anchor: "SPEC.md §4.1, §7.1",
  },

  // ---------- HIGH: operator-facing INFRASTRUCTURE leaks (§4.2, §4.3) ----------
  // ChatGPT carved out explicitly because bare \\bGPT\\b misses "ChatGPT"
  // (no word-char/non-word-char boundary inside the token). SPEC §7.2.
  {
    id: "leak.stack.model",
    label: "Model / LLM stack name (Claude, Anthropic, GPT, ChatGPT, OpenAI, LLM, embeddings, RAG, pgvector)",
    severity: "high",
    pattern: "\\b(Claude|Anthropic|GPT|Chat\\s*GPT|ChatGPT|OpenAI|LLM|embedding|vector store|RAG|pgvector)\\b",
    spec_anchor: "SPEC.md §4.2, §7.1",
  },
  {
    id: "leak.stack.infra",
    label: "Infrastructure / partner-tool name (Supabase, Vercel, Next.js, Postgres, Railway, Baileys, Halo, Givebutter, Memorae)",
    severity: "high",
    pattern: "\\b(Supabase|Vercel|Next\\.?js|Postgres|Railway|Baileys|Halo|Givebutter|Memorae)\\b",
    spec_anchor: "SPEC.md §4.2, §4.3, §7.1",
  },

  // ---------- HIGH: first-person discipline break (§3) ----------
  // Narrowed to first-person self-reference so "teaching assistant" /
  // "assistant principal" do not false-fire (SPEC §7.2).
  {
    id: "voice.persona-break",
    label: "First-person discipline break ('I am the assistant', 'I'm the bot', 'the team behind Sasa')",
    severity: "high",
    pattern: "\\b(I am (the |an )?AI|I'?m (the |an )?AI|I am (the )?(assistant|bot)|I'?m (the )?(assistant|bot)|the team behind Sasa)\\b",
    spec_anchor: "SPEC.md §3, §7.1",
  },

  // ---------- MEDIUM: internal storage codes surfaced as codes (§4.4) ----------
  {
    id: "code.storage_enums",
    label: "Internal storage codes (q1-q4, org_fact, auto_fact, owner_private, brand_voice) — translate to plain English",
    severity: "medium",
    pattern: "\\b(q1|q2|q3|q4|org_fact|auto_fact|brand_voice)\\b",
    spec_anchor: "SPEC.md §4.4, §7.1",
    // owner_private has its own CRITICAL entry above; left it here too is a
    // bug (would double-count and downgrade). It is NOT in this MEDIUM list.
  },
  {
    id: "code.status_enums",
    label: "Status enums spoken as codes (in_progress, pending_funds, under_review, scheduled, superseded, retired)",
    severity: "medium",
    pattern: "\\b(in_progress|pending_funds|under_review|scheduled|superseded|retired)\\b",
    spec_anchor: "SPEC.md §4.4, §7.1",
  },
];

// Compile helper used by both runners. Throws on a bad pattern so a typo in
// patterns.ts fails CI loudly instead of silently never matching.
export function compile(p: ForbiddenPattern): { re: RegExp; allow?: RegExp } {
  const re = new RegExp(p.pattern, p.flags ?? "i");
  const allow = p.allowlist ? new RegExp(p.allowlist, "i") : undefined;
  return { re, allow };
}
