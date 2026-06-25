
## 2026-06-26 — autonomous loop (no-ask)
- Operator directive: never block on a question; pick the recommended option, log it, proceed. Loop only exits at proven 90-95% sandbox accuracy. Bot stays in maintenance; nobody messaged.
- Seed decision: anonymize = STRIP deep PII (national_id, phone, email, story, dob, address, photo, guardian) but KEEP names + ids + amounts + statuses + relationships (required for name-lookups + finance queries to resolve). Sandbox is a throwaway hash URL (SSO off for automation access), deleted at loop end.
- Baseline (slice [0,80)): new 48.2% / routing 73% / 24 excluded — dominated by EMPTY sandbox data (donations/salaries/beneficiaries), not routing. Seeding master data is the fix.
