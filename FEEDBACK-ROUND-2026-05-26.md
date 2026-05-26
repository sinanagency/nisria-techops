# Nisria Command Center — Feedback Round (2026-05-26, morning)

> Status: CAPTURE ONLY. Do NOT build yet. Nur/Taona is still adding corrections and will
> ask for my opinion before I touch anything. This file is the source of truth for the fix round.

## A. New capabilities he wants

1. **Document Studio (AI document creation).** Some emails require drafting documents (e.g. the
   STP 10th Cohort email asks for: Interim Report, 2Q Financial Settlement Sheet, Bank Statement,
   Supporting Documents ZIP, receipts). The portal should **suggest opening a Studio**, let her
   **drag-and-drop screenshots / info / documents**, and then **generate the needed documents** for
   Nur, **branded** (Nisria/Maisha/AHADI branding on the output docs). Think: inbound request →
   "Sasa can prepare these documents" → drop inputs → branded PDF/DOCX out.

2. **Finance: AI-populate expenses via drag-drop or voice.** On the Finance tab there must be a
   prompt to **populate ALL expenses** by drag-and-drop (receipts/screenshots) OR **voice**. AI
   profiles all expenses and figures out what's needed. (Extends the existing M-Pesa-screenshot
   vision idea into a full expense intake.)

3. **Reports tab.** A dedicated place to **generate the reports that are needed** — bank statements,
   financial reports, settlement sheets, the grant/funder report packages. Ties to #1 and #2.

4. **Kenya reconciliation — upload past receipts.** In Givebutter→Kenya reconciliation she should be
   able to **upload whatever past receipts she has**; the system must **understand historical data is
   incomplete** ("some info won't be there") but **going forward she uploads everything**. Right now
   it shows $27,652 withdrawn vs KES 0 paid out because nothing is logged on the Kenya side.

5. **First-run ONBOARDING (in Settings) — the portal is a brain.** When she signs in the first time
   (we are still in dev), there must be an onboarding flow that **collects ALL info ever about the
   org**: key events, key losses, key assets, history. The portal is **a brain with memory** that
   **advises and guides using Claude**, and **populates + saves** everything. Onboarding lives in
   **Settings** (re-runnable). This feeds Sasa's context/memory.

6. **Grants: auto-select + auto-prepare ALL, always ready.** The grant agent should **automatically
   select and prepare ALL** opportunities and keep them **ready for submission at all times**. Nur
   just shows up and **accepts or declines** — everything is already prepared/queued. Today they sit
   in "Researching (4)" with manual "Prepare application" buttons and "Prepared·review (0)". Wrong:
   the pipeline should be pre-filled into Prepared/ready, not waiting on her to click prepare.

## B. Logic / data correctness (he stresses this hardest — "your system is not wired correctly")

7. **Inbox "needs a reply" says 0 but there ARE emails needing replies.** Dashboard "Inbox 0 need a
   reply" + "Open tasks 0" are wrong: the inbox shows 2 conversations needing attention and Needs You
   has 12. Counts/logic are broken. If there's work, it should not read 0. (Inbox count, tasks count,
   Needs-You count must reconcile and be truthful.)

8. **Needs You is REPEATING emails.** Duplicate reply cards (two identical "Reply to sameer patil",
   both Escalated). Dedupe.

9. **Needs You doesn't show which ACCOUNT** the mail is from (sasa@ vs maisha@). Each card must show
   the source account. "If there are none, then [say] yet" (clean empty state).

10. **Donor timeline shows RAW HTML/CSS** instead of clean email text — e.g. `@media only screen and
    (min-width:480px){ .mj-column-per-100 {...} } </sty` and `<!doctype html><html ...>`. The email
    renderer is not cleaning MJML/HTML in the donor 360 conversation + timeline. Must show clean text,
    **retrieve ALL emails**, be **scrollable**, and **allow sending new emails** from the timeline.

11. **Donations must link to the donor profile** the same way donors do (click → profile).

12. **Money/People/Studio dropdowns OVERLAP the tab strip** below the nav (z-index/stacking). The
    open dropdown menu collides with the open record tabs. Resolve stacking/placement.

13. **Sasa brief still not scrollable.** (Repeat — flagged before.)

14. **Money still not hideable** — "Raised all-time $26,483" and donor balances do NOT blur with the
    money-hide (eye) toggle. The `.money` class isn't applied to all balances. (Repeat.)

## C. Design quality / polish

15. **Donor peek opens in the wrong place + not centered.** Clicking a profile "goes down" and the
    peek is mis-positioned; must be **centered**. Content also overflows the card edges (the
    "thank-you drafts into Needs You…" helper text bleeds outside). Fix positioning + overflow.

16. **Needs You expanded popup not center-aligned + glass is cheap.** The expanded reply card is not
    centered and the **glass/transparency is not clean — it bleeds through, looks cheap, not pro, and
    affects everything else**. Make the modal a proper centered overlay with a clean, opaque-enough
    surface (kill the see-through mess).

17. **Top bar should TRANSFORM per tab.** The persistent top nav should adapt/transform contextually
    depending on which tab/page you're on (not the same static bar everywhere). "Transform into
    something else, you know."

18. **"Add a grant" placement is strange** — currently an inline form jammed at the bottom of the
    first kanban column. Needs a better home (e.g. a button/modal, or a dedicated spot).

19. **Paid history takes too much space** — should be **collapsed by default, expand at will**.

20. **Avatar stack "W H E S A +55" under Donors — remove it.** "I don't understand it and it
    shouldn't be there."

21. **TWO search bars** — the top-nav omnibox ("Search anything ⌘K") AND the home hero ("Search or
    jump to ⌘K"). Keep ONE, the most ideal; remove the other.

22. **Empty Tasks card says "Ask Sasa to assign one" but that means going elsewhere.** Should let her
    **ask Sasa right there inline**, not navigate away.

23. **Wasted space everywhere.** E.g. the "Fundraising · last 6 months" chart is mostly empty space.
    Rule: every empty/wasteful area must either hold something meaningful or be removed. He says this
    is recurring and I "keep lying" about fixing it.

## D. Cross-cutting (the meta-issues he keeps repeating)

- **EVERY card must be clickable** and lead somewhere. Raised repeatedly across dev, still not done.
- **Consistent LOGIC failures** — counts wrong, repeats, dead-end empty states. This is why he asked
  for logic trees; he feels I built it complicated instead. The whole thing needs a coherent logic
  layer where states/counts are truthful and every surface leads somewhere sensible.
- **Glass must look PRO, not cheap** — current transparency bleeds and cheapens everything.
- **No wasted space. No dead ends. Everything clickable, centered, scrollable, truthful.**
- Tone: he is frustrated that recurring items (clickable cards, wasted space, scrollable brief,
  hideable money) were claimed-fixed but weren't. When I fix, I must VERIFY each on the live site,
  not assert.

## C. Design quality / polish (continued — second batch)

24. **Dropdowns are UGLY + overlap the content.** Studio/Money/People menus are see-through, badly
    layered, and collide with the cards/tabs behind them (e.g. "Comms agent" bleeding through the
    Studio menu on /agents). Make them solid, clean, properly elevated (z-index + opaque surface).
25. **Floating Sasa AI button touches cards.** The bottom-right orb overlaps content; it must sit
    clearly separate (safe-area padding, or a proper dock that never collides with cards).
26. **Top-right icon cluster is redundant — trim it.** Remove redundant icons. The **money-hide (eye)
    toggle must leave the top bar** and become a **small per-card toggle right where the money is
    shown** (on the "Raised this month" gauge card, "Raised all-time" card, donor balance cards,
    etc.). Also note: Sasa has two entry points (the top-right sparkle AND the floating orb) =
    redundant; consolidate. (Refines/replaces points 13–14 approach for money-hide.)
27. **"Open full view" tooltip covers the number** on the card. Tooltip placement is wrong (it sits
    on top of "$26,483"). Fix tooltip positioning. (Cards becoming clickable is good — finish that,
    but the hover label must not obscure content.)

## A. New capabilities (continued)

28. **Beneficiary intake by VOICE + AI + photos.** Nur or the field team must be able to add a
    child's profile by **voice note** (AI transcribes + structures it) and **photos**, capturing
    goals, age, story, program, school fees, needs, guardians: a **full per-child database record**.
    This is the Field/Data agent. Ties to impact reporting + child-sponsorship + the brain. PII and
    consent are critical here (children's data).

29. **Team members need full records** (same depth as beneficiaries): salary, responsibilities,
    history, engagement duration / tenure (start date), plus voice/AI intake. Today the form is only
    name / role / email / phone. Make Team a real HR-lite record (who does what, what they cost,
    how long, their history). Likely same voice+AI intake pattern as beneficiaries (#28).
    **REFINED 2026-05-26:** ~**16 team members + 10 tailors** to account for. Each member gets a
    **timeline**: ongoing tasks, pending, done, **payment history**, responsibilities, engagement
    duration. **Entry channel = the WhatsApp bot** (being set up, hopefully today): team "comes in"
    via the bot and their info auto-populates their record + timeline. Build the records + timelines
    now so WhatsApp can feed them later. Account for their work, tasks, and pay.

## Today's scope (founder wants the project "completed today")
WhatsApp / Canva / Google Drive = LATER (his call). Today = improve what's there + agentify it
truthfully. Keep import paths: drop receipts/invoices/photos on the portal (store in Supabase) and
LINK external (Drive/Dropbox/Photos URLs, since his media is scattered) so the AI can use them.
"Drop it on the portal and it creates what you need and sends it" is the Document/Report Studio goal.

## Cross-cutting pattern emerging (entities should be RICH + AI-intake)
Donors, Beneficiaries, Team are all currently thin. He wants each to be a deep record with
AI/voice/photo intake, full history, and everything that matters about that entity. The platform =
a memory-rich CRM/brain, not thin forms.

30. **Donor profile should carry an AI DRAFT, not a blank composer.** Sasa pre-drafts the
    context-appropriate message (a thank-you, or whatever the situation calls for) right there on the
    profile, ready to edit/send. Same on any entity where she'd write.
31. **Universal "Improve with AI" on anything typed manually.** Wherever Nur writes by hand (donor
    composer, inbox reply, any email/text field) there must be an "improve with AI" action.

## Scope note
Multi-tenant / white-label PARKED for now (his call 2026-05-26). Focus = improve THIS build,
especially design flaws + logic. Resale considered later.

## D2. Agentification — TRUTHFUL state (I overstated this; correcting the record)
"Agent mesh / agentic ecosystem" was hype. Real state, from `app/api/agents/tick/route.ts`:
- **Comms agent — REAL.** 5-min cron: reads new inbound mail, Claude classifies+drafts, grounds in
  past approved replies, assigns autonomy lane, files to Needs You, auto-sends only on `auto` lane.
- **Donor Steward — REAL but MISLABELED "soon"** on `agents/page.tsx:12` (it actually fires in the
  tick, `:101-130`). UI lies about its own agent. FIX the badge.
- **Sasa/Conductor — HALF.** Auto-writes the daily brief on cron (real); the chat is reactive only.
- **Grant discovery — autonomous daily**; grant PREP is a manual button (not autonomous).
- **Content / Fundraising / Field-Data agents — NOT BUILT.** Placeholder cards w/ "soon" badge
  (`agents/page.tsx:13-15`). No engine.
- **Actuator gap:** the ONLY real-world action is email (Gmail SMTP). WhatsApp / socials / Drive /
  Canva NOT connected, so "controls other platforms" is not true yet. Agents draft + write to DB.
- **Built + real underneath:** event bus, gated action_intents, autonomy dials, memory table (Comms
  learns). Solid plumbing, undersused. Same disease as the audit: substance oversold by surface.
Net: of 6 agents shown, 2 real, 1 half, 3 placeholders. One loop, one actuator (email).

## ROUND 2 — post-build review (2026-05-26 afternoon, all 7 phases shipped). DO NOT START; opinion requested.

32. **In-app TAB / focus system (the big one).** Expanding a grant review, a Needs-You reply, a "View",
    or a profile must open a **full in-app tab**: mid-screen centered, background BLURS, **minimizable**,
    close/minimize returns to original size. Collect open ones in a **tabs area** (he's open to a
    dedicated "side for tabs" / workspace and asked my opinion). Replace the small left-aligned popups.
33. **PERFORMANCE — critical + recurring.** When an activity runs (e.g. grants "Preparing…"), she must
    be able to **leave the tab / navigate away with zero lag**. "I cannot be stuck on a page because
    something is happening in the background." Long actions must be ASYNC/background; UI never blocks.
    Must feel smooth + fast. (Root: synchronous server actions + force-dynamic block nav.)
34. **Grants Researching cards: remove "Prepare application" + "Move to drafting"** — prep is automatic
    now. Only **Prepared·review** carries the action; clicking "Review" opens a **full tab**.
35. **Grant cards are tacky / messy** → clean, calm card design.
36. **Grants scroll horizontally** (left/right), not vertically.
37. **Grant-aware ONBOARDING.** Study what most grants actually require (info types, reports, documents
    to standard — org reg, financials, impact data, budgets), ASK for those during onboarding, and
    GENERATE them to standard so they're ready when a grant needs them.
38. **Duplicates STILL showing** ("Reply to sameer patil" ×many in Needs You). The code dedup stops NEW
    dupes but did not clean EXISTING duplicate approvals in the DB. One-time cleanup (keep one per
    message_id) + verify the guard actually fires.
39. **Top-right redundancy:** remove the redundant **notification bell**; remove one of the **two search**
    affordances (the contextual "Search" duplicates the top ⌘K omnibox). Keep "Ask Sasa".
40. **Centering:** the Needs-You expand popup is small + left-aligned (#143/#146) and the donor profile
    peek should be **mid-screen center** (#148). Ensure EVERY expand/peek uses the centered Modal; find
    and fix any that didn't migrate.
41. **Tab strip shows raw UUIDs** ("Fad65b6d 4ba4 49a6 A…", #149) — show a real title or remove the tab.

42. **Floating nav scroll bleed — GLOBAL (every page/function, his emphasis "fix throughout").**
    On scroll-up, page content shows ABOVE/behind the floating pill nav (transparent gap above the
    nav). Fix once at the shell/nav level (opaque masked strip above+behind the floating nav, or fix
    the scroll container offset) so it corrects ALL routes at once. Owned by R2-2 (nav/shell agent).

43. **Studio docs attachable to emails.** Document Studio output must be downloadable/attachable
    (PDF) so a generated doc can be attached to an outbound email when needed (inbox reply, donor
    composer, grant submission). Wire Studio output → the email send path. (R2-5 email pass.)
44. **Branded email signature.** Outbound emails need a custom signature block with the Nisria /
    Maisha / AHADI logo + org details, auto-appended (per account). (R2-5 email pass.)

## ROUND 3 — post-Round-2 review (2026-05-26 eve). Grouped into SYSTEMIC root causes (not 30 patches).
Core principle (his): a fix in one place must not recur elsewhere → ONE shared primitive per behavior, used everywhere.

**P1 — ONE canonical FocusTab** (the Needs-You-tab IS the reference standard). Centered, correct backdrop blur,
BIG (not small), minimize→tabs, prev/next arrows to move between sibling ready items without closing, compact card
shows minimal (no Attach/Decline) and the FULL actions appear only when maximized. EVERYTHING openable uses it
EXACTLY: grants Review, opportunities View, Needs-You expand, donor messages/profile, documents, reports.
(imgs 151,152,153,154,157,159,166; card-button alignment "Pursue/View same level" 163.)

**P2 — Tooltip/hover text invisible** on minimize/X and throughout (155,156). Global tooltip primitive, readable.

**P3 — ONE AI-output contract** at the single exit point of all generated text: NO hyphens/em-dashes/"----",
NEVER leave placeholders ("[Current Date]", "[Organization maintains contact details]" 168,169), insert the REAL
date, resolve merge tokens so {{first_name}} is NEVER shown to her (183), human tone, never reveal it is AI (168).
Applies to grants, studio, reports, newsletter, drafts, improve. (166,168,169,181,183.)

**P4 — ONE now()/timezone service** from login IP, a live running clock; all dates/deadlines/cover-letter dates use
it and roll day by day until submitted (164,168).

**P5 — Reliable background jobs + LIVE activity.** Grants not finishing/populating (162,167); the focus tab + app
must feel ALIVE showing what the agent is doing, not just enlarge a card (166,167). Make prepare reliably complete;
surface live progress.

**P6 — Smart Mode = a REAL tool-using agent** (173,174): type → it DOES things (create/assign tasks, draft+send
gated emails, populate records, update data, answer with live data). Claude in the background acting within the
platform structure. Not navigation cards.

**P7 — ONE ingestion pipeline**: voice + BULK document upload → AI routes content into the right brain sections /
records / library; first-login bulk import; WhatsApp bot is just another input that populates categories with
clear instructions + per-team-member attribution + bulk AI processing (175,177,178,180).

**P8 — "Render, never show code"**: signature + logos + docs always LIVE PREVIEW; raw HTML only behind an advanced
toggle. Logo upload area in onboarding with live preview (158,180).

**P9 — Design-system pass**: premium HD/glass icon set (NOT generic AI emojis), consistent sub-headings/titles/
word+text alignment, formatting/structure audited deeply; floating Sasa orb must NOT touch cards anywhere (172,181).

**P10 — Multi-entry records**: grant-readiness + programs/impact accept MULTIPLE entries (different projects),
stored visibly, open in big focus tabs (181,182).

**P11 — Reports/invoice builder** (170): configurable — choose what report is made + how it looks; issue invoices
to other companies.

**P12 — Zanii integration stub** (171): a place where Zanii key details integrate; code coming later, stub the shape.

**P13 — Search/⌘K blurry/malfunctioning** (176): fix the command palette render.

**P14 — Email compose completeness** (184): edit/work the message, signature always present, always show which
account it sends from (also on grant/Needs-You sends, 168).

Meta asks: act like a senior dev (Google-grade), be CONSCIOUS not blind, surprise with proactive suggestions,
audit deeply, consistency everywhere. He said "can u implement this" + "whats your thought / surprise me."

## ROUND 4 — 2026-05-26 night. RECURRENCES (things I claimed fixed that came back) + new. Be conscious.

**R-recur-1 (CRITICAL credibility) — em-dashes STILL in grant text (187).** humanize ran at GENERATION only;
STORED grant/doc packages (grant_applications.notes, studio_documents) made before R3-2 still contain "— —".
ROOT FIX: humanize at RENDER time (clean on display, regardless of when generated) AND re-clean existing stored
rows. Same class as the dup-approvals "fixed code not data" miss.
**R-recur-2 (CRITICAL credibility) — ⌘K search STILL bottom-left / blurry / broken (176→194).** R3-1 changed the
palette color+z-index but NOT its position. Still renders wrong. Either make it a proper CENTERED crisp overlay
(reuse Modal positioning) OR remove ⌘K entirely (he said: fix for real or remove). Verify the actual rendered
position this time, not the symptom I assumed.

**R4-1 — Tabs TRUNCATE content (185,186,188 "across the board").** FocusTab body cuts text off / "there is an end";
the "In reply to" original is sliced (e.g. to 1200 chars showing "- " then nothing). Make every FocusTab scroll the
FULL content; stop slicing message/original bodies. Applies everywhere (it recurs board-wide).
**R4-2 — Card overlap (195).** Studio "Recent documents" card overlaps; ensure no overlapping cards ANYWHERE.
**R4-3 — Outdated grants shown (189).** Prepared/opportunity grants include expired deadlines (Dec 2024, Jun 2025;
it is May 2026 via now()). Filter out past-deadline grants.
**R4-4 — AI inventory intake (190).** Inventory has no AI add; wire the R3-4 ingestion (voice/photo/bulk + AI) into
Inventory so stock can be added by AI, attributed, bulk.
**R4-5 — Dead pages: functionalize or REMOVE (191).** Anything not connected/used (Outreach "0, nothing logged",
audit Content/others) must either get real functionality or be removed. No dead ends.
**R4-6 — Real donation link (192).** Resolve [LINK] to the real Givebutter / give.nisria.co donation URL (a stored
setting), auto-inserted in newsletter/emails. humanize already removes [LINK]; give it the real value to insert.
**R4-7 — Draft cards: scroll + edit + improve (193).** Draft/content cards must scroll to see all + edit + improve
in the FocusTab. And REMOVE the "Prepared with the Nisria Document Studio" footer/watermark from created docs
(reveals it is AI/tool-made; no one outside should know).

**R4-8 — Brand/letterhead select too narrow (196).** The "Nisria letterhead" dropdown on Studio cuts its own text
("Nisria letterhea⌄"). The select must fit its content (auto/min width). Part of the truncation/cut-text class.

**R4-9 — Grant agent must READ the actual opportunity + tailor the ask (197, CRITICAL quality).** buildApplication
writes generic packages (e.g. "$500,000 over 36 months") WITHOUT reading the grant's real terms. It must extract +
store + use: **award ceiling/floor** (e.g. $67,500/$67,500 → request within the ceiling, NEVER above), the funder's
**actual purpose/category** (e.g. "Public Diplomacy / Educational and Cultural Exchange", not child-protection),
**eligibility** (flag if Nisria is not eligible), expected #awards, and the real **deadline**. grants.gov detail has
these fields; fetch/parse them. The application's requested amount + framing must match the specific grant. A $500k
ask on a $67.5k grant is an instant rejection. "Make sure."

PRINCIPLE NOW ENFORCED: clean + render at the DISPLAY layer (humanize-on-render), not only at generation; and any
data-class fix must RE-CLEAN existing rows, not just new ones. Verify the EXACT thing shown, not the assumed symptom.
There is a CLASS of "text gets cut" bugs (tab bodies, sliced originals, narrow selects, overlapping cards) — fix it
as one pass: nothing truncates, everything scrolls or fits, no overlap, audited on the live rendered page.

## Instruction
GO given 2026-05-26 PM. Round 2 building sequentially (R2-1 speed → R2-2 focus-sheet+tabs →
R2-3 grants/chrome/dupes/#42 nav-bleed → R2-4 grant-aware onboarding). Ping when Round 2 done, then
carry on to remaining actionable backlog (true PDF, QA sweep) until exhausted; flag the
his-input-blocked items (WhatsApp number, Canva/Drive keys) rather than faking them.

---

## Round 5 (2026-05-26, evening screenshots 198-206) — verified live

Founder on a walk, "expect to see all sorted." Each fixed as a shared-primitive
class so it cannot recur.

- **R5-1 Reply not changing on prev/next (198-201).** Root: `ReplyEditor` keeps
  subject/body in `useState`; stepping to a sibling reused the same React tree
  position, so state never re-initialised (the To/incoming updated, the editable
  fields stayed stale). Confirmed via DB the drafts ARE distinct + correct per
  recipient (Vrundaa=apparel, Havar=$500 thank-you, Global=STP). Fix CLASS:
  `FocusSheet` keys `.sheet-body` by `open.id` so any sibling swap REMOUNTS the
  body. Applies to every sibling set (replies, grants, donors).
- **R5-2 Tasks composer (202).** Empty-state restructured to a flex column: "No
  open tasks." centered, the Ask-Sasa entry bar pinned bottom-center.
- **R5-3 Minimized tabs haunt every page (203).** Two causes: (a) `goSibling`
  opened a new-id sheet and minimized the old, trailing a "Reply to …" tab per
  step, now swaps in place (close old, open new); (b) sheets persisted across
  navigation, now cleared on pathname change in `tabs-context`. Route tabs (route
  backed) still persist; only in-memory sheet overlays reset.
- **R5-4 Recent-docs overflow (204).** Real cause was horizontal text overflow
  (the inner flex lacked `min-width:0`), not z-index. `StudioDocCard`: flex
  `min-width:0`, button `overflow:hidden`, prompt → 2-line clamp + break-word.
- **R5-5 Letterhead select clipped (205).** Studio brand select min-width 168→200.
- **R5-6 Grant/settings tab title clipped (206).** `FocusSheet` header now STACKS
  title over titleExtra; title wraps (2-line clamp, break-word) at full width.
  `GrantPeek` renders the long funder program as muted wrapping text, not a giant
  badge that squeezed the title.
- **Bonus em-dash recurrence (the founder's #1 rule).** Found em-dashes in: stored
  pre-gate thank-you subjects, the AI daily brief ("decisions—worth a quick scan"),
  the dock tooltip, and several static prose strings. Closed the CLASS at every
  layer: send chokepoint (`sendEmail` strips dashes on every send, brackets
  preserved), generation (`conductor` brief now humanized), render (`getBrief`,
  `ReplyEditor`, `ApprovalCard` strip on display), data (re-cleaned 3 pending
  approval rows, brackets like "[STP 10th Cohort]" preserved), and swept all
  visible prose em-dashes in source. Live: home HTML em-dash count 0 (was 2).
- Latent bug fixed in passing: compact-card "Approve & send" sent empty subject/body
  (overwrote the stored draft with blanks); `decideApproval` now only treats
  subject/body as edits when the form carried them.
