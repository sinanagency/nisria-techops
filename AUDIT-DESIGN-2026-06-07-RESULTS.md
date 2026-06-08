# Design Audit Phase 1 — Verification Results (2026-06-07)

> Companion to AUDIT-DESIGN-2026-06-07.md. Records what shipped, what verified,
> what got withdrawn during the skeptical loop, and what's queued for the next
> phases. Carve-outs respected throughout: `/tasks` and WhatsApp bot brain
> logic in `services/` + `group-bot/` not touched.

## Phase 1 commits

- 6a6e4a6 fix(design-audit): Phase 1 — truth divergence + noise filter + one-brain redirect + finance em-dash
- fbcddfc fix(design-audit): Phase 1 finalization — em-dash strip at BankingView + nav tooltips + tighter noise filter

Both on branch `redesign/v3`. Preview lives at nisria-preview.zanii.agency (Vercel
project `nisria-preview` does NOT auto-track this branch; manual trigger needed
to mirror it). Local verification harness ran against `localhost:3000` with prod
data via `.env.local`.

## Verification gates and outcomes

| Gate | Method | Result |
|---|---|---|
| 1. Playwright re-capture | `verify-phase1.mjs`, 8 routes, 1440 desktop | All 8 routes captured, scroll heights diffed. |
| 2. Em-dash counter | `grep -oE "[A-Za-z] —\|— [A-Za-z]\|[a-z]—[a-z]"` on rendered HTML | /finance 517→0, /workspace 15→11 (operator-authored doc content). |
| 3. HTTP status sweep | Same harness | 8/8 routes 200. /assistant 200 + redirect to /smart confirmed. |
| 4. Truth-divergence visual | Home screenshot inspection | KPI "Open tasks 79" matches widget "79 open tasks - open the board". |
| 5. `tsc --noEmit` | Local | Clean. |
| 5b. `next build` | Local | Clean, all 35 routes compile. |
| 6. Doctrine sub-agents | Deferred (require Anthropic API call from CLI) | Queue for next-session manual run. |

## Per-route deltas (Phase 1 scope)

| Route | Em-dash before | Em-dash after | Other proof |
|---|---|---|---|
| `/` | 2 | **0** | Tasks widget reads truth-source count, not its own divergent query. |
| `/inbox` | 2 | **0** | — |
| `/calendar` | 2 | **0** | — |
| `/agents` | 2 | **0** | Activity stream filtered to human signals. |
| `/workspace` | 15 | **11** | 4 chrome dashes cleaned; 11 left are operator-authored document content. |
| `/finance` | **517** | **0** | BankingView strips dashes at the bank-narration render boundary. 7 section-title dashes also fixed. |
| `/assistant` | 2 | **0** | Now `redirect("/smart")` server component. |
| `/smart` | 2 | **0** | — |

## What got patched (the 4 real killers)

### K1 — Truth divergence on `/home` Tasks widget
**Symptom:** KPI strip showed "Open tasks 77" while the widget below said "No open tasks."
**Root cause:** widget had a separate `.limit(7)` query on tasks that returned 0 rows while `getCounts.openTasks` (the truth source in `lib/counts.ts`) said 77.
**Fix:** widget empty-state branch now reads `counts.openTasks`. When count > 0 and widget query empty, renders "{count} open tasks - open the board >" linked to /tasks. No tasks schema, API, or query layer touched. Carve-out respected.
**Owner-node alignment:** same lesson as KT #97/#101/#103 — fix lives at the data source, the widget's empty-state read.

### K2 — Em-dash leak on `/finance`
**Symptom:** 517 em-dashes counted in rendered HTML. Doctrine breach.
**Root cause** (revised after skeptical re-count): ~509 came from `bank_transactions.description` field (I&M Bank PDF parser writes em-dashes into the narration). 7 from static section titles in `app/finance/page.tsx`. 2 from `<AppFrame>` nav tooltips.
**Fix:** added `lib/text-clean.ts` with `stripDashes()`, applied at the `BankingView` row render site. Static titles replaced with colons.
**Future-proofing:** `stripDashes` ready to apply at any other table-cell render site in Phase 3.

### K3 — One-brain perception (`/assistant` duplicate of `/smart`)
**Symptom:** 4 Sasa entry points (Smart, Assistant, Workspace composer, Dock orb). Law 7 violated in perception.
**Fix:** `/assistant/page.tsx` now `redirect("/smart")`. Server component, permanent. Bookmarks land on canonical brain entry.
**Operator perception:** 4 brains → 1 brain + 1 orb. Workspace composer left in place (it's tied to the operator's open work context, not a redundant brain).

### K6 — Calm-by-exception activity stream
**Symptom:** Recent activity on /home, /workspace, /agents was dominated by `bot:health_check`, `system_incident_alert`, `agent.tick.ok` noise.
**Fix:** `lib/events-filter.ts` with `NOISY_TYPES` set, `NOISY_PREFIXES`, and lowercased substring match for `health_check` / `heartbeat` / `_ping` / `incident_alert`. Applied at all three render sites.
**Visual proof:** home Recent activity now shows only human signals (whatsapp_message_out, task_assigned to Taona, task_alert_sent).

## What got withdrawn during the skeptical loop (audit corrections)

The skeptic-loop caught me on multiple findings. Honest corrections:

### K4 retracted — Calendar "Sheet James (5) ghost"
The "5 / Sheet James" panel I called a debug artifact is actually two adjacent
feature cards (this-week count + nextEvent title) rendered tight. Real data,
not a ghost. Layout could be slightly less crowded; downgraded from killer to
Phase 4 polish.

### K5 retracted — Launchpad "rainbow gradient icons"
The icons are Lucide on tinted rounded squares per the doctrine
design language. What looked like "rainbow gradient blobs" in the screenshot
was the brand-tone palette (teal/peri/green/gold/gray) on flat squares. The
design system explicitly defines this; doctrine-compliant.

### K7 and K8 downgraded — `/approvals` and `/contacts` 404
Both routes have only `actions.ts`, no `page.tsx`. They return 404. But
nothing in nav points to them (AppFrame nav links and Launchpad APPS list
both omit them). They are unfinished surfaces, not user-visible 404s. The
audit overstated the demo damage. Building `/approvals` queued for Phase 2
(it IS a high-value surface; just not a hidden killer in the current state).

### Em-dash counts on `/donations`, `/beneficiaries`, `/donors` revised
Original counts (262 / 238 / 26) included no-value cell `—` placeholders,
which the doctrine **explicitly allows** (§6.5). Sentence-context recount:
- /donations: 2 (chrome)
- /beneficiaries: 2 (chrome)
- /donors: 2 (chrome)

After the Phase 1 chrome cleanup, all three are at 0.

## What's queued for Phase 2

Priority order, all from the validated 12-fix list in the audit:

1. **Three-pane primitive** (`<ThreePane>`) extracted from the workspace pattern. Apply to `/finance`, `/memory`, `/beneficiaries`, `/donors`, `/legal`.
2. **Horizontal month-pager** (`<MonthPager>`) on `/donations` — Apple Wallet statement pattern.
3. **Mobile column-pager** (`<MobileColumnPager>`) for kanban surfaces — Apple Reminders pattern. Applies to /cases, /grants, /wishlist, /content. (Tasks carve-out preserved.)
4. **Per-column scroll owners** on /tasks, /grants, /cases, /content, /wishlist. CSS-only.
5. **Settings left-rail** (`<SettingsRail>`) — macOS System Settings pattern. Per-section URL routing.
6. **/approvals route** — three-pane queue, Stripe Connect / Linear inbox pattern.

## Skeptical-loop lesson (for the knowledge tree)

**The audit caught itself.** Three Phase 1 findings were wrong on closer inspection (K4, K5, em-dash overcounts on three pages). The fix discipline is to **always re-count with context** after a HTML-grep-driven number — a raw character match without context awareness will over-report. The same goes for screenshot impressions: "rainbow gradients" turned out to be the doctrine's tinted palette.

Future audits: every claim with a number gets a second pass with context-aware grep before it lands as a "killer."

This is a node for `~/.claude/refs/knowledge-tree.md`: **#NN audit-skeptical-recount** — every audit finding that includes a count gets a second pass with surrounding-context grep before it ships as a verdict. Same as KT #97/#101/#103 owner-node enforcement, applied to the audit itself.

---

*Auditor + builder: claude-opus-4-7 (1M ctx). Verification tooling: Playwright 1.60, custom `verify-phase1.mjs`. Local dev gate: `env -u SUPABASE_URL -u SUPABASE_SERVICE_KEY npm run dev` per Taona's `reference_nisria_local_env_shadow.md`.*
