# LOGIC.md — Nisria Command Center decision system

The blueprint every screen implements, every agent's system prompt enforces, and QA
tests against. Anchored to Nur's TechOps doc (5 pillars). Principle: nothing happens
without a rule; every input has one destination; every object has a state; every
action has a failure branch; every decision is logged and reversible.

## 1. Prime Router — one entry for every input
```
INPUT → classify {what, who, brand/account, intent, sensitivity}
 ├ money:donation        → Donor Steward + Money
 ├ money:payment-shot     → Finance (Claude vision)
 ├ file:image/doc         → Library ingest (unless a command rides with it)
 ├ command:natural-lang   → Intent Resolver → tool + card
 ├ event:system           → Cascade rules
 └ message
     ├ sender=automated    → FYI only; extract events (donations/alerts); NO reply
     ├ sender=team         → Internal / Tasks
     ├ sender=individual {routine→draft auto-able · relational→draft approve · money/PII/legal/press→ESCALATE}
     └ sender=unknown      → draft (approve) + enrich
```

## 2. Entity state machines (no object floats)
```
Message:   new→classified→drafted→awaiting_approval→sent→replied | archived | escalated
Approval:  pending→approved | edited | rejected | expired(→re-escalate)
Task:      todo→assigned→notified→in_progress→blocked→done | auto_done   (nudge if idle)
Donor:     prospect→first_gift→active→lapsing(>90d)→lapsed→reactivated
Donation:  received→acknowledged→stewarded
Grant:     identified→researching→drafting→review→submitted→won | lost (deadline guard)
Content:   idea→drafting→visual→review→scheduled→posted | failed
Payment:   upcoming→due→paid(verified) | overdue
Inventory: draft→listing_generated→listed | out_of_stock
Team:      invited→activated(bot)→active→inactive
```
Every transition emits an event. The event log is the single source of truth.

## 3. Autonomy function (lane is computed)
```
1. HARD OVERRIDE: money-out | PII | legal | press | bulk-send → ESCALATE (always)
2. else if dial=auto AND confidence≥0.8 AND seen-before       → AUTO
3. else if dial ∈ {auto,approve}                              → APPROVE (draft+queue)
4. NOVELTY CLAMP: first time with sender/scenario             → force APPROVE
```

## 4. Cascade rules (one event → many effects)
```
donation.succeeded → thank donor · +campaign · +lifetime · 360 · first_gift→welcome · ≥threshold→escalate
approval.approved(mail) → send · log outbound · learn→memory · mark replied
task.done → notify Nur · update team load · advance project
payment.verified → Money updated · decrement budget · receipt→Library
content.posted → log · update cadence · feed engagement back
donor.lapsing → Steward re-engagement draft · surface in Continuity
grant.deadline-7d → nudge · bump priority
```

## 5. Invariants (never break)
PII needs consent · money never auto-fires · idempotency keys on all external actions ·
no dead ends (every action has a failure branch) · pause/cancel always possible ·
every decision logs why · brand isolation (Nisria/Maisha/AHADI never bleed).

## 6. Failure trees
```
send fails → retry×3 → mark failed + REOPEN approval + ping Nur
M-Pesa OCR <0.7 → show parsed → ask Nur to confirm
Postiz down → keep scheduled · retry · flag
Folklore(browser) fails → screenshot + escalate
Claude error → graceful fallback + retry next tick
```

## 7. Temporal logic
`*/5m` agent tick · `hourly` donation sync · `06:00` daily summary · `18:00` wrap ·
daily deadline watch (grants/payments/lapsing) · idle nudge · `00:00` continuity carryover.

## 8. Smart Mode intent resolution
NL → intent + slots → tool + card. Missing slot → ask one question. Ambiguous → 2-3 candidate cards.
Money/PII → never guess, always confirm. Drop-target: M-Pesa shot→Finance · photo→Library · CSV→import.

## 9. Decision ledger
Every routing + lane decision = one row (input, classification, rule, confidence, path, outcome).
Replayable, tunable, self-explaining.

## 10. Pillar mapping (Nur's doc)
Content&Publishing→Content Hub (Claude+Canva→Library) · Fundraising&Donor→Money+Steward+Grants(RUNBOOK) ·
Data&Systems→360+Library+Inventory→Folklore · Internal Comms→Tasks+Team bot · Automation→Smart Mode+Daily Summary+Continuity+mesh.

## 11. Two front doors
Dashboard mode (Mission Control, scan + act) and Smart Mode (agentic, talk/type/drag → cards).
Same agents, same spine, same data. Both always surface Daily Summary + Continuity.
