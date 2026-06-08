# Nisria Portal — Full Audit (2026-06-07)

*Orchestrated by Opus, executed by qclaude (Qwen3-Coder-30B) in 5 sharded passes. Findings only — no code changes until bot is fully healed.*

## Already audited separately (do not re-run)
- /tasks and /finance → see AUDIT-727-PORTAL-2026-06-07.md

## Audited in this pass
- People & Identity: beneficiaries, donors, profile, team, login, settings
- Money: grants, donations, campaigns, wishlist
- Work: calendar, cases, inbox, workspace
- Content & Comms: content, library, guide, reports, outreach, studio
- Ops & System: agents, assistant, filing, groups, inventory, launchpad, legal, memory, smart

---

# People Identity Shard

## Route: /beneficiaries

### Current affordance map
| Affordance | File:line | What it does | Who clicks | Misplaced? |
|---|---|---|---|---|
| Cohort tiles | beneficiaries:170 | Filter list by cohort | Nur | ✅ |
| Cohort count summary | beneficiaries:63 | Show total lives on platform | Nur | ❌ |
| Cohort tile highlight | beneficiaries:175 | Highlight active cohort filter | Nur | ✅ |
| Filter bar | beneficiaries:194 | Filter by program, status, consent, photo | Nur | ✅ |
| Search | beneficiaries:194 | Search by name, ref, location | Nur | ✅ |
| Table | beneficiaries:203 | List beneficiaries | Nur | ✅ |
| Intake tool | beneficiaries:226 | Add new beneficiary | Nur | ✅ |
| Toggle consent | beneficiaries:203 | Toggle public consent | Nur | ❌ |

### Findings
1. **Misplaced consent toggle in table** (P1)
   - File:beneficiaries:203
   - Problem: The consent toggle is embedded within the table row, making it hard to scan and miss during bulk operations. Consent is a critical privacy control that should be more prominent.
   - Proposed: Move consent toggle to a dedicated column or make it a visible badge with a clear toggle button in the row action menu.

2. **Inconsistent status badge styling** (P2)
   - File:beneficiaries:197
   - Problem: Status badges use `statusTone` but the styling doesn't always reflect the severity or importance of the status. Some statuses like "transitioned" should be visually distinct.
   - Proposed: Use a more nuanced approach to badge tones that better reflects the semantic meaning of each status.

3. **Missing lifecycle progression tracking** (P1)
   - File:beneficiaries:203
   - Problem: There's no visual indication of how far along a beneficiary is in their lifecycle or what the next step might be. This makes it harder for Nur to prioritize actions.
   - Proposed: Add a progress indicator or status progression bar that shows where each beneficiary stands in their program journey.

4. **Insufficient cohort filtering granularity** (P2)
   - File:beneficiaries:170
   - Problem: Cohort tiles only show broad categories. More granular filtering options would help Nur focus on specific subsets.
   - Proposed: Expand cohort filtering to include more detailed segments like age ranges or specific program tracks.

5. **No bulk action capability** (P1)
   - File:beneficiaries:203
   - Problem: No way to perform batch operations on multiple beneficiaries, such as changing status or consent in bulk.
   - Proposed: Add checkbox selection and bulk action dropdown to the table header for common operations.

### Suggested additions
- **Quick action toolbar** — adds a floating toolbar with common actions like "change status" or "toggle consent" that appears when selecting beneficiaries
- **Lifecycle timeline view** — shows a visual representation of each beneficiary's journey through different statuses over time

## Route: /donors

### Current affordance map
| Affordance | File:line | What it does | Who clicks | Misplaced? |
|---|---|---|---|---|
| Status grouping | donors:119 | Group donors by status | Nur | ✅ |
| Status badges | donors:103 | Show donor status | Nur | ✅ |
| Sort options | donors:94 | Change sort order | Nur | ✅ |
| Filter segments | donors:100 | Quick filters for donor types | Nur | ✅ |
| Search | donors:94 | Search donors by name or email | Nur | ✅ |
| Table | donors:103 | List donors | Nur | ✅ |

### Findings
1. **Overlapping filter controls** (P2)
   - File:donors:94
   - Problem: The filter segments and individual field filters overlap in functionality, causing confusion about which filter to use.
   - Proposed: Consolidate filter controls into a single unified filter bar with clear visual separation between quick segments and detailed filters.

2. **Limited donor categorization** (P1)
   - File:donors:103
   - Problem: Donor types are limited to basic categories (individual, organization, foundation) which doesn't capture the complexity of donor relationships.
   - Proposed: Add more granular donor classification options like "corporate sponsor", "individual major donor", "foundation grantee", etc.

3. **No donor value segmentation** (P1)
   - File:donors:103
   - Problem: Donors are sorted by most recent gift but there's no visual distinction between major donors and smaller contributors.
   - Proposed: Add a donor value indicator (e.g., donation tiers) to help Nur quickly identify high-value relationships.

4. **Inconsistent sort behavior** (P2)
   - File:donors:94
   - Problem: Sorting options don't maintain consistent behavior across different datasets or when filters are applied.
   - Proposed: Implement a persistent sort indicator that remains visible even when filters change.

5. **Missing donor activity timeline** (P1)
   - File:donors:103
   - Problem: No historical context about donor engagement or communication patterns.
   - Proposed: Add a donor activity timeline that shows gift history, correspondence, and interaction dates.

### Suggested additions
- **Donor value dashboard** — displays donor metrics and value tiers at a glance
- **Activity timeline preview** — shows recent donor interactions directly in the donor list
- **Segmentation quick actions** — allows Nur to create custom donor groups based on criteria

## Route: /profile

### Current affordance map
| Affordance | File:line | What it does | Who clicks | Misplaced? |
|---|---|---|---|---|
| Identity header | profile:31 | Show user avatar, name, role | Nur | ✅ |
| Stats summary | profile:52 | Show assigned tasks, created tasks | Nur | ✅ |
| Account details | profile:64 | Show user account information | Nur | ✅ |
| Responsibilities | profile:82 | Show team member responsibilities | Nur | ✅ |
| Missing profile notice | profile:89 | Inform about missing team directory profile | Nur | ✅ |

### Findings
1. **No direct access to team member profile** (P1)
   - File:profile:31
   - Problem: The profile page shows user information but doesn't provide easy access to the underlying team member record if one exists.
   - Proposed: Add a direct link to the team member's 360 view from the profile page.

2. **Limited task context** (P2)
   - File:profile:52
   - Problem: Stats only show counts without providing insight into task priorities or completion rates.
   - Proposed: Include a brief summary of task status distribution (e.g., 3 high priority, 5 medium, 2 low).

3. **No personal branding setup** (P1)
   - File:profile:31
   - Problem: There's no option to customize personal branding elements like a bio or preferred communication methods.
   - Proposed: Add a personal profile section for bio, communication preferences, and branding choices.

4. **Missing profile verification status** (P2)
   - File:profile:31
   - Problem: No indication of whether the profile is verified or has completed onboarding steps.
   - Proposed: Add a verification badge or progress indicator to show profile completeness.

5. **No quick access to settings** (P2)
   - File:profile:31
   - Problem: Profile page doesn't offer quick access to frequently used settings or configuration options.
   - Proposed: Add a settings quick-access panel or links to relevant settings sections.

### Suggested additions
- **Team member quick view** — direct link to full team member profile if available
- **Profile completion tracker** — shows progress toward completing profile setup
- **Personal branding customization** — allows Nur to add bio, communication preferences, and branding elements

## Route: /team

### Current affordance map
| Affordance | File:line | What it does | Who clicks | Misplaced? |
|---|---|---|---|---|
| Summary stats | team:67 | Show headcount, active count, open tasks | Nur | ✅ |
| Member type filters | team:79 | Filter by member type | Nur | ✅ |
| Status filters | team:86 | Filter by member status | Nur | ✅ |
| Department grouping | team:100 | Group members by department | Nur | ✅ |
| Member cards | team:108 | Show individual member info | Nur | ✅ |
| Add member button | team:111 | Add new team member | Nur | ✅ |

### Findings
1. **Department grouping inconsistency** (P2)
   - File:team:100
   - Problem: Department grouping uses hardcoded department names that may not align with organizational structure.
   - Proposed: Make department grouping configurable or allow users to define custom departments.

2. **No team member status tracking** (P1)
   - File:team:108
   - Problem: Individual member cards don't show a comprehensive status overview including recent activity or availability.
   - Proposed: Add a status indicator showing member availability, recent activity, or task load.

3. **Limited team member search** (P2)
   - File:team:111
   - Problem: Search is only available through the filter bar, not directly in the member list view.
   - Proposed: Add a search box directly within the member grid for easier navigation.

4. **Missing member skill mapping** (P1)
   - File:team:108
   - Problem: No way to see team member skills or expertise areas which is crucial for task assignment.
   - Proposed: Add skill tags or expertise indicators to member cards.

5. **No team performance metrics** (P1)
   - File:team:67
   - Problem: Summary stats only show basic headcount but don't provide insights into team productivity or task completion rates.
   - Proposed: Add team performance indicators like average task completion time or team capacity metrics.

### Suggested additions
- **Skill-based member search** — allows searching members by skills or expertise areas
- **Availability indicators** — shows member availability or workload status
- **Team performance dashboard** — displays team-level metrics and productivity indicators

## Route: /login

### Current affordance map
| Affordance | File:line | What it does | Who clicks | Misplaced? |
|---|---|---|---|---|
| Login form | login:13 | Authenticate user | User | ✅ |
| Email input | login:17 | Enter email or username | User | ✅ |
| Password input | login:20 | Enter password | User | ✅ |
| Sign in button | login:22 | Submit login credentials | User | ✅ |
| Error display | login:24 | Show login errors | User | ✅ |
| Footer note | login:26 | Show security warning | User | ✅ |

### Findings
1. **No password strength validation** (P2)
   - File:login:20
   - Problem: Password field lacks validation feedback or strength indicators.
   - Proposed: Add password strength meter or validation hints to guide users toward secure passwords.

2. **Missing "forgot password" flow** (P1)
   - File:login:24
   - Problem: No mechanism to reset forgotten passwords.
   - Proposed: Add a "Forgot password?" link that triggers a password reset workflow.

3. **No account lockout protection** (P2)
   - File:login:13
   - Problem: No account lockout or rate limiting to prevent brute-force attacks.
   - Proposed: Implement account lockout after failed attempts and rate limiting.

4. **No two-factor authentication support** (P1)
   - File:login:13
   - Problem: Login form doesn't support MFA or 2FA flows.
   - Proposed: Add 2FA option or indicator for enhanced security.

5. **No remember me functionality** (P2)
   - File:login:22
   - Problem: No option to remember login for extended sessions.
   - Proposed: Add "Remember me" checkbox for convenience.

### Suggested additions
- **Password reset flow** — adds forgot password functionality
- **Two-factor authentication** — enables MFA support
- **Account lockout protection** — prevents brute-force attacks
- **Remember me option** — allows extended session persistence

## Route: /settings

### Current affordance map
| Affordance | File:line | What it does | Who clicks | Misplaced? |
|---|---|---|---|---|
| Organization section | settings:24 | Show org info and goal | Nur | ✅ |
| Monthly goal editor | settings:43 | Edit fundraising goal | Nur | ✅ |
| Ingest dock | settings:62 | Manage data ingestion | Nur | ✅ |
| Brain onboarding | settings:68 | Configure onboarding sections | Nur | ✅ |
| Grant readiness | settings:75 | Manage grant documents | Nur | ✅ |
| Brand voice | settings:85 | View learned brand voice | Nur | ✅ |
| Logo uploader | settings:96 | Upload brand logos | Nur | ✅ |
| Signature editor | settings:103 | Edit email signatures | Nur | ✅ |
| Connected accounts | settings:116 | Manage email accounts | Nur | ✅ |
| Integrations card | settings:136 | Show integration status | Nur | ✅ |
| Automation link | settings:147 | Navigate to automation | Nur | ✅ |

### Findings
1. **Unorganized settings sections** (P2)
   - File:settings:24
   - Problem: Settings sections are grouped by function rather than logical flow, making it hard to find related settings.
   - Proposed: Reorganize settings into logical groups like "Organization", "Identity", "Communication", "Automation", "Integrations".

2. **No settings search** (P1)
   - File:settings:24
   - Problem: With many settings, there's no way to quickly find specific configuration options.
   - Proposed: Add a global search bar for settings that filters and highlights matching options.

3. **Missing settings backup/restore** (P1)
   - File:settings:24
   - Problem: No way to export or import settings configurations.
   - Proposed: Add settings export/import functionality for backup and migration.

4. **No settings validation feedback** (P2)
   - File:settings:43
   - Problem: Setting changes don't provide immediate feedback on validity or consequences.
   - Proposed: Add validation indicators and preview of changes before saving.

5. **Inconsistent section labeling** (P2)
   - File:settings:24
   - Problem: Some sections use title case while others use sentence case, creating visual inconsistency.
   - Proposed: Standardize all section labels to use consistent capitalization.

### Suggested additions
- **Settings search** — adds global search to find specific settings quickly
- **Settings backup/restore** — enables export/import of configuration
- **Settings validation feedback** — provides real-time validation of changes
- **Organized settings navigation** — restructures settings into logical groups

# Cross-route patterns

1. **Inconsistent status visualization** - Across beneficiaries, donors, and team, status indicators use different approaches (badges, colors, icons) without a consistent visual language, making it harder to scan and interpret.

2. **Missing contextual navigation** - Users often need to jump between related modules (e.g., from donor to their profile, or from beneficiary to related tasks) but there's no consistent way to navigate between related records.

3. **Overlapping functionality** - Multiple routes contain similar filtering capabilities (search, sort, filter) but they're implemented inconsistently with varying degrees of functionality and user experience quality.

---

# Cross-route patterns
1. **Inconsistent metric hero usage**: The `/grants` and `/donations` pages use the `.metric-hero` pattern effectively, while `/campaigns` and `/wishlist` do not utilize it for their main KPIs, creating visual inconsistency in how key metrics are presented.
2. **Missing "add" affordances in lists**: None of the four routes include an explicit "add new" button directly in the main list view, relying instead on secondary actions or external triggers (e.g., `/campaigns` uses a shell action, `/wishlist` uses a DispatchBox).
3. **Inconsistent filtering behavior**: `/grants` uses URL-based filtering that persists across navigation, while `/donations` and `/campaigns` also support filtering but lack the comprehensive omnibar approach seen in `/grants`.

# /grants

## Current affordance map
| Affordance | File:line | What it does | Who clicks | Misplaced? |
|---|---|---|---|---|
| Pipeline summary hero | grants/page.tsx:194 | Shows funding pipeline metrics | Nur | ✅ |
| Funnel stage counts | grants/page.tsx:205 | Shows grant count by stage | Nur | ✅ |
| Active grants band | grants/page.tsx:231 | Shows currently active grants | Nur | ✅ |
| Opportunities row | grants/page.tsx:253 | Displays discovered opportunities | Nur | ✅ |
| Kanban board | grants/page.tsx:284 | Shows grant pipeline stages | Nur | ✅ |
| Column filter segments | grants/page.tsx:170 | Filter by grant stage | Nur | ✅ |
| Search filter | grants/page.tsx:171 | Filter by funder or program | Nur | ✅ |
| Add grant button | grants/page.tsx:129 | Adds a new grant manually | Nur | ✅ |
| Prepare all button | grants/page.tsx:129 | Prepares all ready grants | Nur | ✅ |

### Findings
1. **Misplaced "active grants" section** (P1)
   - File:grants/page.tsx:231
   - Problem: The active grants section is placed after the opportunities row but before the kanban board, interrupting the natural flow of the pipeline from research to decision. This creates cognitive dissonance for Nur who expects to see the full pipeline from start to finish.
   - Proposed: Move the active grants band to the top of the page, before the pipeline summary, making it the first major visual element after the filters.

2. **Missing "add new grant" affordance in kanban** (P1)
   - File:grants/page.tsx:284
   - Problem: The kanban board lacks an "Add new grant" button directly in the board area, forcing Nur to use the shell action which interrupts the workflow. This is inconsistent with the pattern in `/wishlist` which has a clear "dispatch box" at the top.
   - Proposed: Add a "New grant" button in the "Researching" column header that allows Nur to quickly add a new grant without navigating away from the board view.

3. **Overlapping filter controls** (P2)
   - File:grants/page.tsx:140
   - Problem: The filter bar and the "active grants" section share vertical space, creating visual clutter. The filter bar is placed above the pipeline summary but the active grants section is placed below the opportunities row, leading to an inconsistent visual hierarchy.
   - Proposed: Place the filter bar at the very top of the main content area, followed by the pipeline summary, then the active grants section, then opportunities, then the kanban board.

4. **Insufficient visual distinction between active and inactive columns** (P2)
   - File:grants/page.tsx:284
   - Problem: The "Active grants" section visually blends with the kanban board, making it difficult to distinguish between the two sections. The active grants section has a card style while the kanban uses a different layout.
   - Proposed: Use a distinct visual treatment for the "Active grants" section, such as a larger header with a different background color or shadow to clearly separate it from the kanban board.

5. **Inconsistent "Prepare all" button placement** (P2)
   - File:grants/page.tsx:129
   - Problem: The "Prepare all" button is located in the shell action area, while the "Add grant" button is directly in the content area. This inconsistency in placement can confuse Nur about where to find related actions.
   - Proposed: Move the "Prepare all" button to the same container as the "Add grant" button, either both in the shell action or both in the content area, for better consistency.

### Suggested additions
- **"New grant" button in Researching column** — adds a quick way to add grants directly from the pipeline board, reducing navigation friction and keeping Nur in the context of the board workflow.

# /donations

## Current affordance map
| Affordance | File:line | What it does | Who clicks | Misplaced? |
|---|---|---|---|---|
| Metric hero | donations/page.tsx:64 | Shows fundraising metrics | Nur | ✅ |
| Filter bar | donations/page.tsx:150 | Filters donations by status, recurring, period | Nur | ✅ |
| Table view | donations/page.tsx:167 | Displays donations in a tabular format | Nur | ✅ |
| Thank-you draft button | donations/page.tsx:145 | Drafts thank-you message for a single donation | Nur | ✅ |
| Draft all thank-yous button | donations/page.tsx:145 | Drafts thank-yous for all recent un-thanked donations | Nur | ✅ |

### Findings
1. **Unintuitive metric hero layout** (P1)
   - File:donations/page.tsx:64
   - Problem: The metric hero layout places the "Raised this month" amount on the left and "Raised all time" on the right, but the "Raised all time" section doesn't clearly indicate which currency is being shown. This can lead to confusion when multiple currencies are involved.
   - Proposed: Make the currency explicit for each metric shown in the hero, ensuring that users understand exactly which currency is being displayed for each value.

2. **Missing visual indication of donation amount visibility** (P1)
   - File:donations/page.tsx:64
   - Problem: The MoneyHideToggle is placed in a fixed position but doesn't provide clear visual feedback about whether the amounts are currently hidden or visible. This makes it difficult for Nur to know at a glance if the amounts are being obscured.
   - Proposed: Add a subtle visual indicator next to the MoneyHideToggle to show the current state (visible/hidden) and provide hover text explaining the functionality.

3. **Inconsistent filtering UX** (P2)
   - File:donations/page.tsx:150
   - Problem: The filter bar shows a "Period" filter that only allows selection of time ranges but doesn't allow filtering by "All time" directly. This forces Nur to make a selection even when they want to see all donations, which is counter-intuitive.
   - Proposed: Add an option to "Show all" or "All time" in the period filter dropdown, allowing Nur to easily toggle between filtered and unfiltered views.

4. **Lack of clear visual hierarchy in donation table** (P2)
   - File:donations/page.tsx:167
   - Problem: The donation table lacks clear visual separation between rows, especially when viewing long lists. This makes it difficult to scan and identify individual donations at a glance.
   - Proposed: Add alternating row colors or subtle borders to improve readability and scanning efficiency.

5. **Missing bulk action capability** (P2)
   - File:donations/page.tsx:145
   - Problem: While there's a "Draft all thank-yous" button, there's no way to perform bulk actions on donations (such as selecting multiple donations for batch processing or editing). This limits Nur's ability to efficiently manage large sets of donations.
   - Proposed: Implement a checkbox column in the donation table to enable selection of multiple donations for bulk operations.

### Suggested additions
- **Visual currency indicators in metric hero** — provides clarity on which currency is being displayed for each fundraising figure, preventing misinterpretation of multi-currency data.
- **Bulk selection capability in donation table** — enables Nur to perform operations on multiple donations simultaneously, improving efficiency for large-scale management tasks.

# /campaigns

## Current affordance map
| Affordance | File:line | What it does | Who clicks | Misplaced? |
|---|---|---|---|---|
| Feature card | campaigns/page.tsx:45 | Shows featured campaign with key metrics | Nur | ✅ |
| Grid of campaign cards | campaigns/page.tsx:74 | Shows all campaigns in a grid | Nur | ✅ |
| Campaign editor button | campaigns/page.tsx:48 | Opens campaign editor for featured campaign | Nur | ✅ |
| Edit campaign buttons | campaigns/page.tsx:82 | Opens campaign editor for individual campaigns | Nur | ✅ |

### Findings
1. **Missing metric hero pattern** (P1)
   - File:campaigns/page.tsx:45
   - Problem: Unlike `/grants` and `/donations`, the `/campaigns` page lacks a prominent metric hero that highlights key fundraising figures. This makes it harder for Nur to quickly assess the overall campaign performance at a glance.
   - Proposed: Add a metric hero section similar to the one in `/donations` that shows the total number of campaigns, active campaigns, and key fundraising metrics.

2. **Inconsistent feature card placement** (P2)
   - File:campaigns/page.tsx:45
   - Problem: The featured campaign card is placed at the top of the page but doesn't clearly indicate it's a featured item. It also lacks the visual prominence it deserves compared to the rest of the content.
   - Proposed: Enhance the featured campaign card with a more prominent visual treatment, such as a larger display, different background, or clear "Featured" indicator to draw attention to it.

3. **Limited visual distinction between campaign states** (P2)
   - File:campaigns/page.tsx:82
   - Problem: The campaign cards don't clearly differentiate between different campaign statuses (live, draft, ended, planned) through visual cues, making it harder to quickly identify the state of each campaign.
   - Proposed: Use different color schemes or icons to visually distinguish between campaign statuses, making it easier for Nur to scan and understand the current state of each campaign at a glance.

4. **No quick-add affordance for campaigns** (P2)
   - File:campaigns/page.tsx:48
   - Problem: There's no direct way to add a new campaign from the main campaigns view. The "New campaign" button is only available in the shell action, requiring navigation away from the main view.
   - Proposed: Add a "Create new campaign" button directly in the main content area, preferably next to the featured campaign section or in the grid header, to reduce friction in adding new campaigns.

5. **Inconsistent campaign status representation** (P2)
   - File:campaigns/page.tsx:74
   - Problem: The campaign cards show status badges but don't consistently represent all possible statuses in a standardized way. Some campaigns might have "active" while others have "live", creating inconsistency in terminology.
   - Proposed: Standardize campaign status representations across the entire application, using consistent terminology and visual treatments for each status type.

### Suggested additions
- **Metric hero section** — provides a quick overview of campaign performance metrics, aligning with the pattern established in `/donations` and `/grants`.
- **Quick-create campaign button** — enables Nur to add new campaigns directly from the main campaigns view without needing to navigate to the shell action.

# /wishlist

## Current affordance map
| Affordance | File:line | What it does | Who clicks | Misplaced? |
|---|---|---|---|---|
| Metric hero | wishlist/page.tsx:24 | Shows wishlist metrics | Nur | ✅ |
| Dispatch box | wishlist/page.tsx:41 | Allows adding new wishlist items | Nur | ✅ |
| Grouped items by status | wishlist/page.tsx:47 | Shows items organized by funding status | Nur | ✅ |
| Item details | wishlist/page.tsx:52 | Shows detailed information for each item | Nur | ✅ |

### Findings
1. **Missing "add new item" button in main view** (P1)
   - File:wishlist/page.tsx:41
   - Problem: While there's a dispatch box for adding items, there's no dedicated "Add item" button directly in the main wishlist view. This means Nur must rely on the dispatch box which isn't always visible or obvious, especially when scrolling through the list.
   - Proposed: Add a prominent "Add new item" button in the main content area, perhaps positioned near the top of the grouped items section, to make it easy to add new wishlist items without having to remember to use the dispatch box.

2. **Inconsistent grouping strategy** (P2)
   - File:wishlist/page.tsx:47
   - Problem: The wishlist items are grouped by funding status (open, partial, fulfilled) but this grouping could be enhanced with clearer visual separation between groups. The cards within each group are visually distinct, but the transitions between groups aren't smooth.
   - Proposed: Add visual dividers or spacing between the different funding status groups to create clearer boundaries and make it easier to scan through items by funding status.

3. **Limited item detail view** (P2)
   - File:wishlist/page.tsx:52
   - Problem: The wishlist items show basic information but lack a quick way to access more detailed information without clicking through to a separate view. This can be limiting when Nur wants to quickly assess item details.
   - Proposed: Implement a collapsible or expandable detail section within each item card that reveals additional information when clicked, reducing the need for separate navigation.

4. **No visual indication of item priority** (P2)
   - File:wishlist/page.tsx:47
   - Problem: The wishlist items don't indicate any priority level or urgency, which could be important for Nur to understand which items should be funded first.
   - Proposed: Add a priority indicator (such as star rating, color coding, or urgency labels) to help Nur quickly identify the most critical items that need immediate attention.

5. **Missing bulk action capability** (P2)
   - File:wishlist/page.tsx:41
   - Problem: There's no way to perform bulk actions on wishlist items (such as marking multiple items as fulfilled or editing several items at once), limiting Nur's ability to efficiently manage the wishlist.
   - Proposed: Implement a checkbox system for wishlist items that allows Nur to select multiple items and perform bulk operations such as marking as fulfilled, editing properties, or archiving.

### Suggested additions
- **Prominent "Add new item" button** — provides a clear, accessible way to add new wishlist items directly from the main view, improving workflow efficiency.
- **Priority indicators for items** — helps Nur quickly identify which items are most urgent or important to fund based on priority levels or urgency signals.

---

# 3-work

## Route: /calendar

### Current affordance map
| Affordance | File:line | What it does | Who clicks | Misplaced? |
|---|---|---|---|---|
| Month navigation | /calendar — page.tsx:36 | Switch months in calendar view | Nur | Yes |
| Event creation | /calendar — page.tsx:64 | Opens calendar event creation modal | Nur | Yes |
| Event details view | /calendar — page.tsx:64 | Shows event details in modal | Nur | Yes |
| Next event summary | /calendar — page.tsx:23-30 | Displays upcoming event alert | Nur | Yes |
| Week count summary | /calendar — page.tsx:23-30 | Shows items in next 7 days | Nur | Yes |

### Findings
1. **Misplaced month navigation** (P1)
   - File:line `/calendar — page.tsx:36`
   - Problem: The month navigation is embedded within the hero section instead of being a dedicated control element in the calendar UI. This creates a visual hierarchy issue where the navigation feels disconnected from the main calendar grid.
   - Proposed: Move month navigation to a dedicated header area above the calendar grid, similar to how the event creation button is positioned in the hero. The navigation should be a horizontal control with previous/next buttons and a month/year display, styled as a `.card` with appropriate spacing.

2. **Event creation UX disconnect** (P1)
   - File:line `/calendar — page.tsx:64`
   - Problem: The event creation button appears in the hero section but lacks clear context about what it creates. It's not visually distinct from the summary features and doesn't immediately communicate that it opens a modal.
   - Proposed: Add a prominent "Add event" button directly in the calendar grid area with a clear icon (Lucide Plus) and consistent styling. This would follow the pattern established in other modules where primary actions appear in the context of their domain.

3. **Event detail view placement** (P1)
   - File:line `/calendar — page.tsx:64`
   - Problem: Event details are accessed via modal which is not visually tied to the calendar grid. This creates confusion about which event is being viewed and makes it harder to navigate between events.
   - Proposed: Implement a focused event detail panel that appears adjacent to the calendar grid or as a floating overlay that maintains visual connection to the event it represents, rather than relying solely on modal behavior.

4. **Summary feature positioning** (P2)
   - File:line `/calendar — page.tsx:23-30`
   - Problem: The summary features (week count and next event) are placed in a tight hero section that doesn't clearly distinguish between the main calendar content and the summary indicators.
   - Proposed: Create a separate card for each summary feature with consistent spacing and typography hierarchy. The next event should be visually separated from the week count with a clear divider or distinct styling.

5. **Missing event type categorization** (P2)
   - File:line `/calendar — page.tsx:64`
   - Problem: Events lack clear visual distinction based on type (meeting, travel, etc.) making it difficult to scan quickly for specific categories of events.
   - Proposed: Add color-coded badges or icons next to event titles indicating their type, following the existing pattern used elsewhere in the system for categorizing content.

### Suggested additions
- **Event type filtering**: Add category filters to the calendar header to allow Nur to view only specific types of events (meetings, travel, reminders) — helps with focus when dealing with many events
- **Quick-add shortcuts**: Include keyboard shortcuts or gesture-based quick-add options for common event types (e.g., "m" for meeting, "t" for travel) — improves efficiency for frequent actions

## Route: /cases

### Current affordance map
| Affordance | File:line | What it does | Who clicks | Misplaced? |
|---|---|---|---|---|
| Case card actions | /cases — page.tsx:185-200 | Approve, decline, set stage buttons | Nur | Yes |
| Case funnel visualization | /cases — page.tsx:55-70 | Shows funnel progression with bars | Nur | Yes |
| Case lane management | /cases — page.tsx:110-130 | Lane-based organization of cases | Nur | Yes |
| Case merging tools | /cases — page.tsx:208 | Merge into family functionality | Nur | Yes |
| Case intake form | /cases — page.tsx:235 | Log new case with AI | Nur | Yes |

### Findings
1. **Misplaced case funnel visualization** (P1)
   - File:line `/cases — page.tsx:55-70`
   - Problem: The funnel visualization appears in a card that's not visually distinct from the main case list area, making it unclear that this is a separate summary view.
   - Proposed: Create a dedicated section for the funnel visualization with clear heading and distinct styling using a `.feature` component. Place it at the top of the main content area with appropriate spacing above and below to make it stand out as a summary element.

2. **Case card action alignment issues** (P1)
   - File:line `/cases — page.tsx:185-200`
   - Problem: The action buttons in case cards are horizontally aligned but lack clear visual grouping or spacing, causing them to appear scattered and potentially hard to scan.
   - Proposed: Group the action buttons into a clear horizontal stack with consistent spacing using flexbox with `gap: 7px` and ensure they're properly aligned vertically within the card container. Consider adding hover states for better affordance.

3. **Lane-based organization inconsistency** (P1)
   - File:line `/cases — page.tsx:110-130`
   - Problem: The lane organization approach doesn't provide clear visual cues about which cases belong to which stage, particularly when the lanes are scrolled horizontally.
   - Proposed: Add a clear lane header with background color matching the stage tone and a distinctive border to visually separate each lane. Ensure the lane title and count are clearly visible and consistently formatted across all lanes.

4. **Merge tool placement ambiguity** (P2)
   - File:line `/cases — page.tsx:208`
   - Problem: The merge functionality is placed within the case card actions but isn't clearly differentiated from other actions, leading to potential confusion.
   - Proposed: Move the merge tool to a dedicated section within the case detail view or create a separate "merge" button that opens a modal with merge options, clearly labeled and visually distinct from regular actions.

5. **Fragment detection visibility** (P2)
   - File:line `/cases — page.tsx:105`
   - Problem: Fragment detection warnings appear as chips but lack clear indication of their importance or urgency, making them easy to overlook.
   - Proposed: Change the fragment detection chip to a more prominent badge with a warning tone and include a tooltip explaining the significance of merging the fragment into a family.

### Suggested additions
- **Case prioritization**: Add priority indicators (high, medium, low) to case cards based on age or other criteria — helps Nur quickly identify urgent cases
- **Batch action selector**: Implement a checkbox selection system for multiple cases to enable batch operations (approve, decline, move) — improves efficiency for managing multiple cases simultaneously

## Route: /inbox

### Current affordance map
| Affordance | File:line | What it does | Who clicks | Misplaced? |
|---|---|---|---|---|
| Conversation list navigation | /inbox — page.tsx:102 | Click to select conversation | Nur | Yes |
| Lane filtering | /inbox — page.tsx:48-56 | Filter conversations by type | Nur | Yes |
| Account/channel filtering | /inbox — page.tsx:63-73 | Filter by email account or channel | Nur | Yes |
| Reply composition | /inbox — page.tsx:167 | Compose email reply | Nur | Yes |
| Approval draft handling | /inbox — page.tsx:148 | Handle AI-drafted replies | Nur | Yes |
| Thread view | /inbox — page.tsx:113 | View conversation thread | Nur | Yes |

### Findings
1. **Misplaced lane filtering** (P1)
   - File:line `/inbox — page.tsx:48-56`
   - Problem: Lane filtering appears above the conversation list but doesn't visually connect to the list itself, creating a disconnect between filters and results.
   - Proposed: Move lane filtering below the conversation list and make it sticky when scrolling to maintain visibility during long lists. Add a clear visual indicator showing which lane is currently active and ensure the filtering logic updates immediately upon selection.

2. **Account/channel filter positioning** (P1)
   - File:line `/inbox — page.tsx:63-73`
   - Problem: Account/channel filters are placed below the lane filters but don't provide clear separation or context about how they interact with the conversation list.
   - Proposed: Group these filters together with a clear header and visual separator. Add a consistent spacing pattern between filter sections to improve readability and reduce cognitive load.

3. **Conversation list item styling inconsistency** (P1)
   - File:line `/inbox — page.tsx:102`
   - Problem: Conversation list items lack consistent visual hierarchy and don't clearly indicate their status (unread, draft, etc.) through visual cues alone.
   - Proposed: Implement a more robust visual indicator system using color-coded borders, background highlights, and clear status badges that immediately convey the conversation's state without requiring users to scan text.

4. **Reply composition area placement** (P2)
   - File:line `/inbox — page.tsx:167`
   - Problem: The reply composition area is placed below the conversation thread but doesn't provide clear context about when it's available or how to access it.
   - Proposed: Move the reply composition area to appear directly after the conversation thread when a conversation is selected, ensuring it's immediately visible and accessible. Add a clear "Compose reply" button that appears when a conversation is selected.

5. **Approval draft handling clarity** (P2)
   - File:line `/inbox — page.tsx:148`
   - Problem: Approval draft handling is presented as a form but doesn't clearly indicate its relationship to the conversation or provide context about what action is being taken.
   - Proposed: Add a clear header above the approval draft section that explains its purpose and provides a direct link to the approval process. Include a summary of the draft content and its associated conversation to provide context.

### Suggested additions
- **Conversation quick actions**: Add quick action buttons (mark as read, archive, star) directly on conversation list items — reduces clicks for common operations
- **Smart conversation sorting**: Implement automatic sorting by relevance or priority based on message content or frequency — helps Nur prioritize important conversations

## Route: /workspace

### Current affordance map
| Affordance | File:line | What it does | Who clicks | Misplaced? |
|---|---|---|---|---|
| Thread list navigation | /workspace — page.tsx:105 | Select conversation thread | Nur | Yes |
| Task assignment | /workspace — page.tsx:120 | Assign tasks from conversation | Nur | Yes |
| Chat sending | /workspace — page.tsx:120 | Send messages from portal | Nur | Yes |
| Live activity feed | /workspace — page.tsx:130 | View recent events | Nur | Yes |
| Mission control access | /workspace — page.tsx:18 | Access mission control | Nur | Yes |

### Findings
1. **Misplaced thread list navigation** (P1)
   - File:line `/workspace — page.tsx:105`
   - Problem: The thread list navigation is embedded within the conversation list area without clear visual separation or distinct styling from the actual conversation content.
   - Proposed: Create a dedicated sidebar area for thread navigation with clear headers and visual hierarchy. Use a `.card` component with appropriate padding and spacing to distinguish it from the main conversation view.

2. **Task assignment placement confusion** (P1)
   - File:line `/workspace — page.tsx:120`
   - Problem: Task assignment functionality is mixed with chat sending in the same area, creating confusion about when to use which feature.
   - Proposed: Separate task assignment and chat sending into clearly distinct areas with different visual treatments. Create a dedicated "Assign task" section that appears when a conversation is selected, with clear labeling and visual separation from the chat interface.

3. **Live activity feed positioning** (P1)
   - File:line `/workspace — page.tsx:130`
   - Problem: The live activity feed is positioned as a sidebar that doesn't integrate well with the main workspace content flow.
   - Proposed: Make the live activity feed a floating overlay or a persistent dock element that remains visible while working in the main workspace. Consider using a `.modal` or `.sheet-overlay` approach to maintain visibility without disrupting the main workflow.

4. **Mission control access placement** (P2)
   - File:line `/workspace — page.tsx:18`
   - Problem: Mission control access is placed in the header but doesn't clearly indicate its purpose or how it relates to the workspace content.
   - Proposed: Add a clear visual indicator or tooltip explaining the purpose of Mission Control. Consider placing it in a more prominent location within the workspace toolbar where it's easily discoverable alongside other navigation elements.

5. **Conversation thread content organization** (P2)
   - File:line `/workspace — page.tsx:105`
   - Problem: Conversation thread content lacks clear visual hierarchy and doesn't distinguish between incoming and outgoing messages effectively.
   - Proposed: Implement a clearer message bubble system with distinct styling for incoming vs outgoing messages, proper spacing, and visual indicators for message status (sent, delivered, read).

### Suggested additions
- **Quick task creation**: Add a floating "+" button that allows Nur to quickly assign tasks without navigating away from the conversation — streamlines workflow
- **Thread search**: Implement a search bar within the thread list to quickly find specific conversations — improves efficiency when managing many threads

# Cross-route patterns

1. **Inconsistent action placement**: Across all routes, action buttons and forms are inconsistently placed within cards or containers, often lacking clear visual grouping or contextual clues about their purpose. This makes it harder for Nur to identify and execute actions efficiently.

2. **Summary feature positioning**: Summary metrics and visualizations (funnel charts, counts, etc.) are inconsistently placed across routes, sometimes buried in headers or appearing in cards that aren't visually distinct from the main content areas, reducing their effectiveness as quick-reference tools.

3. **Navigation vs content separation**: There's a recurring pattern of mixing navigation controls with content areas without clear visual separation, making it difficult for users to understand which elements are interactive and how they relate to each other in the overall workflow.

---

# 4-content-comms

## Route: /content

### Current affordance map
| Affordance | File:line | What it does | Who clicks | Misplaced? |
|---|---|---|---|---|
| Post composer | content/page.tsx:49 | Main input for creating posts | Nur | Yes |
| Channel selection | content/page.tsx:67 | Select platforms to publish to | Nur | Yes |
| Media picker | content/page.tsx:95 | Choose image from Library | Nur | Yes |
| Post status filter | content/page.tsx:141 | Group posts by status | Nur | No |
| Post editing actions | content/page.tsx:157 | Schedule/mark posted | Nur | Yes |

### Findings
1. **Channel selection lacks clear visual feedback** (P1)
   - File:content/page.tsx:67
   - Problem: Checkbox labels for Instagram/Facebook are too small and lack visual distinction. Clicking the icon alone doesn't provide feedback.
   - Proposed: Add a visual indicator for selected channels and increase label size. Make icons larger with hover states.

2. **Media picker doesn't validate image dimensions** (P1)
   - File:content/page.tsx:95
   - Problem: No guidance on optimal image sizes or aspect ratios. Users may select inappropriate media that fails to render properly on platforms.
   - Proposed: Add a tooltip or help text suggesting recommended dimensions (1080×1080 for Instagram, 1200×630 for Facebook) and preview thumbnail size constraints.

3. **Post status filter creates redundant visual hierarchy** (P2)
   - File:content/page.tsx:141
   - Problem: The three-column layout with status badges creates a visual hierarchy that's inconsistent with the main composer flow. The status columns feel like secondary navigation rather than grouped content.
   - Proposed: Replace with a single list view of all posts with clear status indicators, allowing users to filter by status using a dedicated filter bar instead of separate columns.

4. **Missing post preview functionality** (P1)
   - File:content/page.tsx:157
   - Problem: There's no way to preview how a post will appear on social platforms before scheduling or publishing. This increases risk of poor-quality posts.
   - Proposed: Add a "Preview" button that opens a modal showing how the post would appear on Instagram and Facebook with proper styling and media rendering.

5. **Inconsistent form element sizing** (P2)
   - File:content/page.tsx:61
   - Problem: The brand selector and schedule datetime input have inconsistent widths (200px vs 230px) despite both being input fields. This breaks visual rhythm.
   - Proposed: Standardize input widths to 230px for all form controls to maintain consistent spacing and alignment.

### Suggested additions
- **AI draft suggestions panel** — shows recent AI-generated posts that could be reused or modified, helping Nur avoid starting from scratch
- **Platform-specific character counters** — displays remaining characters for each platform (Instagram: 2200, Facebook: 63207) to prevent truncation errors

## Route: /library

### Current affordance map
| Affordance | File:line | What it does | Who clicks | Misplaced? |
|---|---|---|---|---|
| Upload area | library/page.tsx:24 | Drop files to upload | Nur | Yes |
| Shelf filter | library/page.tsx:76 | Filter assets by category | Nur | Yes |
| Asset preview | library/page.tsx:99 | View image/video preview | Nur | No |
| Search bar | library/page.tsx:68 | Search assets by content | Nur | Yes |

### Findings
1. **Upload area placement conflicts with shelf organization** (P1)
   - File:library/page.tsx:24
   - Problem: The upload zone is placed at the top of the page, making it visually disconnected from the shelved assets below. Users may miss it or think it's for a different purpose.
   - Proposed: Move the upload area below the shelf filters to establish a clear progression from browsing to adding content.

2. **Shelf filter naming inconsistency** (P2)
   - File:library/page.tsx:46
   - Problem: Shelf labels like "Finance" and "Programs" are capitalized, while others like "people" and "legal" are lowercase. This creates a visual inconsistency.
   - Proposed: Standardize all shelf labels to sentence case (Finance, Programs, Events, Reports, Branding, People, Legal, Media, General) for better readability.

3. **Missing bulk operations** (P1)
   - File:library/page.tsx:99
   - Problem: Users cannot perform batch actions on multiple assets (tag, move, delete). This severely limits efficiency when managing large collections.
   - Proposed: Add checkbox selection to asset cards and a toolbar with bulk actions (tag, move, delete) that appears when selections are made.

4. **No visual indication of asset type in thumbnails** (P2)
   - File:library/page.tsx:99
   - Problem: Asset thumbnails don't clearly indicate their type (image, PDF, video). Users must click through to discover the file type.
   - Proposed: Add a small icon overlay on thumbnails indicating the file type (camera for images, file for documents, film for videos) with a subtle color coding.

5. **Search bar location lacks contextual relevance** (P2)
   - File:library/page.tsx:68
   - Problem: The search bar is positioned above the shelf filters, but filtering by shelf should logically come before searching. This disrupts natural workflow.
   - Proposed: Move the search bar below the shelf filter bar to better reflect the typical workflow of narrowing down categories before searching.

### Suggested additions
- **Tagging system enhancement** — allow users to create custom tags that automatically categorize assets based on content keywords
- **Recent uploads section** — display the last 5 uploaded assets prominently at the top for quick access

## Route: /guide

### Current affordance map
| Affordance | File:line | What it does | Who clicks | Misplaced? |
|---|---|---|---|---|
| Tour launcher | guide/page.tsx:17 | Start the onboarding tour | Nur | Yes |
| Quick reference map | guide/page.tsx:35 | Navigate to sections | Nur | No |
| Progress counter | guide/page.tsx:24 | Show completion percentage | Nur | No |

### Findings
1. **Tour launcher is visually disconnected from the content** (P1)
   - File:guide/page.tsx:17
   - Problem: The tour launcher hero section is separated from the quick reference by a large gap, making it feel like a standalone feature rather than part of the guide experience.
   - Proposed: Reduce the vertical spacing between the tour hero and quick reference sections to create a stronger connection between the two elements.

2. **Quick reference lacks visual hierarchy** (P2)
   - File:guide/page.tsx:35
   - File:guide/page.tsx:44
   - Problem: The pillar sections are all equal in prominence, but some contain more actionable items than others. This makes it harder to scan for relevant content quickly.
   - Proposed: Add a visual indicator (number badge) to each pillar section showing how many items are available, with larger numbers indicating higher priority sections.

3. **Progress tracking doesn't provide actionable insights** (P2)
   - File:guide/page.tsx:24
   - Problem: The progress counter only shows "X places across Y areas" but doesn't indicate how much of the guide has been completed or what remains.
   - Proposed: Replace the simple counter with a progress bar that visually represents completion percentage and highlights areas needing attention.

4. **Missing quick-access navigation** (P1)
   - File:guide/page.tsx:35
   - Problem: Users cannot quickly jump to specific sections of the guide without scrolling through all pillars.
   - Proposed: Add a sticky navigation sidebar that allows users to jump directly to any pillar section or search within the guide.

5. **Tour launcher text is too generic** (P2)
   - File:guide/page.tsx:10
   - Problem: The phrase "The fastest way around is to let me show you" is vague and doesn't clearly communicate the benefits of taking the tour.
   - Proposed: Revise the text to be more specific about what users gain from the tour (e.g., "Learn how to navigate the platform efficiently in 10 minutes").

### Suggested additions
- **Bookmark feature** — allow users to save favorite sections of the guide for easy reference
- **Offline access** — provide downloadable PDF version of the guide for users who want to study offline

## Route: /reports

### Current affordance map
| Affordance | File:line | What it does | Who clicks | Misplaced? |
|---|---|---|---|---|
| Report builder | reports/page.tsx:135 | Create custom reports | Nur | Yes |
| Invoice builder | reports/page.tsx:143 | Issue invoices | Nur | Yes |
| Financial summary | reports/page.tsx:45 | View financial data | Nur | No |
| Funder report generator | reports/page.tsx:94 | Generate cover narrative | Nur | Yes |
| Board report generator | reports/page.tsx:106 | Generate cover narrative | Nur | Yes |

### Findings
1. **Report builder placement conflicts with financial overview** (P1)
   - File:reports/page.tsx:135
   - Problem: The report builder is placed immediately after the financial summary, but users often want to see the financial data first before deciding what to report on.
   - Proposed: Move the report builder section to the bottom of the page, below the financial summary and narrative generators, to create a logical flow from data to reporting.

2. **Narrative generators lack clear distinction** (P2)
   - File:reports/page.tsx:94
   - File:reports/page.tsx:106
   - Problem: Both funder and board narratives are presented as separate cards with similar styling, making it difficult to distinguish their purpose at a glance.
   - Proposed: Add distinct visual indicators (different icons, colors, or badges) to differentiate between funder and board narrative options.

3. **Missing quick report templates** (P1)
   - File:reports/page.tsx:135
   - Problem: Users must manually configure report parameters each time, even for standard formats like quarterly summaries or annual reports.
   - Proposed: Add a "Quick Templates" section that provides pre-configured report options (quarterly, annual, monthly) that can be customized with a single click.

4. **Invoice builder placement is inconsistent** (P2)
   - File:reports/page.tsx:143
   - Problem: The invoice builder is embedded within the main report tabs rather than being in a dedicated section, making it less prominent.
   - Proposed: Move the invoice builder to a separate tab or section at the top level to give it appropriate visibility alongside the report builder.

5. **Financial summary lacks drill-down capability** (P2)
   - File:reports/page.tsx:45
   - Problem: The financial summary shows aggregated figures but doesn't allow users to explore underlying transactions directly from the summary view.
   - Proposed: Add a "View Details" button to each financial metric that opens a detailed transaction list in a FocusTab.

### Suggested additions
- **Report scheduling feature** — allow users to schedule regular reports (monthly, quarterly) to be generated automatically
- **Customizable report periods** — enable users to define custom date ranges for report generation beyond the default year-to-date

## Route: /outreach

### Current affordance map
| Affordance | File:line | What it does | Who clicks | Misplaced? |
|---|---|---|---|---|
| Audience metrics | outreach/page.tsx:17 | Show reach statistics | Nur | Yes |
| Audience breakdown | outreach/page.tsx:31 | Show donor/contact counts | Nur | No |
| Composition area | outreach/page.tsx:50 | Write and send emails | Nur | Yes |

### Findings
1. **Audience metrics placement interrupts composition flow** (P1)
   - File:outreach/page.tsx:17
   - Problem: The reach statistics are placed at the top of the page, interrupting the natural flow of writing an email. Users must scroll down to reach the composition area.
   - Proposed: Move the audience metrics below the composition area to maintain the writing flow, or implement a collapsible section that can be expanded when needed.

2. **Missing audience segmentation tools** (P1)
   - File:outreach/page.tsx:50
   - Problem: The composition area doesn't provide tools to segment audiences or customize messages for different groups, limiting personalization capabilities.
   - Proposed: Add a "Segmentation" panel that allows users to define custom audience groups and insert personalized variables into the message.

3. **Per-send cap visualization is unclear** (P2)
   - File:outreach/page.tsx:24
   - Problem: The per-send cap is displayed in a box with minimal context about what it means for sending.
   - Proposed: Add a tooltip or explanation that clarifies how the cap affects sending and what happens with larger audiences.

4. **Composition area lacks formatting assistance** (P2)
   - File:outreach/page.tsx:50
   - Problem: The text area for composing emails lacks formatting tools or suggestions for personalizing messages.
   - Proposed: Add a toolbar with basic formatting options (bold, italic, lists) and a "Personalize" button that suggests common personalization variables.

5. **Missing send history tracking** (P1)
   - File:outreach/page.tsx:50
   - Problem: There's no way to track previously sent campaigns or view delivery statistics without navigating away.
   - Proposed: Add a "Recent Sends" section that displays the last 5 campaigns with delivery stats and links to view details.

### Suggested additions
- **Template library** — allow users to save and reuse email templates for common outreach purposes
- **A/B testing capability** — enable users to create variations of the same email to test effectiveness

## Route: /studio

### Current affordance map
| Affordance | File:line | What it does | Who clicks | Misplaced? |
|---|---|---|---|---|
| Document console | studio/page.tsx:16 | Create documents via prompt | Nur | Yes |
| Generated documents | studio/page.tsx:35 | View previously generated documents | Nur | No |

### Findings
1. **Document console placement is too prominent** (P1)
   - File:studio/page.tsx:16
   - Problem: The document console is placed at the top of the page, but it's not the primary use case for most users. It should be secondary to viewing existing documents.
   - Proposed: Move the document console below the generated documents section to make document viewing the primary focus, with creation as a secondary action.

2. **Missing document categorization** (P1)
   - File:studio/page.tsx:35
   - Problem: Generated documents are listed without any categorization or tagging system, making it difficult to find specific types of documents later.
   - Proposed: Add document type badges and tags to each card that allow users to filter by document type or topic.

3. **No document preview functionality** (P1)
   - File:studio/page.tsx:35
   - Problem: Users cannot preview documents before downloading or printing them, potentially leading to formatting issues.
   - Proposed: Add a "Preview" button to each document card that opens a FocusTab with a read-only version of the document.

4. **Missing document sharing capability** (P1)
   - File:studio/page.tsx:35
   - Problem: Generated documents cannot be shared directly with colleagues or clients without manual download and upload steps.
   - Proposed: Add a "Share" button to each document card that generates a shareable link with appropriate permissions.

5. **No document version control** (P1)
   - File:studio/page.tsx:35
   - Problem: Users cannot see previous versions of documents or revert to earlier iterations.
   - Proposed: Implement a version history system that shows document revisions and allows users to restore previous versions.

### Suggested additions
- **Document templates** — provide pre-built templates for common document types (certificates, letters, reports)
- **Collaboration features** — allow multiple users to collaborate on document creation with comments and suggestions

# Cross-route patterns

1. **Inconsistent form element sizing** - Across content, library, and outreach, form controls have varying widths (200px vs 230px) that create visual inconsistency and break the expected spacing rhythm.

2. **Missing preview functionality** - All core creation surfaces (content, studio, outreach) lack preview capabilities, forcing users to commit to actions without seeing the final result, increasing risk of errors.

3. **Poor visual hierarchy in dashboard layouts** - The pattern of placing primary actions at the top of pages (content composer, studio console, outreach composition) interrupts natural workflows where users often need to reference supporting data first.

---

# 5-ops-system

## Route: /agents

### Current affordance map
| Affordance | File:line | What it does | Who clicks | Misplaced? |
|---|---|---|---|---|
| Live agent count | agents:page.tsx:70 | Shows how many agents are active | Operator | ✓ |
| Agent status badges | agents:page.tsx:104 | Visual indicator of agent maturity | Operator | ✓ |
| Scheduled job roster | agents:page.tsx:91 | Lists cron jobs and schedules | Operator | ✓ |
| Agent status cards | agents:page.tsx:119 | Shows individual agents and their last run | Operator | ✓ |
| Recent activity stream | agents:page.tsx:149 | Timeline of agent actions | Operator | ✓ |
| Autonomy dials | agents:page.tsx:176 | Controls agent decision-making scope | Operator | ✓ |
| Connector toggles | agents:page.tsx:204 | Enables/disables external integrations | Operator | ✓ |
| Recent agent runs | agents:page.tsx:219 | Shows execution history | Operator | ✓ |

### Findings
1. **Misleading status indicators for "soon" agents** (P1)
   - File:agents:page.tsx:104
   - Problem: "Soon" agents show as gray badges but are not actually scheduled for future deployment. The term implies roadmap planning, but users may interpret this as "not running yet" when it's just "planned but not implemented".
   - Proposed: Change the label to "planned" or "not yet built" and remove from live status count. Use a distinct visual for future features vs. non-implemented features.

2. **Confusing agent run tracking** (P1)
   - File:agents:page.tsx:109
   - Problem: Only the agent's last run is shown on the main agent cards, not the most recent run from the `agent_runs` table which is more reliable. The `lastRunByAgent` mapping is only used for the agent cards, not for the scheduled jobs or recent runs list.
   - Proposed: Update the agent card logic to use the `lastRunByAgent` mapping consistently, and also ensure the scheduled jobs section pulls from the same source.

3. **Inconsistent naming of agent statuses** (P2)
   - File:agents:page.tsx:78
   - Problem: The status labels ("live", "partial", "soon") are inconsistent with the terminology used elsewhere in the system (e.g., "planned" in the dashboard). This creates cognitive friction for operators who are used to consistent language.
   - Proposed: Standardize on "live", "partial", and "planned" throughout the system. Consider renaming "soon" to "planned".

4. **No direct link to agent detail pages** (P1)
   - File:agents:page.tsx:119
   - Problem: Individual agent cards lack a direct link to a detailed view, forcing users to navigate through the tab strip or other mechanisms to access agent-specific information.
   - Proposed: Wrap each agent card in a `<Link>` to a dedicated `/agents/[key]` route or add a "View details" button within the card.

5. **Activity stream lacks context** (P2)
   - File:agents:page.tsx:151
   - Problem: The activity stream displays generic event types without sufficient context. Users cannot quickly understand what happened or who initiated the action.
   - Proposed: Enhance the `evLabel` function to include more specific details like the agent involved, action type, and potentially the user responsible. Add timestamps for better temporal understanding.

### Suggested additions
- **Agent run logs**: Add a section that allows operators to view the full execution logs for any specific agent run, including input/output details and error messages.
- **Agent health checks**: Include a quick health check indicator for each agent showing uptime, response times, and any recent errors or warnings.
- **Scheduled job status indicators**: Add visual cues or tooltips to scheduled jobs that indicate whether they're currently running, delayed, or skipped.

## Route: /assistant

### Current affordance map
| Affordance | File:line | What it does | Who clicks | Misplaced? |
|---|---|---|---|---|
| Chat interface | assistant:page.tsx:20 | Main conversation area | Operator | ✓ |
| Suggestion prompts | assistant:page.tsx:26 | Quick-start questions | Operator | ✓ |
| Input field | assistant:page.tsx:44 | User message entry | Operator | ✓ |
| Send button | assistant:page.tsx:49 | Submit message | Operator | ✓ |

### Findings
1. **No clear distinction between AI and operator roles** (P1)
   - File:assistant:page.tsx:20
   - Problem: Messages from the assistant are styled identically to user messages, making it difficult to distinguish who said what during a conversation. This could lead to confusion or misinterpretation of responses.
   - Proposed: Implement distinct styling for user vs assistant messages (e.g., different background colors, alignment, or avatar placement). Ensure clear visual separation between the two parties.

2. **Limited conversation history management** (P1)
   - File:assistant:page.tsx:20
   - Problem: There's no mechanism to save or resume previous conversations. Once a session ends, all context is lost, which is inefficient for ongoing projects or complex inquiries.
   - Proposed: Add a "Save conversation" feature that allows users to store and retrieve past chats. Consider implementing a sidebar for browsing saved sessions.

3. **No ability to provide feedback or corrections** (P2)
   - File:assistant:page.tsx:20
   - Problem: Users cannot directly indicate when the AI gives incorrect or unhelpful responses. This limits learning and improvement opportunities for the system.
   - Proposed: Introduce a feedback mechanism such as thumbs up/down buttons next to each assistant response, allowing users to rate accuracy or helpfulness.

4. **Insufficient error handling** (P2)
   - File:assistant:page.tsx:35
   - Problem: When the assistant fails to respond (network issues, timeouts), the UI simply shows "thinking...", leaving users unsure whether the system is working or broken.
   - Proposed: Add a timeout mechanism with a clear error message indicating connection problems or request failure. Provide retry options or alternative assistance methods.

5. **Missing input validation** (P2)
   - File:assistant:page.tsx:44
   - Problem: The input field accepts any text without validation, leading to potential misuse or misunderstanding if users enter commands that aren't supported.
   - Proposed: Add basic validation to detect common misuse cases (e.g., overly long inputs) and warn users accordingly. Consider adding help text or examples for better guidance.

### Suggested additions
- **Conversation history sidebar**: Create a collapsible panel on the left to browse previous chats and easily switch between them.
- **Voice input support**: Allow users to speak their queries instead of typing, enhancing accessibility and convenience.
- **Quick action buttons**: Add contextual buttons for common actions like "Draft email", "Generate report", etc., based on the current conversation topic.

## Route: /filing

### Current affordance map
| Affordance | File:line | What it does | Who clicks | Misplaced? |
|---|---|---|---|---|
| Ingest dock | filing:page.tsx:39 | Drop zone for new documents | Operator | ✓ |
| Global search bar | filing:page.tsx:52 | Search across all documents | Operator | ✓ |
| Folder cards | filing:page.tsx:76 | Navigate to document categories | Operator | ✓ |
| Document filtering | filing:page.tsx:103 | Filter by document type | Operator | ✓ |
| Document listing | filing:page.tsx:115 | View documents within a folder | Operator | ✓ |
| Search results view | filing:page.tsx:43 | Display matched documents | Operator | ✓ |

### Findings
1. **Overlapping search functionality** (P1)
   - File:filing:page.tsx:52
   - Problem: The global search bar at the top overlaps with the folder-specific search bar, creating redundancy and potential confusion. Users might not know which one to use.
   - Proposed: Consolidate the search functionality into a single, unified search bar that operates across all documents regardless of folder. Move folder-specific filters to a separate panel or dropdown.

2. **No direct link to document detail pages** (P1)
   - File:filing:page.tsx:115
   - Problem: Documents listed in the grid lack direct links to their detail views, forcing users to open them in a new tab or navigate manually.
   - Proposed: Wrap each document card in a `<Link>` to a dedicated `/filing/[id]` route or add a "View details" button within the card.

3. **Poor visual hierarchy in folder cards** (P2)
   - File:filing:page.tsx:76
   - Problem: Folder cards do not clearly indicate the importance or relevance of document types within each folder, making it harder to prioritize folders visually.
   - Proposed: Use a color-coded system or iconography to highlight the most important document types within each folder. Add sorting options for folders based on recent activity or document count.

4. **Limited filtering capabilities** (P2)
   - File:filing:page.tsx:103
   - Problem: Filtering is limited to document type only. Users cannot filter by date range, author, or other metadata attributes that would enhance organization.
   - Proposed: Expand the filtering options to include date ranges, document authors, and additional metadata fields. Provide a multi-select filter dropdown for better flexibility.

5. **No bulk operations support** (P2)
   - File:filing:page.tsx:115
   - Problem: There are no bulk actions available for managing multiple documents simultaneously, such as moving, deleting, or tagging.
   - Proposed: Implement a checkbox-based selection system that allows users to select multiple documents and perform actions like moving, copying, or deleting them together.

### Suggested additions
- **Document tagging system**: Allow users to tag documents with custom labels for easier categorization and retrieval.
- **Batch upload capability**: Enable uploading multiple documents at once, possibly via drag-and-drop or file browser.
- **Document preview pane**: Add a side-by-side preview panel that shows document content while browsing the list.

## Route: /groups

### Current affordance map
| Affordance | File:line | What it does | Who clicks | Misplaced? |
|---|---|---|---|---|
| Group list | groups:page.tsx:57 | Displays recent WhatsApp groups | Operator | ✓ |
| Group chat viewer | groups:page.tsx:73 | Reads group messages | Operator | ✓ |
| Group creation link | groups:page.tsx:67 | Adds new group | Operator | ✓ |
| Group navigation | groups:page.tsx:73 | Switches between groups | Operator | ✓ |

### Findings
1. **No visual distinction between group types** (P1)
   - File:groups:page.tsx:57
   - Problem: All groups appear identical in the list, even though they may serve different purposes (e.g., team coordination vs. client communication). This makes it hard to identify the correct group quickly.
   - Proposed: Add visual indicators (icons, colors, or tags) to differentiate group types. For example, use a specific icon for team groups and another for client groups.

2. **Limited group metadata visibility** (P1)
   - File:groups:page.tsx:57
   - Problem: The group list only shows names and last activity time. Missing details like group size, description, or owner make it difficult to assess relevance or importance.
   - Proposed: Enhance the group card to display additional metadata such as member count, subject line, or creator information. Show this in a tooltip or expanded view when clicked.

3. **No search or filter functionality** (P2)
   - File:groups:page.tsx:57
   - Problem: With potentially dozens of groups, there is no way to narrow down the list based on criteria like name, recent activity, or membership.
   - Proposed: Add a search bar above the group list and implement filters for group name, recent activity, or participant status.

4. **No group creation wizard** (P2)
   - File:groups:page.tsx:67
   - Problem: While there's a link to create a group, the process isn't guided or explained, potentially confusing new users trying to set up a WhatsApp group.
   - Proposed: Implement a step-by-step group creation wizard that walks users through setting up a group name, description, participants, and permissions.

5. **No notification settings per group** (P2)
   - File:groups:page.tsx:73
   - Problem: Users have no control over how they receive notifications from different groups, leading to information overload or missed messages.
   - Proposed: Add notification settings for each group, allowing users to choose between receiving all messages, only mentions, or none at all.

### Suggested additions
- **Group membership management**: Allow users to manage their own group memberships, invite others, or leave groups easily.
- **Group statistics dashboard**: Provide metrics about group usage, message volume, and engagement levels.
- **Quick actions menu**: Offer shortcuts for common group actions like sending a message, scheduling a meeting, or sharing a document.

## Route: /inventory

### Current affordance map
| Affordance | File:line | What it does | Who clicks | Misplaced? |
|---|---|---|---|---|
| Stock summary cards | inventory:page.tsx:43 | Overview of inventory status | Operator | ✓ |
| Category grouping | inventory:page.tsx:80 | Organize items by category | Operator | ✓ |
| Item detail cards | inventory:page.tsx:91 | Show item properties and actions | Operator | ✓ |
| Add item form | inventory:page.tsx:131 | Create new inventory entries | Operator | ✓ |
| Listing generation | inventory:page.tsx:104 | Generate Folklore listings | Operator | ✓ |

### Findings
1. **No stock level thresholds defined** (P1)
   - File:inventory:page.tsx:34
   - Problem: The "low stock" and "out of stock" indicators rely on arbitrary definitions without predefined thresholds. This makes it hard to determine what constitutes a critical shortage.
   - Proposed: Define minimum stock levels for each item category or item individually, and adjust the alert logic accordingly. Display these thresholds in the UI for transparency.

2. **Missing bulk editing capabilities** (P1)
   - File:inventory:page.tsx:91
   - Problem: Users can only edit one item at a time, which becomes tedious when updating similar items in bulk (e.g., changing prices or categories).
   - Proposed: Implement a checkbox selection system that allows users to select multiple items and update shared properties collectively.

3. **No visual representation of inventory flow** (P2)
   - File:inventory:page.tsx:80
   - Problem: The current view doesn't show how inventory moves over time, such as sales trends, restocking patterns, or seasonal fluctuations.
   - Proposed: Add charts or graphs showing inventory movement, seasonal demand forecasts, or supply chain performance metrics.

4. **Limited customization of listing templates** (P2)
   - File:inventory:page.tsx:104
   - Problem: The generated listings are standardized and don't allow for customization or branding beyond the provided fields.
   - Proposed: Allow users to define custom templates for different product types or categories, enabling more tailored marketing copy.

5. **No export functionality for inventory data** (P2)
   - File:inventory:page.tsx:131
   - Problem: Users cannot export the current inventory list for offline analysis or integration with other systems.
   - Proposed: Add export buttons for CSV, Excel, or PDF formats, allowing users to download the entire inventory dataset.

### Suggested additions
- **Supplier relationship management**: Track supplier information, pricing, delivery schedules, and performance metrics.
- **Barcode scanning support**: Enable barcode scanning for quick item lookup and updates.
- **Inventory audit logs**: Keep a history of changes made to inventory items, including who made them and when.

## Route: /launchpad

### Current affordance map
| Affordance | File:line | What it does | Who clicks | Misplaced? |
|---|---|---|---|---|
| Launchpad grid | launchpad:page.tsx:5 | Full-screen grid of functions | Operator | ✓ |
| Search bar | launchpad:page.tsx:5 | Filter functions | Operator | ✓ |

### Findings
1. **No personalization options** (P1)
   - File:launchpad:page.tsx:5
   - Problem: The launchpad presents all functions equally, regardless of user preferences or frequently accessed tools. This reduces efficiency for power users.
   - Proposed: Allow users to pin frequently used functions to the top of the grid and reorder them according to preference.

2. **No keyboard navigation support** (P2)
   - File:launchpad:page.tsx:5
   - Problem: The launchpad relies entirely on mouse interactions, excluding keyboard-only users or those preferring keyboard shortcuts.
   - Proposed: Implement keyboard navigation using arrow keys to move between items and Enter to activate them. Add ARIA labels for accessibility.

3. **Lack of function descriptions** (P2)
   - File:launchpad:page.tsx:5
   - Problem: Function icons lack descriptive text, making it hard for new users to understand what each option does.
   - Proposed: Add tooltips or hover text to explain each function briefly. Consider displaying descriptions alongside icons for clarity.

4. **No quick access shortcuts** (P2)
   - File:launchpad:page.tsx:5
   - Problem: Users must go through the full launchpad to access commonly used functions, increasing the number of clicks required.
   - Proposed: Introduce shortcut keys or gestures for commonly used functions, allowing faster access without navigating the entire grid.

5. **No performance optimization** (P2)
   - File:launchpad:page.tsx:5
   - Problem: The launchpad loads all functions upfront, which could slow down rendering on devices with limited resources.
   - Proposed: Implement lazy loading or virtual scrolling to improve performance when dealing with large numbers of functions.

### Suggested additions
- **Recent usage tracking**: Show recently accessed functions at the top of the grid for quick access.
- **Function categories**: Group functions by type or domain to make it easier to find relevant tools.
- **Customizable function sets**: Allow users to create custom sets of functions tailored to their roles or workflows.

## Route: /legal

### Current affordance map
| Affordance | File:line | What it does | Who clicks | Misplaced? |
|---|---|---|---|---|
| Entity status overview | legal:page.tsx:30 | Highlights registration status | Operator | ✓ |
| Compliance obligation cards | legal:page.tsx:67 | Lists recurring obligations | Operator | ✓ |
| Document register | legal:page.tsx:102 | Shows categorized documents | Operator | ✓ |
| Entity registration cards | legal:page.tsx:79 | Details for each legal entity | Operator | ✓ |

### Findings
1. **Inconsistent grouping of documents** (P1)
   - File:legal:page.tsx:102
   - Problem: Documents are grouped by a classification algorithm rather than logical categories, causing some documents to appear in unexpected sections. This can obscure important information.
   - Proposed: Replace automatic classification with manual categorization or a more robust tagging system that allows administrators to properly organize documents.

2. **No version control for documents** (P1)
   - File:legal:page.tsx:102
   - Problem: The document register does not track document versions or revisions, making it impossible to see changes over time or revert to previous versions.
   - Proposed: Implement a version history system that tracks document modifications, including who made changes and when. Allow users to compare versions side-by-side.

3. **No access controls or permissions** (P2)
   - File:legal:page.tsx:102
   - Problem: All documents are accessible to everyone with access to the legal section, despite some being confidential or restricted.
   - Proposed: Add granular permission controls to restrict document visibility based on user roles or departments. Display access level indicators on documents.

4. **Limited search capabilities** (P2)
   - File:legal:page.tsx:102
   - Problem: The document register lacks advanced search features like full-text search or filtering by metadata, making it difficult to locate specific documents.
   - Proposed: Integrate a powerful search engine that supports natural language queries, keyword matching, and metadata filtering.

5. **No document preview or annotation tools** (P2)
   - File:legal:page.tsx:102
   - Problem: Users cannot preview documents directly within the system or annotate them for internal review, forcing reliance on external viewers.
   - Proposed: Embed a lightweight document viewer that supports PDF, Word, and other common formats. Allow annotations and comments on documents.

### Suggested additions
- **Document workflow management**: Implement a workflow system that tracks document approval stages, deadlines, and responsible parties.
- **Legal calendar integration**: Sync legal obligations with a calendar to remind users of upcoming deadlines or filing requirements.
- **Document comparison tool**: Provide a side-by-side comparison feature for reviewing document changes or drafts.

## Route: /memory

### Current affordance map
| Affordance | File:line | What it does | Who clicks | Misplaced? |
|---|---|---|---|---|
| Memory dashboard | memory:page.tsx:34 | Overview of stored knowledge | Operator | ✓ |
| Needs review section | memory:page.tsx:38 | Highlights conflicting facts | Operator | ✓ |
| Knowledge base view | memory:page.tsx:57 | Displays facts by category | Operator | ✓ |
| Entity graph visualization | memory:page.tsx:74 | Shows connections between entities | Operator | ✓ |
| Query input box | memory:page.tsx:29 | Allows querying the brain | Operator | ✓ |

### Findings
1. **No conflict resolution mechanism** (P1)
   - File:memory:page.tsx:38
   - Problem: Conflicting facts are flagged but there's no clear path for resolving them. Operators must manually decide which version to keep or discard.
   - Proposed: Add a simple conflict resolution interface that allows operators to select the preferred version or merge conflicting facts with notes explaining the decision.

2. **No semantic search capabilities** (P1)
   - File:memory:page.tsx:29
   - Problem: The current query interface only supports keyword searches, limiting the ability to find related concepts or paraphrased information.
   - Proposed: Integrate semantic search technology that understands context and relationships between terms, enabling more accurate and relevant results.

3. **No fact expiration or refresh policies** (P2)
   - File:memory:page.tsx:57
   - Problem: Stored facts do not have expiration dates or automatic refresh mechanisms, potentially leading to outdated information being used.
   - Proposed: Implement a policy for fact expiration or refresh based on source reliability, topic volatility, or manual override options.

4. **Limited entity linking options** (P2)
   - File:memory:page.tsx:74
   - Problem: Entities are displayed with minimal connection details, making it hard to understand how they relate to each other or influence one another.
   - Proposed: Enhance the entity graph with richer visualization tools that show degree of relationship, shared facts, or influence paths between entities.

5. **No fact rating or credibility scoring** (P2)
   - File:memory:page.tsx:57
   - Problem: All facts are treated equally regardless of their source quality or reliability, which can lead to poor decision-making based on less trustworthy data.
   - Proposed: Assign credibility scores to facts based on source reliability, evidence strength, and expert consensus. Display these scores prominently.

### Suggested additions
- **Knowledge audit trail**: Track when facts were added, modified, or reviewed, providing accountability and historical context.
- **Automated fact verification**: Integrate external verification services to validate high-importance facts automatically.
- **Collaborative fact editing**: Allow multiple operators to contribute to and refine facts collaboratively, with change tracking and approval workflows.

## Route: /smart

### Current affordance map
| Affordance | File:line | What it does | Who clicks | Misplaced? |
|---|---|---|---|---|
| Smart console | smart:page.tsx:14 | Main action interface | Operator | ✓ |
| Capability cards | smart:page.tsx:14 | Describe smart mode capabilities | Operator | ✓ |
| Action buttons | smart:page.tsx:14 | Quick actions | Operator | ✓ |

### Findings
1. **No clear indication of pending actions** (P1)
   - File:smart:page.tsx:14
   - Problem: The smart console doesn't show what actions have been queued or are currently processing, leaving users uncertain about the status of their requests.
   - Proposed: Add a status indicator or progress bar that shows the current state of actions submitted through the smart interface.

2. **Limited action history or logging** (P2)
   - File:smart:page.tsx:14
   - Problem: There's no persistent record of completed actions or their outcomes, making it difficult to track what has been done or troubleshoot issues.
   - Proposed: Implement an action log that stores completed actions, including timestamps, results, and any errors encountered.

3. **No batch operation support** (P2)
   - File:smart:page.tsx:14
   - Problem: Users can only submit one action at a time, which is inefficient for repetitive tasks or bulk updates.
   - Proposed: Allow users to queue multiple actions at once and execute them sequentially or in parallel where appropriate.

4. **No confirmation step for destructive actions** (P2)
   - File:smart:page.tsx:14
   - Problem: Some actions (like deleting records or transferring funds) may have irreversible consequences without explicit confirmation steps.
   - Proposed: Add confirmation dialogs for potentially dangerous actions, requiring users to explicitly acknowledge risks before proceeding.

5. **Lack of contextual help** (P2)
   - File:smart:page.tsx:14
   - Problem: Users unfamiliar with smart mode may struggle to understand how to phrase requests or what actions are possible.
   - Proposed: Include contextual help tooltips or a FAQ section that explains how to best utilize the smart mode for various tasks.

### Suggested additions
- **Action scheduling**: Allow users to schedule actions to run at specific times or intervals.
- **Smart workflow builder**: Enable users to create reusable workflows that combine several actions into a single command.
- **Performance analytics**: Display statistics on how often certain actions are performed and how quickly they complete.

# Cross-route patterns

1. **Inconsistent terminology across modules**: Across the /agents, /inventory, and /legal routes, terms like "status", "active", "live", "partial", "soon", and "planned" are used inconsistently. This creates confusion for operators who expect uniform language. For example, /agents uses "live", "partial", and "soon" while other areas might use "active", "in-progress", or "pending".

2. **Missing direct navigation from lists to detail pages**: Several routes lack direct links from list views to detail pages, forcing users to navigate through secondary paths. This is particularly evident in /agents, /filing, /inventory, and /groups where users must either click on a specific item or go through the tab strip to access detailed information.

3. **Limited search and filtering capabilities**: Many routes lack comprehensive search or filtering options beyond basic keyword matching. Routes like /filing, /groups, /inventory, and /memory suffer from this limitation, requiring users to manually browse or rely on external tools to find specific information.