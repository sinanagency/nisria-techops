# Spec 001: Claude ↔ Portal MCP Bridge

> Status: DRAFT (Tier 1). Pipeline: SPEC (this) → ADR → SCHEMA → EVAL → CODE → SOAK.
> Author: Sasa-techops session 2026-06-24. Project: nisria-techops / platform.

## 1. Problem

Nur runs Nisria day to day through the Sasa 727 WhatsApp bot, which holds her operational brain (beneficiaries, cases, documents, history) and drives the `command.nisria.co` portal. Separately, she uses her own Claude account to author the actual work product: contracts, donor letters, social media copy, case documents. Those two worlds are disconnected. The Claude she drafts in knows nothing about the portal's brain, so she hand-feeds it beneficiary names and case facts every time, and the finished document is stranded in a chat window. To get it into Nisria or onto someone's WhatsApp she copies, pastes, re-uploads, and re-types. The authoring surface and the operational brain never touch.

## 2. Outcome

Nur authors a document in Claude that is grounded in real portal data, and that document reaches both the portal's document store and the intended WhatsApp recipient without manual copy-paste. The same capability is reachable from WhatsApp: she can ask Sasa to have Claude draft something, or to resend a document Claude made earlier.

- **Primary metric:** A document authored in Claude can be saved into the correct case on `command.nisria.co` AND delivered to a WhatsApp recipient in zero manual copy-paste steps. Baseline today: not possible (manual, multi-step). Target: one Claude turn for save, one for send.
- **Secondary metric (regression catch):** Zero documents delivered to a WhatsApp recipient without an explicit send action recorded in the portal (`sasa.mcp_document_sent` event). No silent sends, no "done" claimed when only staged.

## 3. Scope

**In scope:**
- A single tool layer of portal functions: `read_brain` (read business context a2z), `search_documents`, `get_document`, `save_document`, `send_whatsapp`, and scoped `crud_*` writes.
- Exposing that tool layer as a **remote MCP server** at `command.nisria.co` so Nur adds it as a custom connector in her own Claude account (interactive authoring path).
- Exposing the identical tool layer to a **server-side Claude** (Claude API) that Sasa invokes when Nur asks from WhatsApp ("ask Claude to draft X", "send me the doc Claude made").
- Read access across the business: beneficiaries, cases, case timeline, documents, recent messages, tasks.
- Write access on a **safe-list** (documents, drafts, notes, tasks) with create/update.
- A **confirm-gate** on destructive or money/contract-status writes: the tool stages the action and echoes it to Nur on WhatsApp for a "yes" before it commits.
- WhatsApp delivery of documents via a signed, short-lived public URL (Meta requires a reachable HTTPS link for `sendDocument`).
- Honest tool results: every tool returns the real outcome (sent / staged / failed), never a fabricated success.

**Out of scope (explicitly excluded):**
- Multi-tenant access. This is Nur-only (plus Taona as developer role). No other users get connectors in v1.
- Letting the MCP layer delete beneficiaries or cases, or change contract/payment status, without the confirm-gate. Blanket destructive CRUD is excluded by design.
- Replacing Sasa. The bot remains the primary operational driver. Claude is an authoring client, not a second brain.
- Editing the portal UI/portal pages. This is an API + integration feature, no portal front-end work in v1.
- Reaching into Nur's live claude.ai chat session from the portal. The portal cannot push into her interactive Claude; the WhatsApp-triggered path uses a separate server-side Claude (see ADR).
- Image/audio generation. Documents are text/markdown/PDF authored by Claude, not generated media.

## 4. User flow

**Happy path A — author in Claude, push out (interactive):**
1. Nur, in her Claude app, says "draft a service contract for beneficiary Amina, use her case details."
2. Claude calls `read_brain` (and `get_document` for any prior contract) and drafts the contract grounded in real data.
3. Nur says "save this to her case and send it to me on WhatsApp."
4. Claude calls `save_document` (files it into Amina's case) then `send_whatsapp` (to Nur, with a signed doc link).
5. The tool returns "saved to case #… and sent to your WhatsApp"; the portal logs `sasa.mcp_document_saved` + `sasa.mcp_document_sent`; the document arrives on Nur's phone.

**Happy path B — trigger from WhatsApp:**
1. On WhatsApp, Nur tells Sasa "ask Claude to write the welcome letter for the new donor and send me that contract Claude made last week."
2. Sasa routes the request to a server-side Claude with the same tool layer.
3. Server-side Claude calls `read_brain` + `save_document` for the new letter, and `get_document` + `send_whatsapp` for the prior contract.
4. Sasa replies on WhatsApp with the outcome; both documents are handled with no app switch.

**Failure path 1 — destructive/money write:**
1. Claude calls a `crud_*` op that changes contract status or deletes a record.
2. The tool does NOT commit; it stages the change and sends Nur a WhatsApp confirm ("Claude wants to mark contract #… as signed. Reply YES to confirm.").
3. Only on Nur's "yes" does the action commit; otherwise it expires and the tool result says "staged, awaiting your confirmation."

**Failure path 2 — WhatsApp send fails mid-way:**
1. `send_whatsapp` calls Meta and the document send errors (bad link, API 4xx).
2. The tool returns an honest `send_failed` with the real status code, emits `sasa.mcp_send_failed`, and never reports success.

## 5. Non-goals

- Not trying to make Claude the operational brain. Sasa stays the brain; Claude is the drafting room.
- Not trying to give an external language model unsupervised write authority over real people's records. Human confirm-gate is intentional friction, not a bug.
- Not trying to support arbitrary third-party MCP clients. The server is shaped for Nur's Claude + the portal's own server-side Claude, not a public API.
- Not optimizing for latency in v1. Correctness and honesty over speed.

## 6. Open questions

- Q: Connector auth for Nur — single-tenant OAuth vs secret-in-URL? A: DECIDED — Phase 1 ships a secret-in-URL bearer to prove the round-trip on Nur's phone; Phase 2 hardens to minimal single-tenant OAuth (passphrase → token bound to Nur's contact) before it is anything but a demo. Pinned in ADR.
- Q: Which exact entities are in the CRUD safe-list? A: Start with documents, drafts, notes, tasks. Beneficiary/case create allowed; beneficiary/case delete + contract/payment status = confirm-gated. Revisit after first week of soak.
- Q: How does the server-side Claude identify "as Nur" and pick the right case to write into? A: It runs with Nur's contact id as the actor context; ambiguous case targets trigger a WhatsApp clarification rather than a guess. Confirm with a soak test.
- Q: Does `read_brain` expose donor financials / bank data? A: Default NO in v1 (excluded from the read surface); revisit only if Nur explicitly asks. Log as follow-up.
- Q: Token/secret rotation story? A: Phase 2 OAuth makes this clean; Phase 1 secret is rotatable via env var. Documented in handoff.
- Q: Send idempotency under concurrent fires? A: Phase 1 uses a best-effort 90s event-based dedupe (NOT lock/unique-constraint enforced), so two truly-simultaneous send_whatsapp calls could both deliver. Disclosed deliberately; blast radius is a possible duplicate message to Nur herself. Phase 2 routes the send through gateway.createIntent (DB-enforced idempotency key), which the confirm-gate/CRUD work needs anyway.

Note: the live MCP connector URL is `https://command.nisria.co/api/bridge/mcp` (mounted under /api/bridge, NOT /api/mcp, so the [transport] catch-all cannot collide with any existing /api/* route). Phase 1 verifies via curl + MCP Inspector with a bearer; claude.ai's connector UI needs the Phase 2 OAuth handshake before Nur adds it from her app.

## 7. Test cases (golden set)

| # | Input / scenario | Expected outcome |
|---|------------------|------------------|
| 1 | Nur's Claude calls `read_brain` for beneficiary "Amina" | Returns Amina's case facts + recent context; no other beneficiary's private data leaks in |
| 2 | Claude calls `save_document` with a drafted contract for case #C123 | Document stored, linked to case #C123, `sasa.mcp_document_saved` emitted, returns the doc id |
| 3 | Claude calls `send_whatsapp` with a saved doc id, target = Nur | Phase 1: `sendText` with a portal deep-link (Nur is authenticated, taps to open); `sasa.mcp_document_sent` emitted. Phase 2: true media push via Meta `sendDocument` + Supabase signed URL for non-logged-in recipients |
| 4 | `send_whatsapp` where Meta returns a 4xx | Tool returns `send_failed` with the real status code, emits `sasa.mcp_send_failed`, does NOT claim success |
| 5 | Claude calls a `crud_*` op to delete a beneficiary | Action staged, WhatsApp confirm sent to Nur, NOT committed until "yes"; tool returns "staged, awaiting confirmation" |
| 6 | Nur ignores the confirm-gate prompt for the configured TTL | Staged action expires, no commit, expiry logged; tool result reflects expiry honestly |
| 7 | `get_document` for a doc id that does not exist | Returns a clean not-found result, no 500, no fabricated content |
| 8 | Unauthenticated request hits the MCP endpoint (no/invalid token) | 401, no tool list leaked, no data returned |
| 9 | From WhatsApp Nur says "ask Claude to draft the donor letter" | Sasa invokes server-side Claude with the tool layer; a draft is produced and saved; Sasa confirms on WhatsApp |
| 10 | From WhatsApp Nur says "send me the contract Claude made last week" | Server-side path runs `search_documents` + `send_whatsapp`; correct prior doc delivered to Nur |
| 11 | `read_brain` requested for donor bank/financial data | Excluded in v1: returns "not available", no financial fields exposed |
| 12 | `save_document` with an ambiguous case target (no clear case) | Tool asks for clarification (or returns needs-target) rather than guessing a case |
| 13 | Two rapid `send_whatsapp` calls for the same doc | No duplicate-send; idempotent on (doc id, recipient, short window), second is deduped |
| 14 | MCP `tools/list` handshake from a connected client | Returns the tool schemas; server speaks Streamable HTTP transport that claude.ai accepts |

## Build phasing (for the loop)

- **Phase 1 (demonstrable spine):** `/api/bridge/mcp` route (mcp-handler, stateless Streamable HTTP) + bearer auth + tools `read_brain`, `search_documents`, `get_document`, `save_document`, `send_whatsapp` (portal deep-link text to Nur). Honest tool results. Walls + curl proof of the protocol handshake. Deploy to prod.
- **Phase 2 (full loop + hardening):** server-side Claude invoked by Sasa on WhatsApp trigger; scoped `crud_*` with confirm-gate; single-tenant OAuth replacing the secret URL; dedup + expiry. Walls + soak.

Human handoff (cannot be done by the agent): Nur adds the connector URL in her own Claude account and authorizes it.
