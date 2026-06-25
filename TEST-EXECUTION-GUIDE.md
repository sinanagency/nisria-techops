# DETERMINISTIC MESH — TEST EXECUTION GUIDE

## PREREQUISITE

The new modules are written in TypeScript (`.ts`). To run the unit tests, the project must be built first:

```bash
cd ~/Code/nisria-sr/platform
npm run build
```

This compiles `.ts` → `.js` in the `.next/` directory. The tests import from `../../lib/agents/router.js` which resolves to the compiled output.

## ALTERNATIVE: SOURCE-TEXT TESTS

If you don't want to build, the integration tests use a different pattern: they read the TypeScript source as text and check for patterns. This is slower but doesn't require compilation.

Example: `eval/integration/seam-10-brain-core-drift.test.mjs`

## TEST FILES

| File | What it tests | Requires build |
|------|---------------|----------------|
| `eval/unit/router.test.mjs` | Router accuracy, manifest integrity, guard leakage | Yes |
| `eval/unit/specialist-isolation.test.mjs` | Tool boundaries, PII walls, domain separation | Yes |
| `eval/unit/multi-domain-replay.test.mjs` | Multi-domain decomposition, media routing | Yes |

## RUNNING TESTS

```bash
# After build:
node eval/unit/router.test.mjs
node eval/unit/specialist-isolation.test.mjs
node eval/unit/multi-domain-replay.test.mjs

# Or run all:
for f in eval/unit/*.test.mjs; do node "$f"; done
```

## EXPECTED OUTPUT

All tests should print `WALL GREEN.` at the end. Any `FAIL:` lines indicate issues.

## BRAIN-CORE STUDY

Brain-core (`~/Code/brain-core/`) is a **shared library** used by multiple bots (Sasa, Jensen, CTH, etc.). It provides:

- **Honesty guards** — pure functions that detect fake completions, fake sends, etc.
- **Tool registry** — contract for tool primitives across bots
- **Send chokepoint** — unified outbound with audit logging
- **Intent detection** — regex classifiers for ambiguous references, capability questions, hedges
- **Schema guard** — detects database schema drift
- **Webhook guard** — dedup + media buffering

**Does it need domain separation?** No. Brain-core is **domain-agnostic** — it provides machinery, not tenant-specific logic. The domain separation happens at the **Adapter layer** (each bot's `lib/agents/` directory).

**What brain-core does well:**
- Honesty guards are factories — each Adapter wires its own regex/tool maps
- Tool registry is a contract — Adapters pick which tools to expose
- Send chokepoint is universal — every bot's outbound goes through it

**What brain-core doesn't do (and shouldn't):**
- Domain routing (that's the Adapter's job)
- Tool implementations (Adapters wire their own DB calls)
- Persona/prompt text (Adapters bring their own)

**Verdict:** Brain-core is correctly architected. No changes needed. The domain separation we built (router + manifests + specialists) is the **Adapter layer** that sits on top of brain-core's machinery.
