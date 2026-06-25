# DETERMINISTIC MESH — FINAL ROUTING & ARCHITECTURE

## EXACT ROUTING FLOW

```
WhatsApp Message In
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  DETERMINISTIC PRE-PROCESSING (existing, unchanged)         │
│                                                             │
│  1. Meeting link detected? → dispatchMeetingBot → REPLY     │
│  2. Cancel intent? → cancelActiveBot → REPLY                │
│  3. Maintenance mode? → canned reply → REPLY                │
│  4. Media attachment? → extract text (unpdf/OCR/Whisper)    │
│                                                             │
│  All deterministic. No LLM. Bypasses Sasa brain entirely.   │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  DOMAIN ROUTER (NEW — lib/agents/router.ts)                 │
│                                                             │
│  Stage 1: Rule-based classification                         │
│  - Score message against regex patterns per domain          │
│  - Patterns derived from 1,755 real transcripts             │
│  - Confidence = pattern match strength                      │
│                                                             │
│  Stage 2: Haiku fallback (if confidence < 0.8)              │
│  - Send to Haiku with domain definitions                    │
│  - Haiku returns {domain, confidence, reason}               │
│  - If Haiku agrees with rules → use that                    │
│  - If Haiku disagrees but high confidence → trust Haiku     │
│  - Otherwise → rule-based with lower confidence             │
│                                                             │
│  Stage 3: Multi-domain decomposition (if confidence < 0.7)  │
│  - Haiku splits message into per-domain steps               │
│  - Each step routed independently                           │
│                                                             │
│  TELEMETRY: Every classification emits router.classified    │
│  event for observability (domain, confidence, reason).      │
│                                                             │
│  Output: {domain, confidence, steps?}                       │
└─────────────────────────────────────────────────────────────┘
        │
        ├── High confidence (>0.8) → Single domain
        ├── Medium confidence (0.6-0.8) → Haiku verify
        ── Low confidence (<0.6) → Multi-domain or General
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  INTAKE PIPELINE (NEW — lib/agents/intake-pipeline.ts)      │
│  (Only for media messages)                                  │
│                                                             │
│  1. Extracted text available?                               │
│  2. Haiku classifies extracted text into domain             │
│  3. Build routed command with domain hint                   │
│  4. Route to appropriate specialist                         │
│                                                             │
│  Example: Invoice PDF → extract → "payment/finance" → Money │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  SPECIALIST DELEGATION (NEW — lib/agents/specialists/)      │
│                                                             │
│  For each step (single or multi-domain):                    │
│  1. Load specialist prompt (focused, ~150 lines)            │
│  2. Load tool subset (13-20 tools, not 110)                 │
│  3. Load domain-specific memory context                     │
│  4. Run through runSasa with filtered tools                 │
│  5. Capture reply + tool calls                              │
│                                                             │
│  If specialist fails → fallback to monolith for that step   │
─────────────────────────────────────────────────────────────┘
        │
        ├── Single step → return specialist reply
        ── Multi-step → synthesize replies
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  SYNTHESIS (multi-step only)                                │
│                                                             │
│  Haiku combines step results into ONE first-person reply    │
│  - 1-4 sentences max                                        │
│  - Never claims success if step failed                      │
│  - No em-dashes (brand rule)                                │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  GUARD (existing + enhanced)                                │
│                                                             │
│  EXISTING (sasa.ts finalize()):                             │
│  1. Honesty check — fake completion claims                  │
│  2. Send verification — KT #287, #313                       │
│  3. Staging verification — payment confirmations            │
│  4. Plural mismatch — "both done" when only one             │
│  5. Singular edit — "task is now set to X" without tool     │
│  6. Deferred promise — "I'll do X when Y happens"           │
│  7. Multi-payment backstop — parse missed payments          │
│                                                             │
│  ENHANCED (orchestrator.ts finalizeWithGuard):              │
│  8. Cross-domain leakage — tool belongs to different domain │
│  9. Capability check — reply matches specialist's scope     │
│                                                             │
│  All guards are DETERMINISTIC. No LLM. Pure regex/logic.    │
│                                                             │
│  TELEMETRY: Leakage events emit sasa.domain_leakage for     │
│  observability.                                             │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
   Final Reply to User
```

---

## DOMAIN STRUCTURE

| Domain | Tools | Model | % Usage | Primary Actions |
|--------|-------|-------|---------|-----------------|
| **Work** | 19 | Haiku | 49% | create_task, complete_task, query_calendar |
| **Comms** | 13 | Sonnet | 20% | message_person, post_to_group, draft_email |
| **Money** | 15 | Sonnet | 17% | record_payment, query_donations, finance_summary |
| **People** | 20 | Sonnet | 12% | lookup_contact, add_beneficiary, team_detail |
| **Knowledge** | 13 | Haiku | 8% | search_documents, remember_fact, list_grants |
| **General** | 5 | Haiku | fallback | lookup_contact, search_history, flag_for_clarity |

**Total: 85 unique tools** (vs original 110)

**Removed:** ~20 portal-only tools (not used via WhatsApp)
**Merged:** ~5 redundant tools (query_memory → list_learned + search_history)

---

## BRAIN-CORE STUDY — DOES IT NEED DOMAIN SEPARATION?

**Verdict: No.**

Brain-core (`~/Code/brain-core/`) is a **shared library** used by multiple bots (Sasa, Jensen, CTH, etc.). It provides domain-agnostic machinery:

### What brain-core does:
- **Honesty guards** — pure functions that detect fake completions, fake sends, hedges
- **Tool registry** — contract for tool primitives across bots
- **Send chokepoint** — unified outbound with audit logging
- **Intent detection** — regex classifiers for ambiguous references, capability questions
- **Schema guard** — detects database schema drift
- **Webhook guard** — dedup + media buffering

### What brain-core does NOT do (and shouldn't):
- Domain routing (that's the Adapter's job)
- Tool implementations (Adapters wire their own DB calls)
- Persona/prompt text (Adapters bring their own)

### Architecture:
```
─────────────────────────────────────────────────────────────┐
│  BRAIN-CORE (shared library)                                │
│  - Honesty guard factories                                  │
│  - Tool registry contract                                   │
│  - Send chokepoint                                          │
│  - Intent detection                                         │
│  - Schema/webhook guards                                    │
│                                                             │
│  Domain-agnostic. No tenant-specific logic.                 │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│  ADAPTER LAYER (per-bot, e.g., Nisria's lib/agents/)        │
│  - Domain router (NEW)                                      │
│  - Specialist prompts (NEW)                                 │
│  - Tool manifests (NEW)                                     │
│  - Tool implementations (existing smart-tools.ts)           │
│  - Persona/prompt text (existing sasa.ts buildSystem)       │
│                                                             │
│  This is where domain separation lives.                     │
└─────────────────────────────────────────────────────────────┘
```

**Conclusion:** Brain-core is correctly architected. The domain separation we built is the **Adapter layer** that sits on top of brain-core's machinery. No changes needed to brain-core.

---

## TOOL ROBUSTNESS — WHAT'S MISSING?

### Current Strengths:
1. **Tool grounding** — Every action must reference a real tool result
2. **Staging gates** — High-stakes actions require confirmation
3. **PII walls** — Explicit data access rules per tier
4. **Honesty rules** — Send verification, completion checks
5. **Domain boundaries** — Specialists cannot call tools outside their domain

### Potential Gaps to Consider:

1. **Tool result validation** — Currently trust tool results. Should we validate returned data matches expected schema?

2. **Rate limiting per domain** — Money operations could have stricter rate limits than Work operations.

3. **Audit trail per domain** — Should each domain log its own audit events for compliance?

4. **Tool dependency graph** — Some tools depend on others (e.g., `record_payment` needs `lookup_donor` first). Should we enforce ordering?

5. **Retry logic per tool** — Currently no retry on tool failure. Should critical tools (record_payment, message_person) have retry logic?

6. **Tool timeout** — No timeout on tool execution. Should tools have max execution time?

7. **Concurrent tool calls** — Currently sequential. Should some tools be parallelizable (e.g., multiple reads)?

8. **Tool versioning** — If tool behavior changes, how do we handle backward compatibility?

---

## DEPLOYMENT STATUS

✅ **Built and saved** (not deployed)
✅ **TypeScript compiles clean** (new files only)
✅ **Unit tests written** (require `npm run build` first)
✅ **Router telemetry added**
✅ **Guard leakage detection added**
✅ **Brain-core studied** (no changes needed)

**To deploy:**
1. Review files in `~/Code/nisria-sr/platform/lib/agents/`
2. Run `npm run build` to compile
3. Run unit tests: `node eval/unit/*.test.mjs`
4. Set `SASA_MESH=on` in Vercel env
5. Monitor canary for 48 hours
6. Rollback: set `SASA_MESH=off`

---

## QUESTIONS FOR FINAL APPROVAL

1. **Tool robustness gaps** — Should we address any of the 8 potential gaps before deployment, or deploy first and iterate?

2. **Test execution** — Do you want to run the tests now (requires `npm run build`), or trust the code review and deploy?

3. **Brain-core** — Agreed no changes needed. Correct?

4. **Deploy timing** — Ready to deploy when you say "deploy". Any concerns before then?
