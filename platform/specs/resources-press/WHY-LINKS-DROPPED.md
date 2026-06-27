# Why Sasa dropped Nur's links — root cause + fix handoff

> For the engineer/agent who will fix the capture path. Repo: `~/Code/nisria-techops/platform`. Date: 2026-06-21.

## Symptom
In the last 24h Nur sent the 727 bot (Sasa) **71 distinct URLs** (press features, videos, podcasts, and platforms she's registered on) explicitly to be saved ("Remember this link", "This is another article about Nisria", "Vogue Business"). Only **51** landed in the Brain. **19 were silently dropped** (2 were Zoom links, correctly ignorable). No error, no "I couldn't save that" — they just vanished.

The 19 dropped were almost all real: Vogue Italia 2026, Al Jazeera, Kenya Times, Tuko, K47, Vellum, EA Business Times, MyCouture, Black Ballad, Simply Suzette, Masrawy 2019, plus 5 platforms (HustleSasa, PandaDoc, StoryRaise, HudumaKenya, an Instagram help page).

## Evidence (queried from prod `messages` + `agent_memory`)
- **71 of 73 link-messages contained exactly ONE link.** So this is NOT a "too many URLs in one message to parse" bug. They arrived as separate single-link messages, mostly in two bursts (2026-06-20 22:06–22:22 and 06-21 07:44–08:05).
- **The only save path is `remember_fact`.** Saved press rows are `kind=org_fact`, titled `press/media - …`, with `metadata.slug = chat:press-media-…` — written by `rememberUpsert` from the `remember_fact` tool. There is **no automatic URL→library capture**. A link is saved only if the LLM *chooses* to call `remember_fact` for that message.
- **The to-do message was swallowed.** The message containing 5 platform links (HudumaKenya/HustleSasa/StoryRaise/Instagram/PandaDoc, inside a `nisria To Do` markdown checklist) has `status = coalesced` — it was routed into the task/reminder path, so its URLs were never extracted as links at all.
- **The only deterministic link-detection that exists is for MEETING links** (`dispatch_meeting_bot`, smart-tools.ts:446) → it joins Zoom/Meet. There is no equivalent for press/resource links.

## Root cause
**Link-saving is LLM-discretionary, not a deterministic pipeline.** Each save depends on the model firing `remember_fact` for that specific message. Under a rapid burst of ~70 messages the model fired it ~51 times and skipped ~19 (~27% miss rate), and any link embedded in a different intent (a to-do list) is routed away from the save path entirely. This is the known failure mode: **the model does not reliably call its own tools — actions that must always happen need a deterministic route, with the LLM used only for understanding/classification** (matches the team's standing principle / KT #206540, "deterministic route for actions + grounded LLM for understanding").

Contributing factors:
1. No regex/URL interceptor on inbound messages — capture is 100% model-initiated.
2. `remember_fact`'s own description says "Use ONLY when Nur tells you to remember…", so during a fast stream where she pastes a link with light framing, the model often treats it as conversational and skips the call.
3. Links inside task/reminder/`coalesced` messages bypass the memory path.
4. **Silent failure**: nothing tells Nur a link wasn't saved, so the gap is invisible until audited.

## The fix (recommended design)
Build a **deterministic link-capture pipeline**, independent of whether the model calls a tool. New `save_resource` / `save_press_item` tools + the `resources`/`press_items` tables already exist (this sandbox) — wire the interceptor to them.

1. **Intercept every inbound message** for URLs with a regex (`/https?:\/\/[^\s<>"]+/g`), in the inbound handler — see `lib/agents/sasa.ts` (message entry) and the ingest path (`app/api/ingest`, `app/api/message`). Run this BEFORE/independent of the task/`coalesce` routing so to-do messages still get their links extracted.
2. **Extract ALL URLs per message** (not one), skip ephemeral hosts (zoom.us, meet.google, maps, we.tl) and meeting links already handled by `dispatch_meeting_bot`.
3. **Classify each** (press vs resource vs skip) with a cheap grounded model call (HAIKU) using the message text as context — do NOT rely on the main agent loop to volunteer it. Same "grounded extractor → deterministic write" shape as the beneficiary-intake slice.
4. **Persist via `save_press_item` / `save_resource`** (dedupe on URL — already idempotent), which also mirror into `agent_memory`.
5. **Acknowledge + emit an event** so a save is visible and auditable: "Saved 3 links to your library 📎" + `resource.added`/`press.added` events. Turns a silent drop into a confirmed action.
6. **Backfill the gap** with the script in this bundle: `scripts/backfill-brain-to-library.mjs` (dataset `brain-backfill.json`) covers the 24h batch.

### Code locations to touch
- `lib/agents/sasa.ts` — inbound message handler / where tools are dispatched (add the deterministic URL scan here, pre-routing).
- `lib/smart-tools.ts:3490` — `remember_fact` handler (the current accidental save path); leave it, but stop relying on it for links.
- `app/api/ingest` / `app/api/message` — confirm where inbound WhatsApp messages enter so the interceptor sits on the real choke point.
- New tools to call: `save_press_item`, `save_resource`, `tag_press_item` (already added in `lib/smart-tools.ts` in this bundle).

### Acceptance test
Replay the 24h burst (or send 10 single-link messages fast, including one to-do list with 3 embedded links). Expect: 100% of non-ephemeral links land in `/press` or `/resources`, deduped, with a confirmation per batch and an event per save. Zero silent drops.
