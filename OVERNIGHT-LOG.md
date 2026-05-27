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
