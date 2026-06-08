# command.nisria.co — Ruthless Design Audit (2026-06-07)

> Auditor mode: skeptic, master designer, design-logic enforcer. Bar = Apple HIG, Linear, Vercel, Stripe.
> Method: 66 full-page screenshots (33 routes × desktop 1440 + mobile 390), HTML/DOM forensics, cross-check against NISRIA-DOCTRINE + NISRIA-DESIGN-SYSTEM, Qwen3-Coder structural sanity pass via qclaude → DGX.

---

## 0. The verdict, in one paragraph

The platform LOOKS like a system. It is not behaving like one. Visually the design language is coherent (teal + glass + Inter + Lucide). Structurally, every list view ships an unmediated DOM dump with no virtualization, no pagination, no per-pane scroll owner, no horizontal stacking. The doctrine names this pattern as forbidden in section §5 (three-pane), §11 (calm by exception), Law 5 (drill-to-core). It is still in production on every record surface. There are four separate Sasa entry points (Smart, Assistant, Workspace, Dock orb) which violates the one-brain law in *perception* even if the backend is unified. Two declared menu destinations (`/approvals`, `/contacts`) return 404 in production. The em-dash hard rule is broken 517 times on /finance, 262 times on /donations, 238 times on /beneficiaries — almost certainly a data-pipeline cleaner failure leaking into render. The platform reads as a powerful **toolbox** that has not yet become an **operating system**. The fixes are not a redesign; they are six surgical patterns applied platform-wide.

---

## 1. Hard data (the scoreboard)

| Route          | Desktop px | Mobile px | Items in DOM | Pagination | Virtualization | Scroll-owner | Em-dash count |
|----------------|------------|-----------|--------------|------------|----------------|--------------|---------------|
| /memory        | 8,233      | **16,989** | ~50+ entries | ✗          | ✗              | ✗            | 2             |
| /donations     | 8,818      | **13,742** | **149 rows** | ✗          | ✗              | ✗            | **262**       |
| /finance       | 6,576      | 10,823    | 43 cards     | ✗          | ✗              | ✗            | **517**       |
| /beneficiaries | 6,587      | 8,040     | **105 rows** | ✗          | ✗              | ✗            | **238**       |
| /settings      | 5,638      | 8,308     | 57 cards     | ✗          | ✗              | ✗            | 2             |
| /legal         | 5,618      | 7,575     | 24 cards     | ✗          | ✗              | ✗            | 2             |
| /donors        | 4,271      | 6,893     | 73 rows      | ✗          | ✗              | ✗            | 26            |
| /team          | 4,097      | 8,260     | 42 cards     | ✗          | ✗              | ✗            | 2             |
| /reports       | 3,073      | 3,736     | ~25 cards    | ✗          | ✗              | ✗            | 0             |
| /agents        | 2,952      | 5,702     | mixed        | ✗          | ✗              | ✗            | 0             |
| /grants        | 2,227      | 3,258     | 225 cards    | ✗          | (1 hit)        | ✗            | 0             |
| /approvals     | 1,014 / **404** | — | — | — | — | — | — |
| /contacts      | 1,014 / **404** | — | — | — | — | — | — |

**Read the table once and the platform's biggest structural failure is obvious. The Mobile column is the death column.** /memory on mobile = **43× the viewport height** = the bottomless scroll you named.

---

## 2. The seven cross-cutting failures (the laws being broken)

### F1 — The bottomless scroll (Law 5, §5, §8)
**Every** list view is one continuous body scroll. No three-pane. No infinite-scroll boundary. No "load more". No virtualization. The DOM ships 149 donation rows or 225 grant cards inline. On 1440 this *renders* (slow but possible); on 390 mobile it produces 13–17 kpx pages that the operator scrolls past nothing useful.

The doctrine calls for three-pane on Finance, Beneficiaries, Sources, Grants. Not built. Each pane should own its scroll (overflow:auto), the body should not. Confirmed via HTML grep: **0 pages declare a scroll owner**.

### F2 — No horizontal navigation primitive
The platform has 33 routes and the design system §5 names a TWO-SPACE SLIDER + WORKSPACE TAB STRIP. The tab strip exists (top chrome) but no surface uses **horizontal swipe to compare** — neither donations-by-month vs by-donor, nor grants-by-stage vs by-funder, nor finance-by-account vs by-month. The Apple Cash/Wallet "swipe between cards" idiom is the natural fit here, and absent.

### F3 — One-brain perceived as four brains (Law 7)
Four Sasa entry points reachable from the global chrome: `/smart` ("Tell me what to do"), `/assistant` ("Ask me anything"), `/workspace` (composer in middle pane), and the floating orb (Dock). They use three different copy registers and two different layouts. Even if the backend is the same Sasa, the user feels four. The doctrine says ONE brain. Either collapse to one route + the orb, or label them as distinct *modes* (Do / Ask / Operate) of the same brain.

### F4 — The em-dash leak (the doctrine's hardest rule)
Doctrine: "No em-dashes in any output." Live counts on rendered HTML:
- /finance: **517**
- /donations: **262**
- /beneficiaries: **238**
- /donors: **26**

These are not in chrome copy. They are leaking through Money/cells from imported source data (bank statements, donor exports). A cleaner exists in code; it is not in the render path for these surfaces. Surgical fix: filter at the read query and at the `<Money>` primitive boundary.

### F5 — Truth divergence (Law 11 — honesty)
`/` says **Open tasks 77**. `/tasks` says **Open tasks 0** with empty kanban. This is the single most damaging bug in the audit, because Taona's name for it ("contradiction") = "do not trust this platform." Same shape on /donations: home says "$26,483 this month", /donations hero says **KES 0**. The platform is contradicting itself on its own headline number.

### F6 — Calm-by-exception is broken (§11)
The doctrine says widgets stay quiet unless they have something for the operator. Live, every dashboard panel shows the same five `system_incident_alert` and `bot:health_check` events in its activity stream, on /home and /agents and /workspace. Health-check noise IS the activity stream. There is no signal left. This is the inverse of Linear's "Updates" feed and the inverse of Apple Wallet's "show me only what changed."

### F7 — Iconography breaks Law 11 on /launchpad
Launchpad icons are rainbow-gradient blobs (purple, cyan, hot-pink). The design system explicitly bans purple/cyan gradients as AI slop. Launchpad is the one place the operator sees the platform as a "Mac-like" launcher; right now it looks like a 2017 Material You preview.

---

## 3. Section-by-section audit (33 routes)

Each section: ✅ what works / 🔴 what's broken / 🧭 what's missing / 🔧 placement fix.

### 3.1 / (Home, "Mission Control") — 2,436px

✅ Greeting + 4 inline quick-action chips set the right warm tone. Big teal "Raised this month" hero card lands the one-headline focus.

🔴
- "Tasks" widget says **No team tasks** while the KPI strip above says **Open tasks 77**. Same screen. Truth violation.
- "Sasa's brief" is an empty gradient block — a placeholder shipped to prod.
- "Recent activity" is 100% bot/system noise (`system_incident_alert`, `group_bot_health_check`, `vt_*`). The operator sees zero human-relevant signal.
- "Fundraising last 6 months" chart has unbranded inconsistent labels ($1.1k, $1.5k, KsK, $1.7k). KsK looks like a parse failure not a currency. KES/USD must never mix (doctrine Law 2).
- The Sasa orb is positioned over the chart's right bars — interaction collision.

🧭
- No "What changed since you last opened" timeline (Linear's killer feature).
- No "next best action" surfaced from the system (Stripe's "your next step" pattern).
- No personal cockpit row: my donors, my drafts, my approvals.

🔧
- Demote the "Recent activity" widget to filtered human-events only (donor reply, grant moved stage, beneficiary onboarded). Bot health goes to /agents.
- Reconcile the tasks counter at the data layer; the truth source is `tasks WHERE state IN ('todo','in_progress')` — pick one query, use it both places.
- Move "Sasa's brief" up to fill the dead band under the hero, but only render when it has copy. Otherwise hide.
- Pin the orb above the chart with safe-area padding.

### 3.2 /inbox — 1,127px

✅ Mail-app pattern (left list + right reader) is the correct primitive. Filter pills (Needs you, Sasa drafts, FYI, All, Mavis, Maisha, WhatsApp, Social) are well thought through.

🔴
- "+ Add account" floats top-right of the *reader* pane — accidental placement (looks like an action on the open thread).
- Empty state copy ("All caught up. Nothing needs a reply right now.") is identical in left list and reader. Reads as a bug.
- The two pills "+ All" + "All Mail" look duplicate.

🧭
- No three-state read indicator (unread / read / replied). Apple Mail does this.
- No "snooze until" verb on the reader. Linear/Superhuman ship this.
- No search across all accounts in one prompt.

🔧
- Move "+ Add account" to /settings → Integrations. The reader's top-right is where Reply/Forward/Snooze belong.
- Replace the doubled empty-state with one: left list = "0 conversations need you", reader = "←  pick a conversation".

### 3.3 /tasks — 900px (empty), kanban

✅ Three-column kanban (To do / In progress / Done) is the right primitive for an operator. "Tell the system what you want done" composer + Dispatch is on-brand.

🔴
- KPI strip shows 0/0/0/0 while /home shows Open tasks 77. **Same truth bug as /home.**
- On mobile, kanban becomes 3 stacked sections. With 100 tasks, this is 300 stacked cards = the bottomless scroll Taona named, exact form.

🧭
- No filter by assignee, brand, or due-this-week.
- No view-toggle (Kanban / List / Calendar / Gantt).
- No bulk verb (select 5 → reassign to Nur).

🔧
- **Mobile fix is the priority**: switch to a horizontal-pager between columns (swipe between To do / In progress / Done). This is exactly Apple Reminders' list-pager + Trello mobile. Each column gets its own scroll owner. 100 tasks → 1 column visible, swipe to the next column. Solves the bottomless complaint at its root.
- On desktop, give each column a fixed height + per-column scroll owner (overflow-y:auto). Kanban columns must scroll inside themselves, not the body.
- Add a sticky filter row above the kanban (Assignee / Brand / Due / Tag).

### 3.4 /calendar — 1,234px

✅ Month grid is right. Brand-row filter chips (Tasks / Payments / Grant deadlines / Content / Events & meetings / Holidays) is a strong taxonomy. "Ask Sasa" + "What's next" CTAs in the top-right elevated teal — clean.

🔴
- Top-right shows a floating "S Sheet James" card with a `(5)` badge that reads as a debug artifact. Mystery placement, mystery name.
- Month/Week/Year/Agenda toggle is small and indistinct (visual weight too low).
- "Today" button is gray pill among other gray pills — no anchoring affordance.

🧭
- No timezone label (Sasa runs on UTC, ops are in Dubai/Nairobi — this is a real bug).
- No mini-month picker for fast jump.
- No keyboard nav (j/k or arrow keys).
- No conflict indicator when two events overlap a slot.

🔧
- Kill the "S Sheet James (5)" floating tile or rename it. Currently it reads as broken.
- Promote view-toggle to a segmented control (Month / Week / Day / Agenda) with the active state in teal, like Linear's view-switcher.
- Add a fixed "Dubai (GMT+4)" + "Nairobi (GMT+3)" dual-timezone strip above the grid.

### 3.5 /agents (Automations) — 2,952px

✅ "3 automations active" headline is strong. Autonomy-dials section (manual / approve / auto toggles per channel) is a brilliant primitive — Stripe doesn't even ship this.

🔴
- "Scheduled jobs" table shows 6 jobs with **identical "Daily 04:15 UTC / next run Tue 04:15"** strings. Either truly identical schedules (bad scheduling design) or a rendering bug. Looks like the latter.
- "Activity stream" is the same noise as /home (system_incident_alert × N).
- "Recent agent runs" lacks runtime and agent-name columns, both critical.
- Status badges (live / partial) use coral and amber that don't read in the doctrine's status palette.

🧭
- No agent → log drilldown. Stripe's Workbench / Linear's audit log are the references.
- No cost-per-run column. (Anthropic spend is a real number, surface it.)
- No kill-switch button on the page (it lives in env vars).

🔧
- One row per agent, with its **next run time and last run status** in tabular-nums. Status badges from the doctrine palette only.
- Add a "Recent runs" focus-sheet that opens on row click and shows the run's prompt, tools used, output, cost, duration.
- Move the autonomy-dials to a top-of-page sticky row — it's the strongest UI on this surface.

### 3.6 /smart — 1,115px

✅ Copy is excellent ("Sasa runs inside the platform. Anything that goes out to a person or moves money is queued for your approval first."). This sentence sells the platform.

🔴
- Composer is enormous (~7 lines visible empty area on a 1440 viewport).
- Three example chips are truncated mid-word (browser ellipsis on chips).
- Three big teal action tiles at the bottom ("Run tasks / Update records / Draft a queue") **repeat** the four inline chips at the top — same verbs, two different presentations.

🧭
- No history of past smart-mode dispatches (the operator wants to see "I told Sasa to do X yesterday, here's the trace").

🔧
- Shrink composer to 3 visible lines; expand-on-focus.
- Replace truncated example chips with a single "Try one of these" link that opens a sheet of full examples.
- Delete the bottom 3 tiles. One verb, one place.

### 3.7 /workspace — 1,130px

✅ The three-pane is structurally the right primitive (this is the only route that uses it). Conversations / open tabs / live activity is a real layout.

🔴
- Middle pane mashes three concepts (open-tab list / composer / tab strip) into one column. Too dense.
- Right "Live activity" is bot health noise (same as everywhere).
- Conversations on left have inconsistent date formats and the same name "Nur M'nasria" repeated 4× in a row with no thread differentiator.
- "1 open tab" badge is hardcoded-looking.

🧭
- No "all open work" overview (vs three pane is conversations+tabs, missing approvals / drafts / pending).
- No keyboard shortcut hints.

🔧
- Middle pane: pick ONE function. The composer is the right one. Push tabs into the top chrome (they already exist there).
- Left pane: collapse multi-message threads, show last-message snippet + count.
- Right pane: human-relevant events only.

### 3.8 /launchpad — 900px

✅ The concept is right (Mac-style app launcher). Two-row layout (Pinned / All modules) is correct.

🔴
- **Icon design is AI slop** (rainbow-gradient blobs in purple/cyan/orange — explicitly banned by doctrine Law 11). Compare to Mac Launchpad's flat tinted glyphs.
- Pagination dots at the bottom (1 of 3?) for an icon grid — confusing. Why are modules paginated?

🧭
- No "Recent" or "Frequent" row.
- No search-result preview (typing "don" → Donors/Donations/Donor steward).
- No keyboard nav.

🔧
- Replace gradient icons with the Lucide system already used in /agents and the top nav. One icon set, one tint per brand-color.
- Drop pagination. Show all modules in one grid with category dividers (Money / Studio / People / Ops).
- Add a "Recent" row that watches operator nav, like macOS App Library's Recently Added.

### 3.9 /studio (Document Studio) — 1,255px

✅ "Assemble a document" hero + "Generated documents" grid is the right top/bottom split.

🔴
- Top hero composer takes ~600px vertical of the 1255px page. Bottom is sparse (4 cards). Imbalance.
- Cards have no thumbnail of the document itself — just brief text. Apple Pages / Notion both render a thumbnail.
- "Drop a brief or click inputs" is unclear (is this a drag-drop zone? a text field? both?).

🧭
- No "duplicate this", "open in editor", "send for review" verbs on past docs.
- No filter by brand / type / date.
- No template gallery.

🔧
- Compress the composer; render thumbnails (HTML-to-canvas thumbnail or the first page of the PDF) on past doc cards.
- Add a brand × type filter row.

### 3.10 /profile — 1,114px

✅ Compact, calm. KPIs make sense for an operator (assigned to me / to others / created by me).

🔴
- Teal hero card on a single user is overweight; Apple/Linear show a small avatar + name row, not a billboard.
- "Account details" table reveals "Active" and email-type with redundancy.

🧭
- No activity timeline of this user (their last 20 actions).
- No "switch user" affordance for Taona to A/B as Nur during build.

🔧
- Shrink hero, add a compact 6-row timeline below KPIs.

### 3.11 /settings — 5,638px desktop / 8,308px mobile

✅ Real, deep settings (Organisation / Brain / Sasa instructions / Brain rules / Brain Apps / Smart instructions / Notifications / Integrations).

🔴
- 57 cards in one continuous column. No sticky left nav. No section anchors. No search.
- This is the single most violated surface vs Apple/Linear. iOS Settings, macOS System Settings, GitHub Settings, Linear Settings — all use a fixed left rail of categories. We ship a 5–8kpx scroll.

🧭
- No "Settings search" (cmd-K within /settings).
- No "what changed recently" log.
- No restore-defaults for any section.

🔧
- Convert to a fixed left-rail layout: 8–10 categories sticky on the left, content on the right, URL-routed (`/settings/brain`, `/settings/integrations`). Per-section scroll owner. **Mirror macOS System Settings.** This single change cuts the surface from 5,638px to 800–1,200px per category.

### 3.12 /memory — 8,233px desktop / **16,989px mobile**

🔴 This is the worst surface on the platform.

- No grouping. No filter. No date facet. No source facet. No tag facet. No type facet. No virtualization. No pagination. Just one unmediated dump.
- Mobile = **43× the viewport height**. Operator scrolls past 1,500 lines of text to find a single entry.
- Top filter pills exist but don't change the visible density.
- Memory is the most semantic surface (everything has a vector embedding upstream) and ships as the least semantic UI.

🧭 The reference is Mem.ai, Notion's "All updates", Logseq's daily journal — every one of them has time + tag + source + search.

🔧
- **Three-pane**: left = sources/tags/dates tree; middle = entry list (virtualized, per-pane scroll); right = entry detail with edit/promote/retire verbs.
- Add a top search-bar with semantic + lexical toggle.
- Group by salience tier (auto-fact / chat-derived / curator-approved) per the brain doctrine.
- Default view = last 7 days with a date-tree on the left for older spans.

### 3.13 /assistant — 900px

🔴 Existence of this route is the F3 problem made literal. "Ask me anything" is what Sasa is. Why is it a separate route?

🧭 If kept, needs conversation history, citations, and the ability to convert an answer into an action.

🔧 **Collapse this into /smart** with a Do / Ask segmented control at the top of the composer. OR delete it; the orb already does Ask everywhere.

### 3.14 /approvals — **404**

🔴 The doctrine names `<ApprovalCard>` as a canonical primitive. The /approvals route returns 404. This means the system has the *card* but no *queue*. Operator has nowhere to do the "approve / edit / reject" loop the platform's value proposition leans on.

🧭 Reference: Stripe Connect approval queue, Linear inbox.

🔧 Ship the route. Three-pane (Brand × Channel sidebar / queue / approval detail). This is the cockpit of the Sasa promise.

### 3.15 /contacts — **404**

🔴 Listed in the top-nav code but returns 404. Either remove from nav or build.

### 3.16 /guide — 1,850px

✅ Right top: "The fastest way around is to let me show you" + "Take the tour with Sasa" is on-brand and matches your `feedback_sasa_led_onboarding`.

🔴
- Below the CTA, the "Quick reference" sections (Your cockpit / Fundraising / Programs / Content / People) are flat link-rows that duplicate the top-nav. Reads as docs nobody will read.

🧭 The good version is the Sasa-led tour — but the static reference below it dilutes the message.

🔧 Keep the top half. Replace the bottom-half "Quick reference" with a 3-slot "Suggested next tour" — Sasa picks based on what the operator hasn't seen.

### 3.17 /donors — 4,271px

✅ Tabs (All / Recurring / Major / Prospects), search, "Add donor", sortable columns.

🔴
- One flat table, 73 rows, no pagination.
- LTV column is a number, no rank chip ("top 10%"), no spark.
- No cohort or by-month roll-up.

🧭 Stripe Sigma Donors, HubSpot lists, Linear views.

🔧
- Add per-table scroll owner (sticky header, scrollable body).
- Add LTV decile chips (T1 / T2 / T3 / T4) and a top-10 panel.
- Add a saved-views sidebar (left rail) — three-pane primitive.

### 3.18 /donations — 8,818px desktop / **13,742px mobile** / 149 rows / 262 em-dashes

🔴 The exact bottomless-list pattern Taona named, applied to money.
- Hero says **KES 0** while /home says $26,483 this month. Truth divergence again.
- 262 em-dashes in render (doctrine breach).
- 149 rows in one scroll.

🧭 Stripe Payments, Mercury Transactions — both group by date-bucket, both virtualize.

🔧
- **Horizontal month-pager** at the top (←  May / June / July  →). Each month is a self-contained pane with its own scroll. Apple Wallet's monthly statement pattern.
- Per-month subtotal at the top of each pane (this is the headline number).
- Strip em-dashes at the `<Money>` boundary and at the source-data ingest.

### 3.19 /campaigns — 951px

✅ One campaign teal hero with progress ring is great (KSh 28,357 / 44% / 65k goal).

🔴 Only one historical campaign visible. No comparison view. No funnel.

🧭 Each campaign is a mini-funnel; show conversion from page-view → donor → repeat.

🔧 Add a per-campaign drill-down focus-sheet with timeline + sources + thank-you-status.

### 3.20 /grants — 2,227px

✅ Kanban of researching/proposal/submitted/won-lost is the right structure. "Active grants" card row is dense and useful. 225 cards in DOM (most opportunities surfaced).

🔴
- Headline says "27 grants in play" but Submitted KPI says 2 — unclear definitions.
- Opportunities cards in 4 columns are visually identical (same teal accent, same "Pursue / View" CTAs) — no priority signal.
- "Pursue" CTA is two clicks away from the actual pursuit (where does it go?).

🧭 Linear's project boards, Airtable Kanban.

🔧
- Add a scoring rubric chip on each opportunity card (fit %, deadline urgency, prior history). Rank visually.
- Per-column scroll owner.

### 3.21 /wishlist — 900px

✅ Hero + 3-column kanban + composer is consistent with /tasks and /cases. Three columns = Open needs / Partially funded / Fulfilled.

🔴 Empty state. Nothing to audit beyond pattern.

🧭 When data lands, needs a "match to a donor's interests" verb.

### 3.22 /finance — 6,576px desktop / 10,823px mobile / **517 em-dashes**

🔴 The worst em-dash leak on the platform. 517 in render.
- Hero "-$241 / KSH 30,500" reads as operating deficit but no time-window label.
- Multiple stacked tables (Operates last month, another, Forecast bars, Recurring payments, Billing, a form) — six concepts in one scroll.
- No three-pane despite the doctrine explicitly naming Finance for it (§5).
- "Forecast" sparse-bar chart is unreadable.

🧭 Mercury Banking, Brex, Pilot.com — all use sidebar (accounts) + middle (transaction list with date-buckets) + right (transaction detail). All virtualize.

🔧
- **Adopt the Mercury layout literally.** Accounts sidebar / transaction list with date-bucket headers + per-bucket subtotal / transaction detail panel.
- Replace the embedded form at the bottom with a focus-sheet over the page.
- Em-dash cleaner at the read boundary.

### 3.23 /reports — 3,073px

✅ Report builder at top (5 templates × date range × sections × letterhead × instructions × generate). Strong.

🔴
- "Past reports" below is multiple flat lists per category (Impact / Financial audits / Loving Hands / Monthly field / Executive summaries). 20+ items in the Loving Hands tab alone.
- No filter by year/funder/recipient.

🧭 Google Drive's recent files, Notion's gallery.

🔧
- Convert "Past reports" to a single filterable list with year + type + brand facets.
- Add thumbnails (first page).

### 3.24 /legal — 5,618px

🔴 Same pattern: 24 cards in one column. Mix of entity registrations, recurring filings, group ratifies, bank confidentiality, properties, T&S of reports, other compliance.

🧭 Each legal item has a renewal date. Surface them in a calendar view.

🔧
- Three-pane: Entity sidebar (US / Kenya) / doc-type list / doc detail.
- Add a "Up for renewal in next 90 days" panel at the top.

### 3.25 /filing — 1,508px

✅ Excellent opening copy ("Drop everything Sasa will sort it") + three intake options (Drop / Speak / Paste). Folder card grid.

🔴
- Folder naming case is chaotic: General / Finance / Reports / Admin & Compliance / Team & HR / Grants & Fundraising / 2026 / Programs / AHADI / Maisha / **general** / media / programs / legal / Communications. Same name appears in two cases. AHADI is all-caps. "media" lowercase. This is a content-pipeline problem visible in UI.

🔧
- Canonicalize folder names (Title Case, single source). Strip duplicates.

### 3.26 /content — 1,780px

✅ Composer + 3-column Suspended/Drafts/Queued.

🔴
- Composer is heavy, columns are thin → visual imbalance.
- Visible draft has long body that overflows card height creating awkward whitespace.
- No platform-specific preview frame.

🔧
- Add Instagram / Facebook preview frames (mock the platform chrome). Buffer and Later both do this.
- Cap card body to 4 lines with a "more" expand.

### 3.27 /library — 1,266px

✅ Drop-files zone + 60-files panel + Google Drive connector + filter pills. Clean.

🔴 Empty state filters (Programs / Events / Media / General) all show empty except Programs (2 thumbnails).

🔧 Add list/grid toggle, and a per-file action menu (preview / move / replace).

### 3.28 /outreach — 1,438px

✅ 85/50 hero, 3 KPI tiles, blast composer with audience selector + preview. This is one of the cleanest surfaces.

🔴 Preview pane reads "Subject will appear here / Your message will appear here" — but no live preview when typing. Wire it.

🔧 Make preview reactive on every keystroke. Add A/B test toggle.

### 3.29 /inventory — 900px

✅ Clean empty-state form.

🔴 No example skeleton, no template, no bulk import. A first-time operator stares at a blank form.

🔧 Add a "Use sample data" button and a CSV import.

### 3.30 /beneficiaries — 6,587px desktop / 8,040px mobile / **105 rows** / **238 em-dashes**

🔴 The other bottomless list. 105 rows, no filter applied state, no map view despite location data being structured.

🧭 Doctrine §5 names Beneficiaries for three-pane. Not built.

🔧
- **Three-pane**: Status sidebar (Active / Pending / Closed) / list / beneficiary detail.
- Add a map tab — beneficiaries cluster geographically (Kenya counties).
- Em-dash cleaner.

### 3.31 /cases — 1,487px

✅ "2 cases waiting on you" hero + 4-stage kanban (Prospect / Under review / Pending field / Declined) + "Log a case with AI" composer. This is the cleanest surface on the platform.

🔴 Kanban columns will become the tasks-problem when they fill up.

🔧 Per-column scroll owner from day one.

### 3.32 /team — 4,097px

✅ KPI strip + category groupings (Leadership / Operations / Mentor / Finance & Admin / Volunteers).

🔴
- Card grid is loose — some categories have 1 member, some have 8. Uneven whitespace.
- Status badges (Kept / Declined) are confusing for active staff.
- Pay info appears to be on each card — exposed to all viewers.

🔧
- Even out card density (3-col always, repeat avatars or fill with placeholder).
- Hide pay behind an explicit role check; the doctrine has Field-nervous-system law (8).
- Add an org-chart view-toggle.

### 3.33 /groups — 1,004px

✅ WhatsApp/Slack-style left list + right chat. The cleanest IM-pattern on the platform.

🔴
- Selected group's chat panel shows ONE bot message with no surrounding thread. Looks broken.
- No "unread" count badges in left list.

🔧
- Add unread badges, pin on top, snooze, mute.

---

## 4. The hidden killers (ship-blockers)

These are the items that make the platform feel untrustworthy in a 30-second demo:

1. **/approvals 404** — the linchpin verb of the platform doesn't exist as a destination.
2. **/contacts 404** — listed in nav, dead route.
3. **/home tasks contradicts /tasks tasks** — 77 vs 0 on the same login.
4. **/home donations contradicts /donations** — $26K vs KES 0.
5. **517 em-dashes on /finance** — doctrine breach surfacing as visual noise.
6. **/calendar Sheet James (5) ghost tile** — looks like a debug artifact in production.
7. **Sasa is four routes in the nav** — perception of identity fracture.
8. **/launchpad rainbow icons** — visually contradicts Law 11.

Fix these eight first. Everything else is a refinement.

---

## 5. The twelve prioritized fixes (with the pattern to copy)

| # | Fix | Pattern to copy | Effort |
|---|-----|-----------------|--------|
| 1 | Reconcile /home tasks + /tasks + /donations + /donors at the data layer (single query, single truth) | Linear's "facts" model | S |
| 2 | Ship /approvals and /contacts (or remove from nav) | Stripe Connect, Linear inbox | M |
| 3 | Em-dash cleaner at `<Money>` and at source-data ingest | One-line regex at boundary | S |
| 4 | Three-pane on /finance, /donations, /beneficiaries, /grants, /memory | Mercury / Apple Mail | L |
| 5 | Horizontal month-pager on /donations (swipe between months) | Apple Wallet statements | M |
| 6 | Mobile kanban as horizontal-pager between columns | Apple Reminders | M |
| 7 | Per-column scroll owners on /tasks, /grants, /cases, /content, /wishlist | overflow-y:auto on column, not body | S |
| 8 | /settings → fixed left rail of categories, per-section scroll | macOS System Settings | M |
| 9 | Collapse /assistant into /smart with Do / Ask segmented control | Linear command bar | S |
| 10 | Strip rainbow icons from /launchpad, restore Lucide system | macOS Launchpad | S |
| 11 | Filter human-only events into Recent activity, route bot health to /agents | Linear updates feed | S |
| 12 | Kill the "Sheet James (5)" ghost tile on /calendar | Remove the artifact | XS |

Effort scale: XS = under 30 min, S = under half-day, M = under 2 days, L = 1 week.

---

## 6. What the platform gets right (do not regress)

- The teal + glass + Inter language is coherent and ages well. Resist the urge to repaint.
- The autonomy-dials primitive on /agents is unique and valuable — promote it.
- The Sasa-led tour CTA on /guide is the right onboarding move. Build the tour itself.
- The Filing intake copy ("Drop everything Sasa will sort it") is the brand voice in one sentence.
- The Cases kanban + composer is the cleanest cockpit on the platform — use it as the template for /approvals.
- Mobile tab strip (visible on /tasks mobile) works.

---

## 7. The single most important takeaway

**The platform's design crime is uniformity-of-density.** Every list ships at the same flat row density with no spatial hierarchy. The fix is not "more design"; it is **scroll-owner discipline** + **horizontal stacking** + **three-pane**. Apply those three primitives platform-wide and the bottomless-scroll problem dies in one pass. Everything else is icon polish.

---

*Auditor: claude-opus-4-7 (1M ctx) · Tooling: Playwright 1.60 (Chromium), Qwen3-Coder via qclaude → DGX Node 02 ccr proxy · Screenshots: `~/.claude/jobs/7615d6a1/audit/shots/`*
