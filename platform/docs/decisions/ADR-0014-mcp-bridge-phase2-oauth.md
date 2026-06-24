# ADR-0014: MCP Bridge Phase 2 — OAuth, server-side Claude, scoped CRUD

- Status: ACCEPTED
- Date: 2026-06-24
- Tier: 1
- Related: ADR-0013 (Phase 1), Spec `001-claude-portal-mcp-bridge`, KT #397

## Context

Phase 1 shipped the MCP server + 5-tool layer at `/api/bridge/mcp`, bearer-gated and live-verified. But it is NOT connectable from Nur's Claude app: verified against current docs (support.claude.com + claude.com/docs/connectors/building, 2026-06-24), claude.ai's custom-connector UI accepts only a URL + optional OAuth Client ID/Secret in Advanced settings — there is no static-bearer/API-key field. claude.ai supports MCP auth spec 2025-03-26 / 2025-06-18 / 2025-11-25, Streamable HTTP, Dynamic Client Registration, PKCE, and callback `https://claude.ai/api/mcp/auth_callback`. So OAuth is the only path that lets Nur connect.

Phase 2 must also deliver: a server-side Claude that Sasa invokes on a WhatsApp trigger ("ask Claude to draft X"), scoped CRUD with a confirm-gate, and true media delivery.

## Decision

**1. Hand-rolled minimal single-tenant OAuth 2.1 Authorization Server**, served from the same Next app under `/api/bridge`:
- `/.well-known/oauth-protected-resource` (RFC 9728) → advertises the resource + its AS.
- `/.well-known/oauth-authorization-server` (RFC 8414) → advertises `authorize`/`token`/`register`, `code_challenge_methods_supported: ["S256"]`, `grant_types: [authorization_code, refresh_token]`.
- `authorize` → a passphrase-gated page (one identity = Nur); on correct passphrase, issue a short-lived auth code bound to Nur's contact + the PKCE challenge, redirect to the client callback.
- `token` → exchange code + PKCE verifier for an access token (signed, contact-scoped) + refresh token; rotate.
- `register` (DCR, RFC 7591) → issue a client on demand (claude.ai uses DCR); also honor a pre-registered client if Nur pastes ID/secret in Advanced settings.
- `withMcpAuth` verifyToken → validate the contact-scoped access token (replaces the Phase 1 static bearer; bearer stays as a dev/escape path behind an env flag).

**2. Server-side Claude on WhatsApp trigger.** When Sasa detects "ask Claude …" from Nur, the portal calls the Claude API (Anthropic SDK, `claude-opus-4-8`, adaptive thinking) with the SAME tool layer (registerNisriaTools, reused as Anthropic tool definitions). The portal cannot reach Nur's claude.ai session, so this is a separate server-side Claude — one tool layer, two consumers (ADR-0013 principle).

**3. Scoped CRUD + confirm-gate.** Read a2z (minus financials). Create/update on the safe-list (documents, drafts, notes, tasks). Destructive (delete beneficiary/case) and money/contract-status writes are staged and echoed to Nur on WhatsApp for a "yes" before commit, routed through `gateway.createIntent` for DB-enforced idempotency (also fixes Phase 1's KT #397 H3 dedupe limitation).

**4. True media delivery.** `send_whatsapp` for a document gains a media path: generate a Supabase signed URL (Meta-fetchable) and call `sendDocument`, for recipients not logged into the portal. Text + deep-link stays the default for Nur.

## Consequences

- Positive: Nur can finally connect from her own Claude; the full loop (author in Claude ↔ portal brain ↔ WhatsApp, triggerable from either side) works. One deploy, one tool layer.
- Negative: hand-rolled OAuth is security-sensitive (mitigated: single-tenant, adversarial skeptic, bounded blast radius). Server-side Claude adds Anthropic API spend + an actor-identity concern (acts "as Nur"). Token storage needs a small table (migration → Taona runs it).
- Anthropic key: reuse the existing `ANTHROPIC_API_KEY` in Vercel prod (already rotated this session per KT #396) — do NOT hardcode.

## Alternatives considered (rejected)

- **Managed IdP (Auth0/Clerk/WorkOS/Stytch).** Offloads OAuth security, but external dependency + cost + integration overhead for a ONE-user private NGO tool. Rejected as overkill; revisit only if multi-tenant.
- **Cloudflare Workers OAuth provider.** Turnkey, but a second deploy target — violates one-driver-per-deploy (A3). Rejected (same as ADR-0013).
- **Stay authless.** Rejected — document egress + write access to real people's records cannot be unauthenticated.
- **Keep the static bearer for Nur.** Impossible — claude.ai's UI has no header/token field.

## Reversibility

OAuth routes are additive under `/api/bridge`; the Phase 1 bearer path stays behind an env flag as a fallback/dev escape. Server-side Claude + CRUD are gated behind Sasa intents + env flags (dark-shippable). Token table is drop-able.

## Build slices (loop order — OAuth first, it's the connectability unlock)

- Slice A: OAuth AS (metadata + authorize + token + register + token verify) → Nur can connect. Migration: `oauth_tokens`/`oauth_clients` table.
- Slice B: scoped CRUD tools + confirm-gate via gateway.createIntent.
- Slice C: server-side Claude invoked by Sasa on WhatsApp trigger.
- Slice D: true media delivery via signed URLs.
