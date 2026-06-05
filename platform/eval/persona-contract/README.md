# nisria-sasa — negative-eval suite

Phase-0 governance deliverable per
[`/Users/milaaj/Code/bots/_governance/NEG-EVAL-TEMPLATE.md`](../../_governance/NEG-EVAL-TEMPLATE.md).
Two surfaces, both gated:

| Surface | File | Surface scanned | When it runs |
|---|---|---|---|
| **Runtime** | `persona-contract.eval.ts` | Last 30 days of outbound `messages` from Supabase | Nightly + pre-deploy |
| **Static**  | `tool-schema-audit.eval.ts` | `platform/lib/smart-tools.ts` + `platform/lib/brain.ts` enum values, descriptions, param names | Every PR + pre-commit |
| **Patterns invariant** | `patterns.test.ts` | The 4 known-bad leaked messages (fixtures) + documented carve-outs | Every PR |

The patterns themselves live in [`patterns.ts`](./patterns.ts), transcribed from
[`SPEC.md` §7.1](../SPEC.md). The SPEC is the human-readable source of truth;
`patterns.ts` is the machine-readable mirror.

---

## Why two surfaces, not one

Runtime catches drift. Static catches the source.

The 2026-06-05 "Stephen's 4Q to Nur" leak (forensic write-up in
`project_sasa_4q_leak_audit`) was a textbook case for static: the
`coveyQuadrant()` helper and `enum: ["q1","q2","q3","q4"]` were already in the
tool schema. Telling the model "Never surface these codes to the user" in the
same description while showing it the codes failed exactly once you would
expect: the model echoed them to Nur. Static audit catches that BEFORE deploy
the next time a similar enum lands in the schema.

Runtime catches the messages the static audit cannot reason about: jailbreaks,
prompt-injection successes, paraphrased leaks where the literal token is gone
but the wall is broken. Both gates are mandatory.

---

## Install

```bash
cd /Users/milaaj/Code/bots/nisria-sasa/eval
npm install
```

Node 20+. Uses `tsx` for direct TS execution and `vitest` for the patterns
invariant suite. No platform-source dependency (the static audit reads
`platform/lib/*.ts` as text).

---

## Run

### Static tool-schema audit (offline, fast)

```bash
npm run eval:tools
```

- Reads `platform/lib/smart-tools.ts` and `platform/lib/brain.ts` as text.
- Extracts every `enum: [...]` value, every `description: "..."` string, and
  every top-level `properties: { <name>: ... }` parameter name.
- Applies every §7.1 pattern (style-only patterns excluded because they would
  false-fire inside engineer prose).
- Writes `out/tool-schema-audit-report.json`.
- Exit 0 clean, exit 1 on any CRITICAL/HIGH hit. MEDIUM is warn-only unless
  `NEG_EVAL_BLOCK_MEDIUM=1`.

Override the platform path with `NISRIA_PLATFORM_ROOT=/path/to/platform`.

### Patterns invariant suite

```bash
npm run eval:patterns
```

Pins the regexes to actual leak history. The 4 known-bad fixtures from the
2026-06-04/05 leak (faithful reconstructions, not verbatim chat content)
must fire. Documented §4.5 fiscal-quarter and §7.2 first-person carve-outs
must NOT false-fire. If a future change weakens a pattern, this suite turns
red.

### Runtime persona-contract audit (requires DB)

```bash
cp .env.example .env
# fill SUPABASE_URL and SUPABASE_SERVICE_KEY
npm run eval:contract
```

- Pulls last 30 days of outbound from the Sasa Supabase REST endpoint
  (`messages` table, `direction=eq.out`, `handled_by=eq.sasa`).
- Applies every §7.1 pattern.
- Writes `out/persona-contract-report.json`.
- Exit 0 clean, exit 1 on any CRITICAL/HIGH hit.

The runner uses `fetch` against the REST API directly. It does NOT import
`@supabase/supabase-js`: that library opens a realtime WebSocket on import
which crashes Node 20 CI environments (NEG-EVAL-TEMPLATE.md §2).

### Run all three

```bash
npm run eval:all
```

Order: patterns invariant → static tool-schema → runtime. Static can run
without a DB; runtime needs one.

---

## Environment variables

| Var | Required | Default | Purpose |
|---|---|---|---|
| `SUPABASE_URL` | yes (runtime) | — | Sasa Supabase REST endpoint |
| `SUPABASE_SERVICE_KEY` | yes (runtime) | — | Service-role key, read-only use |
| `BOT_NAME` | no | `nisria-sasa` | Surfaced in report JSON |
| `SUPABASE_PROJECT_REF` | no | `ptvhqudonvvszupzhcfl` | Surfaced in report JSON |
| `NEG_EVAL_WINDOW_DAYS` | no | `30` | History window in days |
| `NEG_EVAL_TABLE` | no | `messages` | Outbound table name |
| `NEG_EVAL_DIRECTION` | no | `out` | `direction` filter value |
| `NEG_EVAL_HANDLED_BY` | no | `sasa` | `handled_by` filter value |
| `NISRIA_PLATFORM_ROOT` | no | `/Users/milaaj/Code/nisria-techops/platform` | Platform repo root for static audit |
| `NEG_EVAL_BLOCK_MEDIUM` | no | `0` | Set to `1` to make MEDIUM hits block |

---

## Exit codes

| Code | Meaning |
|---|---|
| 0 | No blocking violations |
| 1 | At least one CRITICAL or HIGH violation (or any if `NEG_EVAL_BLOCK_MEDIUM=1`) |
| 2 | Config / fetch / parse error — treat as red in CI |

---

## Output

`out/persona-contract-report.json` and `out/tool-schema-audit-report.json`
are written on every run. Shape:

```jsonc
{
  "bot": "nisria-sasa",
  "window_days": 30,
  "messages_scanned": 0,
  "patterns_checked": 17,
  "violations": [
    {
      "pattern_id": "framework.q-priority-code",
      "pattern_label": "Q1-Q4 used as a priority code",
      "severity": "high",
      "spec_anchor": "SPEC.md §4.5, §7.1",
      "message_id": "...",
      "account": "whatsapp",
      "to": "+254...",
      "created_at": "2026-06-05T09:49:00Z",
      "excerpt": "…Q2 is Stephen Covey's second quadrant…"
    }
  ],
  "summary": { "critical": 0, "high": 1, "medium": 0 },
  "generated_at": "..."
}
```

The triage block on stderr prints the first 10 (runtime) or 30 (static) hits
for fast investigation.

---

## Severity policy

Per SPEC §8.1:

- **CRITICAL** — em-dash family, owner-private leak tokens → halt + page
  Taona, rollback procedure §8.3.
- **HIGH** — forbidden frameworks, infrastructure leaks, first-person break →
  alert Taona + freeze deploys.
- **MEDIUM** — raw storage / status enums where humanize may have masked the
  leak → log + weekly digest.

CI defaults to blocking on CRITICAL+HIGH only. Set `NEG_EVAL_BLOCK_MEDIUM=1`
during the first 4 weeks of governance rollout (NEG-EVAL-TEMPLATE.md §5
recommendation).

---

## When the patterns change

The patterns are version-controlled in `patterns.ts`. When SPEC §7.1 changes:

1. Update `patterns.ts` to match the new SPEC verbatim.
2. If you added a new pattern, add at least one fixture in
   `fixtures/leaked-messages.ts` that exhibits the failure shape, and pin it
   in `patterns.test.ts` so the new pattern is exercised on every PR.
3. If you weakened a pattern, the existing fixtures will fail; either revert
   or update the fixture-set with a new §-anchor comment explaining why.

The fixture-pinned invariant is the seatbelt's seatbelt. It is how we know
the next "Stephen's 4Q" leak shape is caught the moment its regex moves.
