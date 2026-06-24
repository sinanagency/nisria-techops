# ADR-0013: Claude ↔ Portal MCP Bridge

- Status: ACCEPTED (drives Spec 001)
- Date: 2026-06-24
- Tier: 1
- Related: Spec `001-claude-portal-mcp-bridge`, KT #206540 (deterministic route + grounded LLM), KT #357 / #206542 (send-honesty), ADR-0012 (pending-intents)

## Context

Nur authors work product (contracts, donor letters, social copy, case docs) in her own Claude account. Sasa 727 holds the operational brain and drives `command.nisria.co` + WhatsApp. The two are disconnected: Claude drafts blind to the brain, and its output is stranded in a chat window. We want a bridge where (a) Claude can read the brain and write documents/actions back, and (b) the same capability is reachable from WhatsApp ("ask Claude to draft X", "resend the doc Claude made").

A naive build would create two separate integrations and would let an external LLM write freely to real people's records. Both are traps.

## Decision

**1. One tool layer, two consumers.** Implement the capability once as portal functions (`read_brain`, `search_documents`, `get_document`, `save_document`, `send_whatsapp`, scoped `crud_*`). Expose the identical set (a) as a remote MCP server for Nur's interactive claude.ai, and (b) as tools handed to a server-side Claude (Claude API) that Sasa invokes on a WhatsApp trigger. The portal cannot reach into Nur's live claude.ai session, so the WhatsApp-triggered path MUST be a separate server-side Claude, not the connector.

**2. Host on the existing Next.js/Vercel deploy** via `mcp-handler` at `/api/mcp`. No new deploy target (preserves A3: one driver per deploy target).

**3. Stateless Streamable HTTP transport** (the transport claude.ai accepts), no Redis. SSE resumability is not needed for v1.

**4. Auth is phased.** Phase 1: a bearer secret, verified via curl + MCP Inspector (claude.ai's connector UI does not accept static header auth, so Phase 1 is NOT connectable from Nur's app by design — it proves the server, not the claude.ai handshake). Phase 2: minimal single-tenant OAuth (passphrase → token bound to Nur's contact) so claude.ai's "Connect" flow works.

**5. WhatsApp delivery is phased.** Phase 1 sends Nur a text message with a portal deep-link (she is authenticated; she taps to open). Phase 2 adds true media delivery via Supabase signed URLs for recipients who are not logged into the portal (Meta must be able to fetch the link; the login-gated portal/`/api/asset` cannot serve Meta).

**6. CRUD safety.** Read across the business a2z EXCEPT donor/bank financials (excluded in v1). Create/update on a safe-list (documents, drafts, notes, tasks). Destructive ops (delete beneficiary/case) and money/contract-status writes are confirm-gated: the tool stages and echoes to Nur on WhatsApp for a "yes" before commit.

**7. Honest tool results.** Every tool returns the real outcome (sent / staged / failed) and emits a `sasa.mcp_*` event. Never report "done" when only staged (reuses the KT #357 send-honesty discipline).

## Consequences

- Positive: one codebase, one deploy, one set of tool semantics for both Claude surfaces. Brain-grounded drafting. Auditable egress via events. Human stays in the loop for dangerous writes.
- Negative: Phase 1 is not yet connectable from claude.ai (OAuth deferred to Phase 2); we verify the server out-of-band first. Server-side Claude path (Phase 2) adds Anthropic API spend and an actor-identity concern (it acts "as Nur").
- The confirm-gate adds latency/friction on destructive writes. Intentional.

## Alternatives considered (and rejected)

- **Two separate integrations** (one for Claude→portal, one for portal→Claude with different tool semantics). Rejected: duplicate logic, drift, double the surface to keep honest.
- **Separate Cloudflare Worker (McpAgent + Workers OAuth provider).** Turnkey OAuth, but a second deploy target splits the platform and violates one-driver-per-deploy. Rejected for v1; revisit only if Vercel function limits bite.
- **Blanket no-auth MCP.** Rejected: it is document egress + write access to real records.
- **Full multi-tenant OAuth with dynamic client registration from day 1.** Rejected: this is Nur-only; single-tenant is far less code and sufficient.
- **Phase-1 media push to WhatsApp.** Rejected: Meta cannot fetch the login-gated portal, so it would silently fail; text + deep-link is honest and works now.
- **Blanket CRUD for the external Claude.** Rejected: a hallucinated delete hits a real beneficiary. Safe-list + confirm-gate instead.

## Reversibility

- The MCP route is additive and isolated under `/api/mcp`; removing it does not touch existing flows. Medium-low cost to reverse.
- The server-side Claude path (Phase 2) is gated behind a Sasa intent and an env flag; can be dark-shipped and toggled off.
- Auth secret is env-rotatable in Phase 1; Phase 2 OAuth tokens are revocable.
