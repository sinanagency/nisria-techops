# Email Template Library (ready to use / automate)

Plain, warm, dignified (per `content/brand-voice.md`). `{merge}` fields map to Supabase. ⚑ = confirm real figure/detail with Nur. These power the lifecycle automations (A2, C2) and bulk sends.

---

## 1. Donation receipt (transactional, automated A2)

**Subject:** Thank you, {first_name} — your gift is on its way to Kenya
> Hi {first_name},
> Your {amount} gift to {brand} just came through — thank you. {recurring? "As a monthly supporter, you're funding consistent care all year." : ""}
> Here's what it does: ⚑ {concrete outcome, e.g. "$50 covers a month of school meals for a child."}
> This email is your receipt (donation #{external_id}, {donated_at}). {tax-deductibility line ⚑}
> With gratitude, {sender} · {brand}

---

## 2. Welcome series (new donor, automated A2 — 3 emails)

**Email 1 (immediately after receipt, +1 day) — Welcome**
**Subject:** Welcome to {brand}, {first_name}
> You didn't just donate — you joined a community keeping children in Kenya in school, fed, and cared for. Here's the story of who you're helping ⚑ {link}. We'll only ever show you where your money goes.

**Email 2 (+4 days) — Proof / impact**
**Subject:** This is what your gift is already doing
> {1 specific, recent, consented impact story + photo}. That's you. Want to make it monthly? {link}

**Email 3 (+10 days) — Deepen**
**Subject:** Three ways to go further (no donation needed)
> Share our story · follow us {social links} · or shop The Folklore (proceeds give back ⚑). Thank you for being here.

---

## 3. Monthly impact note (recurring + major donors, C2)

**Subject:** {Month} at {brand}: here's what you made happen
> Hi {first_name}, because of supporters like you this month: {3 bullet outcomes ⚑}. Total raised: {amount}; children supported: {n} ⚑. One story: {short consented story}. Thank you for showing up every month.

---

## 4. Lapsed win-back (no gift 12+ mo, C2)

**Subject:** We've missed you, {first_name}
> It's been a while, and a lot has changed — {1 milestone ⚑}. Your past support helped get us here. Would you come back for {child/program}? Even {small amount ⚑} restarts the impact. {donate link}

---

## 5. Seasonal appeal (campaign send, segmented)

**Subject:** {Campaign}: {urgent, specific ask}
> {Open with a single child/story, consented.} This {Ramadan/year-end/back-to-school ⚑}, {specific goal: "$5,000 sends 100 kids back to school"}. We're at {raised}/{goal}. Your {amount} gets us closer. {donate link} — and thank you.
*(Suppress donors who gave in the last {14} days from re-asks.)*

---

## 6. Internal — decision request to Nur (comms)

**Subject:** Decision needed by {date}: {topic}
> *Context:* {2 lines} · *Options:* A {…} / B {…} · *My recommendation:* {…} · *If delayed:* {impact}. Reply A/B or "call me."

---

## Deliverability rules

Authenticate domain (SPF/DKIM/DMARC ⚑ for nisria.co / sending domain) · honor unsubscribes instantly · don't re-ask recent donors · keep bounce/complaint rates low · never buy lists · warm up new sending domains gradually.
