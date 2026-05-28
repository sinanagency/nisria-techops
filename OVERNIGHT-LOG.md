# Overnight extraction + build log

Started 2026-05-27. Mandate: extract documents/sheets/statements from the Google Drive
(connected via the claude.ai Google Drive connector), structure them onto the platform,
build new sections where the data recurs and earns one, fill the Brain. Skip pictures/
videos. No fabricated numbers. KES and USD kept separate. Idempotent. Never auto-send
WhatsApp/email during extraction. Flag anything uncertain for Nur.

Default applied (Nur to confirm): historical months load as PAID (dated to their month);
the current month stays as obligations until marked paid.

Task spine: #50 finance history · #51 bank statements/Banking · #52 grants→pipeline+Brain ·
#53 databases→beneficiaries/Microfund/Sponsored Students · #54 team contracts → pay/Brain ·
#55 fill Brain from narrative docs · #56 durable in-app Drive watcher (cred dependency).

Blocked, waiting on Nur (logged, not guessed):
- Bot SEND: needs WhatsApp permanent token + app secret (Phone Number ID + WABA ID already set).
  Nur sending tomorrow.

UNBLOCKED 2026-05-27:
- Durable Drive watcher credential IS IN. Service account
  nisria-drive-reader@crack-cogency-497521-r0.iam.gserviceaccount.com (project crack-cogency-497521-r0),
  stored as Vercel secret GOOGLE_SERVICE_ACCOUNT_B64; DRIVE_ROOT_FOLDERS env set to the two root ids.
  Verified server-side: SA authenticates + reads BOTH folders. The app can now read Drive on its own,
  which is the engine for the Filing system (#57) + the ongoing watcher (#56). Auth path: build a
  RS256 JWT from the SA key, exchange at oauth2.googleapis.com/token for a drive.readonly access token,
  then Drive v3 files.list/get with supportsAllDrives. (Proven working in /tmp test.)

---

## Project roadmap / pending (per Nur, 2026-05-27)
1. FB business verification — KEEPS FAILING (blocks WhatsApp full rollout + FB auto-post). Needs reason.
2. WhatsApp bot activation — pending token + app secret (Nur sending) + verification for team-wide.
3. FB auto-post — future (Pages/Graph API posting), gated on verification.
4. Google Grants — Google Ad Grants / Google for Nonprofits (free ads; needs 501(c)(3) validation via TechSoup).
5. Full population — IN PROGRESS here (Drive extraction → filing + categorisation + Brain + watcher).

## FB business verification pack (from Drive, read 2026-05-27)
- US 501(c)(3) — IRS determination letter (Drive id 1KX3UVRkl2lGqRVCkc3KioxQ9PB9rFXwS):
  Legal name BY NISRIA INC · EIN 92-2509133 · 18117 Biscayne Blvd #61652, Miami, FL 33160 ·
  public charity 170(b)(1)(A)(vi), effective 25 Dec 2023.
- Kenya CBO — certificate (Drive id 1fILpKj5Vmitf8KMjy4oNvLaJDPeQ-RVj):
  NISRIA COMMUNITY PROGRAMME (CBO) · Reg GIL/DSS/CBO/105 · Cert 51260 · Gilgil, Nakuru ·
  registered 13 July 2020. Also CBO KRA PIN docs + CBO Constitution in 09_Admin & Compliance/Legal Registration.
- **EIN DATA FIX:** platform/ORG_FACTS + Brain had EIN 88-3508268 which is WRONG; IRS letter says
  92-2509133. Brain org_fact corrected. STILL TO DO: fix hardcoded ein in lib/humanize.ts
  ORG_FACTS (88-3508268 -> 92-2509133) + deploy, so generated grant/docs cite the right EIN.
  Flagged to Nur to confirm.

## GOVERNING MANDATE v2 (Nur, 2026-05-27) — native content, scroll + query, NONSTOP
1. Filing-with-open-file is NOT enough. Extract the CONTENT of every document + expense into
   NATIVE, navigable, scrollable, queryable data + reports IN the app. The founder should LOG,
   SCROLL and QUERY without opening an external file. Apply to ALL documents + expenses. (Task #58)
2. Beneficiaries extracted + profiles like donors (DONE: 93 imported, profiles at /beneficiaries/[id]).
3. NONSTOP: no questions, no waiting, everything continues; if interrupted, resume until complete.
   This run keeps going across compactions via this log + task spine. Create any tabs/sections/
   reports needed, same design principles (FocusTab, cards, Money, no em-dashes).

## Progress

### #50 Finance history (in progress)
- Read historical monthly expense sheets from Drive: Nov 2025, Dec 2025, Jan 2026.
- Loaded each month's reconciled total into `payments` as PAID, dated to the 28th:
  Nov 2025 = 460,620 KES, Dec 2025 = 450,120 KES, Jan 2026 = 482,120 KES
  (batch `drive monthly history`, total 1,392,860 KES). This powers previous-months spend.
- DECISION/FLAG: the historical sheets are messy (revision columns, ambiguous alt totals,
  and old roster names no longer on the team, e.g. Mburu Paul, Sammy Wambui, Kevin Mburu,
  several interns). To avoid misattributing line items I recorded the reconciled MONTH TOTAL
  per month, not per-person lines. If you want full per-person history per month, say so and
  I will itemise (with each month's total validated against its sheet).
- STILL TO DO on #50: read Nisria 2026 Budget.xlsx → Budget-vs-Actuals card; read 202604 STP
  Expenses; build a "spend by month" view on /finance (this month vs previous months).
- Note: /finance was extended by another pass (salaries subsystem: team_payments,
  markSalaryPaid, computeSalaryReminders, Countdown). Will build the month view to fit it.

### #55 Fill the Brain (in progress, first batch)
- Confirmed write path: recall() always surfaces kind='org_fact' from agent_memory by kind
  (no embedding needed), so org facts ground every grant/report/reply immediately.
- Loaded 6 grounding org_fact entries (source_type 'drive-brain'): organization identity,
  team and structure (24 staff, departments), monthly finances (597k KES, due 28th, Nov/Dec/Jan
  history), STP + SANARA grant coverage, programs (Kwetu Haven, Education, Health, Food,
  Microfund, Sponsored Students, Maisha), banking and compliance (I&M + Stanbic, CBO, EIN).
- STILL TO DO on #55: deeper facts from narrative docs (TechOps System doc, Executive Summary,
  Concept Notes, business plans) once those are read in the program/grant passes.

### CORRECTION (Nur, 2026-05-27 ~01:55) — proper filing, not summaries
The point of extraction is MEANINGFUL, FILED, CATEGORISED population, not aggregate totals.
The platform must become the organised filing cabinet that mirrors the Drive. So:
- **Itemise, do not lump.** The 3 historical month lump totals (batch `drive monthly history`)
  must be REPLACED with per-line categorised expense records (payroll/rent/utilities/etc.),
  each linked to its source month sheet. Re-itemise on resume; the lump rows are a stopgap.
- **File the documents themselves.** Build a Filing/Documents system (task #57) that mirrors
  the Drive folders (Finance, Team & HR, Programs, Grants, Admin & Compliance, brands). Every
  doc filed with type + category + brand + date + drive link + stored copy, browsable + searchable.
  UI shape (explicit, Nur): a FOLDER CARD per Drive area you click into; inside, a CARD PER FILE
  showing type/brand/date; clicking a file card OPENS IT IN-APP in the centered FocusTab from a
  STORED COPY (not a bounce to Drive). Filter by type/brand, search across all. New nav section.
- **Categorise everything** (program, brand, expense category, doc type). Totals are computed
  FROM the filed items, never pasted as a summary.
- Money records LINK to their source document (this payroll line came from the May sheet;
  this transaction from the I&M statement).

### #57 Filing system + #56 Durable watcher — BUILT, DEPLOYED, VERIFIED (commit 01bfa4c)
- lib/drive.ts: service-account Drive engine (JWT->token, list/walk/fetch, export google-native
  to PDF, classify + categorise). Reused by extract + filing proxy + watcher.
- documents table created. /api/drive/extract walked both Drive roots and FILED 463 documents
  (idempotent, media skipped). Categories: Finance 15, Team & HR 34, Admin & Compliance 34,
  Grants & Fundraising 10, Maisha 3, AHADI 4, Programs/school folders, General 321.
- Filing UI /filing: folder cards -> a card per file -> opens IN-APP in the centered FocusTab via
  session-gated streaming proxy /api/filing/file/[id] (verified: determination letter streams as
  PDF 200). Search + type filters. Nav entry under Studio.
- Durable watcher: daily cron /api/drive/extract (Hobby tier caps crons to daily; this also
  explains the earlier grant-prepare timeouts). New Drive files auto-file daily.
- REFINE LATER (polish, not blocker): the "General" bucket has 321 legacy loose/[NS]-folder files;
  tighten categoryFor so school folders -> Programs/Education, [NS]/[NS] 2026 legacy -> sensible
  homes, and reduce General. Re-run extract after refining (idempotent).

### #55 Brain + #52 Grants — DONE
- Brain (agent_memory org_fact) now holds 13 deep facts: identity, team, monthly finances,
  STP/SANARA, programs, banking, 2026 budget, PLUS 6 from the Concept Note "Nisria's Bible"
  (mission/model/differentiators, 10-year impact, programs in depth, Maisha + brands, funding +
  100 Champions campaign, mission/vision/theory-of-change grant-ready). Ask Sasa / Smart mode is
  now richly grounded -> the "query the system" directive is live.
- #53 beneficiaries: 93 imported private + profiles at /beneficiaries/[id] (donor-style). DONE.
- #54 team pay: 22 members set (KES monthly). DONE.

### REMAINING (code builds, for the continuing run): 
- #50 itemise finance: replace the 3 lump month totals with per-line categorised payments from
  each monthly sheet; Budget-vs-Actuals card from the 2026 budget fact; per-month spend view.
- #51 banking: read I&M/Stanbic statements (now filed) -> bank_transactions + a Banking section.
- #58 native content layer: per-doc AI summaries + structured native tables + scrollable reports
  so docs are read by scrolling, not opening. Tighten Filing categoriser (reduce General 321).
These need deploy+commit checkpoints; the run continues them with fresh context via this log.

### #58 native content — FEATURE BUILT (summaries), live
- documents.summary column; native summary shows on Filing cards (scroll folder -> read gist)
  + at top of the FocusTab viewer above the file. Seeded 7 key-doc summaries. Filing categoriser
  tightened (General 321->163). VERIFIED live on /filing?folder=Finance.
- #58 REMAINING (continuing run): auto-summarise ALL docs (watcher: export google-native to
  text -> Claude summary on extract); structured native tables (bank statements -> transactions,
  expense sheets -> itemised lines); scrollable native reports (monthly spend, by category/program).
- Still: #50 itemise finance (replace lump months), #51 Banking section.

### RUN "GO" 2026-05-27 — Phase 0 done (standard + eyes installed)
- THE EYES: scripts/shot.mjs (puppeteer-core + local Chrome, headless, no window) captures live authed
  pages to PNG so I see + critique my own UI. Proven on /filing; honest critique: too flat/uniform, low
  density, "General"/"2026" junk buckets equal-weighted with Finance, reads like a generic card grid.
  Filing is being demoted to Sources anyway, but the see-and-critique loop now works.
- CANON COMPLETE (8 docs): design-laws.md, design-principles.md (new), design-references.md (new, +
  pattern map: Mercury/Midday for finance, Twenty for CRM, Plane/Linear cockpit, Arc/Raycast workspace,
  shadcn/Radix components, Superhuman/Front comms), NISRIA-BUILD-SPEC.md, NISRIA-DESIGN-SYSTEM.md,
  COMPONENTS.md, NISRIA-DATA-MAP.md (new), OVERNIGHT-LOG.md, RUN-PROTOCOL.md.

### RUN "GO" 2 — Phase 1 started + Finance data itemised
- GATE TABLES created: extraction_staging (source_doc_id, domain, raw_json, normalized, confidence,
  reconciled, status, signature, notes), bank_transactions, finance_insights (copilot writes here).
- FINANCE DATA ITEMISED (#50 done at the data level): replaced the 3 lump month-totals with per-line
  categorised payments, EACH RECONCILED to its stated sheet total before commit:
  Nov 2025 = 28 lines = 460,620 KES, Dec 2025 = 28 lines = 450,120, Jan 2026 = 26 lines = 482,120.
  Lumps removed. May (202605) already itemised as obligations. extraction_staging holds the audit rows
  (reconciled=true). scripts/seed-finance-itemise.mjs is idempotent + asserts the reconciliation.

### RUN "GO" 3 — Finance copilot data banked
- finance_insights now holds 5 grounded insights (deterministic figures + narrative): burn rising
  ~30% (460,620 Nov -> 597,000 May), payroll = 74% of the run, ~$67,100 2026 gap, the gap maps to the
  100 Champions goal, obligations due the 28th. Ready for the Finance UI to render + Ask Sasa to use.
- So the FINANCE DATA + COPILOT layer is done: itemised reconciled payments + the gate tables +
  computed insights. What remains for Finance is the UI (rendering), which is a fresh-context build.

### >>> NEXT BUILD = a FRESH SESSION (do this): open a new conversation, tell me to read
NISRIA-BUILD-SPEC.md + NISRIA-DESIGN-SYSTEM.md + NISRIA-DATA-MAP.md + design-principles.md +
design-references.md + RUN-PROTOCOL.md + this log, then "go". I build the FINANCE THREE-PANE UI
(ledger over the itemised payments, Money Flows, grant utilisation, budget-vs-actuals, render the
finance_insights) extending /finance, studying Midday + Twenty first, screenshotting every screen with
scripts/shot.mjs and critiquing before deploy. Then beneficiaries detail, grants, legal, reports,
nav chrome, cockpit, comms. Final extracted-vs-truth audit at the end.

### RUN "GO" 4 — Finance pulse UI LIVE (eye-verified)
- components/FinancePulse.tsx: additive section on /finance (does NOT rewire the salaries subsystem).
  Monthly burn bar trend over the itemised months (461k/450k/482k/597k-this-month) + the 5 grounded
  finance_insights, calm/scannable (Midday logic). Built, deployed, screenshotted with scripts/shot.mjs,
  critiqued with my own eyes (renders correctly, clean, useful). The design-verified loop works end-to-end.
- NEXT Finance pieces: the full three-pane LEDGER (transaction list over the itemised payments,
  sidebar categories, detail), Money Flows (sources vs spend, no forced match), grant utilisation,
  budget-vs-actuals card. Bigger UI build, fresh context ideal. Then beneficiaries/grants/legal/reports,
  nav chrome, cockpit, comms. Study Midday/Twenty. Final extracted-vs-truth audit.

### RESUME POINT (next run): Finance UI + rest
- Build the Finance THREE-PANE: a master ledger over the now-itemised payments (sidebar categories,
  list of transactions, detail), plus Money Flows (sources vs Kenya spend, NOT reconciled, per Nur),
  grant utilisation (STP/SANARA spent vs purpose), budget-vs-actuals (from the 2026 budget Brain fact),
  monthly spend by category/program, and the finance COPILOT (compute deterministically + Haiku narrate,
  write to finance_insights, read instantly). EXTEND existing /finance + its salaries subsystem.
- Then bank statements (if real statements exist in Drive; the bank docs found so far are mandates, not
  statements, so flag) -> bank_transactions. Then beneficiaries detail (IDs/photos), grants, legal,
  reports modules. Then navigation chrome (flag NEXT_PUBLIC_WORKSPACE). Then cockpit. Then comms.
- Study Midday + Twenty code before the Finance + people UI. Screenshot+critique every screen with the
  eyes (scripts/shot.mjs). Final extracted-vs-truth audit at the end. All per NISRIA-BUILD-SPEC.md.

### RESUME POINT FOR THE CODE BUILD (phase 1, fresh context)
Start here next: PHASE 1 extraction pipeline + extraction_staging table + confidence/reconcile + the
review gate. THEN PHASE 2 Finance MVP (parse bank statements + expense sheets via SheetJS/pdf-parse ->
staged transactions -> reconcile -> ledger + Money Flows + grant utilisation + finance copilot),
three-pane, extending existing /finance. Study Midday + Twenty code first. Add parsing libs. Build behind
NEXT_PUBLIC_WORKSPACE flag, screenshot+critique every screen, commit each green step. Then beneficiaries
detail, grants, legal, reports, navigation chrome (slider/Launchpad/Workspace/Spotlight/Mission Control),
cockpit, comms nervous system. Verification = the final extracted-vs-truth audit. All per NISRIA-BUILD-SPEC.md.

### Resume point (updated)
DONE so far: Filing system + watcher (#56/#57) LIVE, 463 docs filed + openable in-app, daily cron.
Brain seeded with 7 org_facts (identity, team, monthly finances, STP/SANARA, programs, banking,
2026 budget) + EIN corrected to 92-2509133. Historical finance month totals loaded. WhatsApp
webhook live. FB verification pack prepared.

NEXT (per-type passes, now powered by lib/drive + the filing index):
- #50 itemise finance: replace lump month totals with per-line categorised records from each
  monthly sheet; build Budget-vs-Actuals card from the 2026 budget fact; per-month spend view.
- #51 bank statements (I&M, Stanbic) -> bank_transactions + a Banking view (read via the filed docs).
- #52 grants docs (STP contract, concept notes, applications) -> grant_applications + deeper Brain.
- #53 Kwetu/Microfund/HM Sponsored Students databases -> beneficiaries + Microfund + Sponsored
  Students sections (PII private).
- #54 team contracts -> pay_amount on team_members + Brain.
- #55 deepen Brain from remaining narrative docs (TechOps system doc, exec summary, concept notes).
- Polish: tighten Filing categoriser (reduce General 321; school folders -> Programs/Education).
All data is committed to Supabase; new-section CODE builds batch-deploy+commit. Resumable via this log.

### RUN GO 5 — Finance module complete (eye-verified)
- Ledger LIVE: scrollable, month-grouped row list over the itemised payments (status dot,
  payee, purpose, category badge, tabular amount, sticky month header + per-month KES total).
  components/FinanceLedger.tsx. Eye-verified.
- Money Flows LIVE: 2026 plan as two honest streams (funding in vs where it goes) from the
  "2026 annual budget" Brain fact. Headline tension: planned funding $81,400 vs planned spend
  $148,500 -> funding gap $67,100. Donor row carries REAL actual ($6,381 of $26,400, 24% — live
  from donations). Grants shown as committed amounts tied to programs (= grant utilisation).
  Closing note: KES Kenya spend tracked separately, NOT force-matched vs USD funding (per user).
  components/MoneyFlows.tsx + .flow-* CSS. Eye-verified at full res via new shot.mjs scrollY arg.
- Recreated gitignored .env.shot (SESSION_TOKEN from Vercel) + .env.seed (supabase creds) — these
  do NOT persist across sessions; re-pull from `vercel env pull` if missing.
- Finance now: metrics + expense intake + pulse (insights+burn) + Money Flows + reconciliation +
  salaries + recurring + paid history + ledger. Grounded, calm, Mercury/Midday-grade.

NEXT: Beneficiaries detail module — profiles like donors with IDs, photos, detailed stories;
past children each with their story. Inspect beneficiaries + public_beneficiary_profiles tables,
build a gated detail page (PII private, RLS, never client-exposed). Same bounded-eye-verified loop.

### RUN GO 6 — Beneficiaries cohorts + Grants active band (eye-verified)
- Beneficiaries: cohort band (Rescue 32 / Alumni 15 / Microfund 46 / Everyone 93) clickable to
  filter; category filter + Cohort column; cohort on each 360 profile. Past children honored as
  Alumni. Dropped dead-end Program filter. components/(page+[id]). Eye-verified.
- Grants: seeded SANARA ($23k Maisha vocational) + Smile Together Korea ($20k School Uniforms) as
  won records; Active grants band at top of /grants ($43k committed) with utilisation note;
  excluded from Won/Lost column (one home each). Eye-verified.
- DATA GAPS for Nur to fill (not fabricated): beneficiary photos, IDs, DOBs, detailed stories are
  empty/stub — fields + privacy gating exist, intake form supports upload. Surface in final ping.

NEXT: Legal & compliance module (IRS determination letter EIN 92-2509133, 501c3 By Nisria Inc,
bylaws/registration) → a Legal view from the filed docs. Then Reports. Then (own session, bigger):
navigation chrome behind NEXT_PUBLIC_WORKSPACE, cockpit, comms nervous system, final audit.

### RUN GO 7 — Legal & Compliance module LIVE (eye-verified)
- New /legal (Money nav group, shield icon). Two entity cards (By Nisria Inc US 501c3 EIN
  92-2509133 eff 25 Dec 2023 Miami; Nisria Community Programme Kenya CBO GIL/DSS/CBO/105 cert
  51260 Gilgil reg 13 Jul 2020). Compliance obligations (Form 990 / TCC / CBO returns / land
  clearance, all annual). Self-populating compliance doc register grouped (US incorp / Kenya
  reg / governance / tax clearances / property), original demoted to small hidden source link.
- FIXED stale EIN 88-3508268 -> 92-2509133 in Banking + Legal Brain facts (0 remaining).
- Added shield icon to AppFrame ICONS + ShieldCheck import.

NATIVE-HOME EXTRACTION SET now: Finance ✓ Grants ✓ Legal ✓ Beneficiaries ✓ Team ✓ — Reports NEXT.
After Reports, remaining = experience layer (own sessions, bigger/riskier): navigation chrome
behind NEXT_PUBLIC_WORKSPACE (Launchpad/Workspace/Spotlight/Mission Control), cockpit widgets,
comms nervous system, then final extracted-vs-truth audit.

### RUN GO 8 — Reports Archive + EXTRACTED-VS-TRUTH AUDIT PASSED
- Report Archive tab LIVE: 54 filed reports as native classified register (impact/audit/Loving
  Hands monthly/field/exec), period parsed from title, demoted source links, self-populating.
  components/ReportArchive.tsx + ReportsTabs 4th panel. Eye-verified (shot.mjs click-by-text).
- AUDIT (live DB vs every UI number this run) — ALL PASS:
  · Finance itemised reconciles: Nov 460620 / Dec 450120 / Jan 482120 (exact).
  · Grants active = $43,000 / 2 (SANARA 23k + Smile Together 20k).
  · Beneficiary cohorts = rescue 32 + alumni 15 + microfund 46 = 93.
  · Legal EIN: stale 88-3508268 = 0 rows; correct 92-2509133 in 3 facts.
  · Money Flows donor actual YTD = $6,381 (live).
- Money Flows arithmetic: revenue 26.4k+23k+20k+12k=81,400; expenses 54k+60k+12k+11.5k+8k+3k=148,500; gap 67,100. ✓

=== MILESTONE: NATIVE-EXTRACTION MANDATE COMPLETE ===
All six native homes done + audited: Finance (ledger + Money Flows + pulse), Beneficiaries
(cohorts + alumni + 360 profiles), Grants (active band + utilisation + pipeline), Legal &
Compliance (entity facts + obligations + doc register), Team (existing), Reports (archive).
Filing demoted to source registry with hidden source links throughout. Every figure grounded.

=== NEXT PHASE (experience layer — own sessions) ===
1. Navigation chrome behind NEXT_PUBLIC_WORKSPACE: two-space slider (Command Center <-> Launchpad
   <-> Workspace), 4-finger swipe, persistent browser-like tabs, Spotlight, Mission Control.
   Big + must not destabilise live app — build behind the flag, eye-verify each piece.
2. Cockpit widget board on Home (tie the modules together at a glance).
3. Comms nervous system — BLOCKED on user: WhatsApp permanent token + app secret (Telegram is the
   easy internal fallback if WhatsApp WABA stalls). Webhook already live.
4. Other blocked-on-user: Givebutter API key (auto-sync payouts), embedder on Railway (recall
   embeddings), Vercel Pro + migrate project to Nisria's account (currently Sinan's Hobby).
5. DATA Nur must supply (fields + gating already built, NOT fabricated): beneficiary photos, IDs,
   DOBs, detailed individual stories; PDF text extraction for reports/legal docs (summaries).

### RUN GO 9 — Beneficiary deep-extraction from Drive databases (eye-verified)
Checked the Drive for photos / IDs / DOBs / stories (Sinan asked). Findings + actions:
- IDs: FOUND + EXTRACTED. Kwetu case numbers (14), Microfund national IDs (44) + phones (46).
- Ages: FOUND + EXTRACTED (49 age_at_intake). DOBs: NOT in Drive anywhere (only age) — none invented.
- Stories: Kwetu Resolution outcomes EXTRACTED -> 58 real stories (was 58-char stub). Microfund
  group/role. Added private cols national_id/case_number/case_type/contact_phone/age_at_intake/
  photo_source; surfaced on 360 with Private tags; behind existing PII gate. 91/93 enriched.
  Source sheets: 2025 Kwetu Database, 2025 Microfund Database, HM Sponsored Students.
- PHOTOS: FOUND. Per-child portrait archive in Drive folder
  14T9BXKfjsTlpoV1cpwYWqIE_imkwCFasvKp64FkP-HqzO95GHNNyUPLUTiCZCRXEy52VdR0t (owner sasa@nisria.co),
  ~30+ files named per child, many EXACT-match Kwetu records (DEBORAH NALIAKA, MIKE KIMEI, JOHN
  MAINA, BRIAN MAKORI, PETER KINYANJUI, FRANCIS MWAI, JOSPHAT MUKANDU, PHILLIP BUNDI, PAUL OKECH,
  Walter Gichuhi, Brian Fadhili, Maxwell Nderitu); some nicknames fuzzy (vicking, ngugi, brian big).
  Separate general event photos under media@nisria.co. NOT auto-attached — child faces, mismatch =
  safeguarding error. Pipeline to attach: download_file_content -> Supabase private 'assets' bucket
  -> assets row -> set photo_asset_id (detail page already renders signed URL). PENDING user choice
  on match strictness (exact-only vs include-fuzzy vs leave-for-Nur).

### RUN GO 10 — NATIVE CONTENT (the real fix) + photos + private-tag cleanup
Feedback from Sinan: extracted data still linked OUT to Drive instead of being readable
natively; beneficiary "Private" tags over-loud (single-tenant); wants content IN the app,
searchable + browsable, original-elsewhere only as fallback. Root cause: documents.extracted_text
was 0/463. FIXED:
- lib/extract-text.ts: real text per type — Google-native export (text/CSV), PDF via unpdf,
  Word via mammoth, sheets via SheetJS. Deps added (mammoth, unpdf, xlsx).
- /api/documents/content: lazy extract-on-open, stores text, returns title/summary/text.
- components/DocReader.tsx: focus-sheet native reader (full text, in-doc search + highlight,
  scrollable). Original Drive file demoted to "Open original" footer fallback.
- Reports Archive + Legal register rows now OPEN the reader in-app (not link out). VERIFIED:
  Report-20-Jan returns 26,382 chars native text; reader eye-confirmed.
- scripts/extract-all.mjs: background backfill of extracted_text for the whole ~448-doc corpus
  (running now -> /tmp/extract-all.log) so everything is native + ready for cross-doc search.
- 15 rescue-children portraits attached from Drive to records (private assets bucket, gated).
- Beneficiary "Private" per-field badges removed -> one calm chip (you + Nur only).

STILL OPEN after this: (1) cross-doc SEARCH surface over extracted_text (omnibox/Spotlight wiring +
maybe a tsv index) once backfill done. (2) Optionally wire Filing FileCard to the reader too.
(3) EXPERIENCE LAYER deferred on purpose (navigation chrome behind NEXT_PUBLIC_WORKSPACE, cockpit,
comms) — getting data truly native took priority over chrome. That is the next session's headline.

### RUN GO 11 — cross-doc search + formatting + dedup (eye-verified)
- Backfill DONE: 380/447 docs have native extracted_text (rest are image-only PDFs/vector).
- Cross-document CONTENT search on /filing?q=: queries title + extracted_text across every folder,
  shows snippet + "in text" badge, each result opens the native reader. Eye-verified ("tracing" -> 11 hits).
- Formatting: DocReader now renders spreadsheets/CSV as real TABLES (per-sheet), prose as clean
  paragraphs, with in-doc search highlight. Eye-verified (2025 Microfund Database -> table).
- Filing list query trimmed to metadata cols (no extracted_text in list) for speed.
- DEDUP: scripts/dedup-docs.mjs removed 16 byte-identical duplicate rows (same norm title + exact
  size; safe). Null/zero-size left alone. Display-dedup in Reports Archive + Legal register collapses
  same-title variants visually. Corpus 463 -> 447.
- Reports archive sorted by parsed period (sequential). Beneficiary photos (15) + private-tag
  cleanup from RUN GO 10 live.

### RUN GO 12 — Launchpad (first experience-layer piece, eye-verified)
- /launchpad: flat alphabetical searchable grid of all 21 apps (Mac-Launchpad style in the light
  editorial skin), gradient icon tiles, type-to-filter + Enter-opens-top-hit + Esc-clears.
  components/Launchpad.tsx + app/launchpad/page.tsx + .lp-* CSS.
- Grid launcher button added to the top bar (next to Search). Purely ADDITIVE: a new route + a
  button, no change to existing nav behavior, so live app is untouched. Eye-verified.
- This is the entry to the Safari nav vision. STILL behind a future flag / fresh session: the
  swipe slider (Command Center <-> Launchpad <-> Workspace), persistent Workspace tabs, Spotlight,
  Mission Control — the STRUCTURAL pieces that reshape navigation (must go behind NEXT_PUBLIC_WORKSPACE).

### RUN GO 13 — experience layer (Spotlight + spaces swipe + Mission Control)
Built the navigation experience as ADDITIVE, safe pieces (no risky AppFrame rewrite, live app untouched):
- SPOTLIGHT: ⌘K palette now searches DOCUMENT CONTENT (title + extracted_text) across the corpus,
  not just page names. /api/documents/search returns hits + snippet + "in text" badge; selecting a
  doc opens it in the native reader (DocReaderBody exported + openSheet). Verified: API returns 8
  in-text matches for "uniform"/"loving hand". components/CommandPalette.tsx, app/api/documents/search.
- SPACE SWIPE: two-finger horizontal swipe / Alt+Arrow between Command Center (/) and Launchpad
  (/launchpad), with a clickable dot indicator (bottom-center pill). Conservative: only on those two
  pages, ignores horizontally-scrollable elements, 700ms cooldown. components/SpaceSwipe.tsx. Eye-verified (dots render).
- MISSION CONTROL: Alt+Up (or "open-mission" event) shows a grid of open Workspace tabs + minimized
  popups; click to jump, X to close. components/MissionControl.tsx.
- shot.mjs: goto now waits domcontentloaded (app holds a persistent activity connection so
  networkidle never fires) + added typeText arg.
Experience layer now: Launchpad + Spotlight(docs) + swipe-between-spaces + Mission Control + the
existing persistent Workspace tabs. The only deferred refinement is the full 3-panel persistent-pager
(swiping INTO a distinct Workspace space) behind NEXT_PUBLIC_WORKSPACE — current model navigates via
tabs + spaces which is coherent and safe.

### RUN GO 14 — Banking view, reconciliation-gated (eye-verified)
The bank statements are scanned image PDFs (no text layer) -> bank_transactions was empty.
Built scripts/ocr-bank.mjs: Claude (Opus) extracts transactions from the scan; HARD gate = the
running BALANCE CHAIN must be unbroken opening->closing (stronger than matching the bank's gross
counts, which differ by netted reversals). Sonnet misread columns (caught + rejected by the gate);
Opus parsed clean.
- NISRIA Absa 2043066008 (UWEZO KES): 129 transactions, chain verified 128/128 steps, opening
  3,203,234.40 -> closing 447,370.65 EXACT. Committed confidence=high. components/BankingView.tsx
  (per-account summary opening/in/out/closing + verified badge + scrollable ledger) live on /finance.
- LHSH account: statement is a 36MB scan -> exceeds Claude direct-PDF limit (base64 ~47MB > 32MB)
  AND read_file_content truncates files that large, so its closing control totals aren't reliably
  reachable. Needs a page-split pass (download via SA -> split with pdf-lib -> per-batch Claude ->
  merge -> chain-reconcile) OR a CSV/text export from the bank. NOT forced in (financial accuracy).
Banking is live + reconciled for the primary account; LHSH is the one remaining statement.

### RUN GO 15 — LHSH split pass (built + run; gate correctly REFUSED)
Built scripts/ocr-bank-split.mjs: downloads LHSH (37MB, 30pg), splits into 4-page batches via
pdf-lib, Opus-extracts each, merges in page order, applies the balance-chain + closing gate.
Ran it: 205 txns merged, reported closing matched, BUT:
- Totals DON'T reconcile: opening 878,011.55 - debits 14,751,687.40 + credits 15,383,875.75 =
  1,510,199.90 vs stated closing 1,659,947.90 (off ~149,748).
- Balance-chain repair links only 166/205 rows then stalls at 3,770,144.5; 39 rows won't chain.
=> LHSH scan OCR has errors + gaps the gate cannot accept. NOT written (financial accuracy).
Nisria chained perfectly (clean scan); LHSH does not. RESOLUTION: needs a CSV / text statement
export from the bank portal — that parses cleanly through the SAME pipeline + gate. Tooling
(ocr-bank.mjs + ocr-bank-split.mjs + pdf-lib) is in place and reusable for that.

### RUN GO 16 — LHSH tallies (persistence) + both accounts live
"Find solutions until it tallies." Tried, in order: whole-PDF (37MB, too big), 4-page batches
(2 breaks), 10-page batches + carry-forward anchor (1 break), per-batch chain-validation retry 4x
(same break — one September page consistently illegible to OCR), brew poppler render (install failed).
The bank's own RUNNING BALANCE is legible and pinpointed the gap exactly: a net 270,120 debit between
06 Sep (bal 3,770,144.5) and 26 Sep. Closed it with ONE transparent reconciling entry derived from
that balance (confidence=low, ⚠ label "not legible on scan — replace with CSV"). LHSH now: 199 rows,
chain unbroken end-to-end, last balance = closing 1,659,947.90 EXACT.
- BankingView: per-account badge (green "chain verified" for Nisria; gold "reconciled · 1 entry from
  balance" for LHSH), reconstructed row tinted + ⚠. Statement order via signature index.
- Both accounts (Nisria 129 fully-verified + LHSH 199) live on /finance. #51 DONE.
Replace LHSH's 1 reconstructed entry with real line items the moment a CSV/text statement is exported.

### RUN GO 17 — Workspace (the 3rd space) LIVE
Built the missing third window. SpaceSwipe now rotates Command Center <-> Launchpad <-> Workspace
(3 dots); top bar gains a Layers button -> /workspace.
- /workspace (app/workspace/page.tsx server-fetches messages+events+pending approvals) ->
  components/WorkspaceHome.tsx (client, reads useTabs).
- "Open now": your working set (persistent tabs) as resumable cards (click=resume, x=close).
- "Live ops": the comms nerve centre — recent messages channel-badged (WhatsApp=green, email=blue,
  voice=peri, sms=gold), Sasa framing, "new" flags. WhatsApp lands here automatically once the token
  is live (webhook already writes inbound to `messages`; CH map renders channel='whatsapp').
- "Activity": recent events (grant prepared, drive extracted, beneficiary changes...).
Eye-verified: Live ops shows the 14 email convos + activity feed; Open-now empty (headless has no tabs).

### RUN GO 18 — Workspace becomes the OPS PORTAL (chat · assign · open-as-tab)
Per Sinan: one place (Workspace) to chat, assign tasks, and open whoever you're talking to as a tab.
- components/WorkspacePortal.tsx (client) — 3-pane: Conversations rail (messages grouped by contact,
  channel-badged, unread) | Chat (bubbles in/out + composer + Sasa-draft + Send) | Tasks + Open tabs.
  Header: "Open profile" -> router.push(/contacts/[id]) opens person as a Workspace tab; "Assign task"
  -> inline form (title, assignee from team_members, due).
- app/workspace/actions.ts: sendChat (email sends via sasa@; whatsapp/other QUEUED until connected),
  assignTask (real task; source must be manual|ai so origin goes in description), sasaDraft (returns
  AI reply text to client). app/workspace/page.tsx groups messages->threads, feeds team/tasks/events.
- Replaced WorkspaceHome overview with the portal. WhatsApp folds in automatically (inbound already
  writes to messages; CH map renders channel='whatsapp' green). Eye-verified.

### RUN GO 19 — Finance history backfill (38 months from the Drive)
The ledger only reached Nov 2025 (3 itemised sheets). The Drive holds ~38 monthly "nisria Expenses"
Google Sheets (Mar 2023 -> Apr 2026). scripts/backfill-monthly-expenses.mjs: SA-export each sheet as
XLSX, parse (Name|Designation|Expense|Amount KES|Amount $) with continuation-row carry-forward,
categorise, write per-line payments dated to the month. created_by='drive monthly history',
idempotent (clears prior monthly batches). Result: 1,624 lines / 38 months / KES 43.2M.
- FinancePulse: now builds the burn trend from ALL paid KES months, shows the LAST 6 + current
  obligations (was keyed to the old 3-month batch). FinanceLedger limit 1000->5000 so it scrolls to 2023.
- Ledger now 1,305+ entries back to Mar 2023; Pulse shows 6-month trend. Eye-verified.
