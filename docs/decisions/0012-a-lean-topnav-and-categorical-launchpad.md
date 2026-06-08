# ADR 0012: A-lean topnav + categorical Launchpad

**Status:** Adopted
**Date:** 2026-06-08
**Supersedes:** the prior topnav shape with 4 pills (Home / Inbox / Calendar) + 3 folder dropdowns (Money / Studio / People) + Smart / Bell / Help / Workspace icon-buttons + ActivityChip + Avatar (14 chips total).

## Context

The platform had grown to 27 routes. The topnav exposed 18 of them across 3 categorical dropdowns plus 3 pills, leaving 9 of the daily-touched routes (Tasks, Workspace, Approvals, Memory, Agents, Smart, Assistant, Settings, Profile) reachable only via Launchpad or command palette. The categorical groupings themselves were mixed: Money contained Reports + Legal (proof-of-record, not money), Studio contained Inventory (warehouse, not creative), People contained Groups (messaging, not people). The bar read as crowded and the daily work surfaces were buried.

Taona walked the bar and reported: "too crowded, not smart." That feedback was the v2 spec.

Two anchoring constraints shaped the response:

1. **Nur is the operator.** Non-technical founder. Day one she does not know what ⌘K means and will not learn folder structure cold.
2. **Sasa is the hero of this platform.** Per the *demonstrate-core-capability* discipline (KT memory), the platform's central value (the AI agent) must be unmissable on the surface, not hidden behind a Smart button at the right edge.

## Decision

Adopt the **A-lean** shape:

```
NISRIA   ⌂ Home   💬 Workspace   ☑ Tasks   📅 Calendar      ⊞ All apps   🔍 Search ⌘K   T
```

- **Brand** (left): the NISRIA logo, route to `/`.
- **4 daily pills**: Home, Workspace, Tasks, Calendar. The discipline: a pill must be *daily*, not just important. Inbox retires from the pill rail because Workspace is the one-brain inbox by Law 7 (`/inbox` stays reachable via Launchpad as "Inbox (legacy)" so deep links survive).
- **All apps button** (`.navpill.smartbtn`, teal gradient): the categorical hub. Replaces the 3 folder dropdowns. Routes to `/launchpad`.
- **Search button** (`.navpill.searchbtn`, quiet): triggers the CommandPalette via `window.dispatchEvent("open-cmdk")`. The READ verb chip. ⌘K kbd hint is rendered inline.
- **Avatar dropdown** (right): Profile, Tour with Sasa, Agents, Settings, Sign out.

Chrome count: 14 chips → 8 chips. Retired from the bar: Inbox pill, the 3 folder dropdowns (Money / Studio / People), the Workspace icon-button, the Smart navpill, the HelpCircle Tour iconbtn, the ActivityChip, and the Bell notification icon.

### The verb split (the principle this ADR is actually about)

The chip previously labeled "Smart" was conflating two verbs:

- **Read verb (find)**: typeahead, "show me Donors," scan the platform's content.
- **Write verb (do)**: dispatch, "draft a thank-you to David," act through Sasa.

Different intents need different homes:

- **Search** (read) lives in the topbar as a quiet chip + ⌘K shortcut. It opens CommandPalette.
- **Smart Mode** (write) moves *inside* the Launchpad sheet as the prominent gradient banner at the top. It routes to `/smart`. The banner reads: "Smart Mode · Sasa — What do you need to do, Nur?"

This is the **verb-split** rule. Logged in detail as knowledge-tree node #142.

### Launchpad shape

Replaces the flat Bento with a categorical layout:

1. Search input at top (filters by app label, Enter opens top hit).
2. Smart Mode banner (teal/peri gradient, links to `/smart`).
3. Six sections, each a tile grid:
   - **Open work** — Home, Workspace, Tasks, Calendar, Approvals
   - **Money** — Donors, Donations, Campaigns, Grants, Wishlist, Finance
   - **People** — Beneficiaries, Cases, Team, Groups
   - **Records** — Reports, Legal & Compliance, Filing, Library
   - **Studio** — Document Studio, Content, Outreach, Inventory
   - **Sasa internals** — Memory, Agents, Inbox (legacy), Smart Mode

Typing a query collapses the sections into a flat filtered grid; clearing restores them.

### Approvals placement

The notification bell retired from the topbar. The pending-approvals signal lives on Home as the "Needs you" card directly under the headline. Operator clicks an approval card to act inline. The Approvals route is also surfaced in the Launchpad under Open work.

## Rejected alternatives

Three iterations of mockups were produced before A-lean. Ten genuinely different shapes were rendered and reviewed (rendered files preserved at `~/Desktop/Zanii/Nisria/nav-variants/nav-10-shapes.png`):

1. **Linear-clean** — brand + ⌘K + Smart + Bell + Avatar. Calm, conventional. **Rejected** because Smart and Search conflated two verbs.
2. **Sasa-as-OS** — the entire bar IS the Sasa input. **Rejected** as too high-risk on day one for a non-technical operator; Sasa lives inside Launchpad in the chosen shape instead, which is the same "Sasa is hero" energy without the risk.
3. **Two-row contextual (Vercel pattern)** — chrome row + page-context chips row. **Rejected** because two rows eat vertical space and the page starts lower.
4. **Single launcher** — one big "Go to anywhere ▾" button. **Rejected** because click-cost is the same as the chosen A-lean while losing the daily pills.
5. **Pure command bar** — only a full-width search input, no chrome. **Rejected** because no signal for approvals without the bell, and the bell was already retired by request.
6. **Breadcrumb** — brand + path + chrome. **Rejected** because breadcrumb orients but does not help do work.
7. **Mini icon rail** — icons only, no labels. **Rejected** because Nur will not learn cold icons.
8. **Floating bottom dock** — top minimal + Mac-dock at bottom. **Rejected** because it fights with the floating Sasa orb at bottom-right.
9. **Split brand + dispatch** — brand left, Sasa-input right, chrome far right. **Considered seriously as a top pick** before Taona's "all too crowded" feedback rejected the whole family of crowded shapes.
10. **Spatial orbit** — brand center, surfaces orbit. **Rejected** as too unconventional for a working operator.

Three crowded A/B/C variants were also rendered first and rejected for the same crowdedness reason. A-lean is the answer to that rejection.

## Click-cost math (defends the choice against the "longer path" worry)

| Path | Old shape (folders) | A-lean (launchpad) |
|---|---|---|
| To Home/Workspace/Tasks/Calendar | 1 click (pill) | 1 click (pill) — **same** |
| To Donors / Finance / Reports / 18 others | 2 clicks (hover folder → item) | 2 clicks (click All apps → item) — **same** |
| To anything by typing | not available | 1 keystroke + Enter (⌘K) — **faster** |

A-lean is path-equal for categorical routes, pill-equal for daily routes, and adds a ⌘K speed path for power users.

## Implementation

Commits:
- `df02916` — feat(ia): A-lean topnav + categorical Launchpad (Taona's call)
- (this ADR commit)

Files touched:
- `platform/components/AppFrame.tsx` — PILLS rewritten, MENU folder rendering removed (the MENU constant itself was later removed in the hygiene pass), right-side cluster rebuilt with All apps + Search + Avatar.
- `platform/components/Launchpad.tsx` — full rebuild with SECTIONS, Smart Mode banner, search filter.
- `platform/app/globals.css` — `.searchbtn`, `.kbd`, `.lp-ico.ink` styles added.
- `platform/app/page.tsx` — the "Inbox" supporting metric card relabeled to "Workspace" + rerouted.

Not touched: any bot file (`services/`, `group-bot/`, `lib/sasa.ts`, `app/api/whatsapp/`, `app/api/group/`). The `/inbox` page itself stays reachable; only its pill-rail surface retired.

## Rollback

Safepoint tag: `deploy/safepoint-2026-06-08-pre-ia-reorg` (pushed to origin). Revert path: `git reset --hard deploy/safepoint-2026-06-08-pre-ia-reorg && git push origin main --force-with-lease && vercel --prod --yes`. 90 seconds back to the prior shape.

## Consequences

- Day-one discoverability dips for categorical routes (the launchpad is now a click away vs the folder dropdown's hover). Mitigated by the All apps button's prominent teal gradient and the Launchpad sheet exposing every route in one visual grid (folders forced operator to know the category first).
- Workspace finally surfaces as a pill, honoring Law 4 (Browser-OS). The corner-icon placement that prior versions used violated the law in spirit.
- The bell-replacement contract: Approvals MUST stay prominent on Home. If Home is ever redesigned in a way that demotes the "Needs you" card, this ADR's premise breaks. The next IA change must re-verify this constraint.
- KT #142 (the verb-split rule) is now load-bearing — any future chrome chip that means more than one verb is in violation.

## Related

- KT #138 — walkthrough-feedback-is-the-second-spec.
- KT #140 — when-the-user-says-"horizontal-scroll"-confirm-the-axis (same family: ambiguous verbs / axes / modes).
- KT #142 — when-chrome-feels-busy-name-the-verbs.
- NISRIA-DOCTRINE.md Law 4 (Browser-OS), Law 5 (drill-to-core), Law 6 (real-action), Law 7 (one-brain).
- `~/Desktop/Zanii/Nisria/nav-variants/` — all rendered mockups including the 10-shapes sheet, the 5 individual recommendations, the A-lean BAR + LAUNCHPAD renders.
