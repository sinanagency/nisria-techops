# ADR-0015: MCP Full Bridge, Tiered

- Status: ACCEPTED
- Date: 2026-06-27
- Tier: 1
- Related: ADR-0013 (Claude ↔ Portal MCP bridge, item 6 CRUD safety), ADR-0014 (Phase 2 OAuth), lib/mcp-tools.ts, lib/smart-tools.ts (SMART_TOOLS, runSmartTool)

## Context

The MCP bridge shipped with 5 bespoke, hand-written tools (read_brain, search_documents, get_document, save_document, send_whatsapp). Sasa (WhatsApp) meanwhile drives ~126 tools through one executor, `runSmartTool`, with the guards, PII walls, currency law, and staged-confirmation already baked in. The operator asked for the Claude.ai connector to have the same power as the WhatsApp bot: full two-way capability.

Two roads to parity:

- **Road A: re-implement each tool inside mcp-tools.ts.** Quick to start, but it creates a second source of truth. When Sasa's payment or PII logic changes, the MCP copy goes stale. Two brains drift until they disagree, and a disagreement about money is exactly what the doctrine exists to prevent.
- **Road B: route the MCP through the same `runSmartTool` executor Sasa uses.** One brain, two doors. Fix once, both surfaces get it. The money/PII safety comes for free because it is the same code.

The danger unique to the MCP: over MCP the *caller* is the model, not a human. A naive full-parity bridge would let the model fire `record_payment` on live money with no human in the loop.

## Decision

**1. Road B (one brain).** The MCP registers each allowed SMART_TOOL and delegates to `runSmartTool(name, input, ctx)` with an owner/admin context. No business logic is duplicated in the bridge. (Honors ADR-0013 item 1 and the One-brain Law.)

**2. Tiered exposure, because the caller is the model.**
- **READ** (the READ_TOOLS set): execute immediately. Nur holds the OAuth passphrase, so the caller carries her authority.
- **REVERSIBLE** (a curated allowlist of self-contained, undoable writes: tasks, drafts, contacts, resources, grants, notes, inventory, wishlist, donor/campaign edits): execute immediately.
- **STAGE-to-WhatsApp** (`record_payment`): prepared into `pending_actions` under Nur's contact via `confirmWrites: true`. She replies "yes" on WhatsApp; the existing worker re-runs it through `commitPaymentRow`. The human gate lives on her own device. Only kinds the worker can replay belong in this set.
- **HELD** (deletes, merges, payroll, funding, blasts, outbound sends, and the inbox-reading tools read_email/search_inbox): NOT registered. No safe replay path yet, or content too sensitive for a cloud chat transcript. Opening one later is moving a name between sets.

**3. Hard exclusion.** `get_credential` returns DECRYPTED vault secrets and is permanently excluded from the MCP surface: a password must never land in a cloud chat transcript.

**4. Bespoke tools stay.** The 5 original MCP-native tools remain (save_document, send_whatsapp, read_brain, get_document, search_documents); the loop skips their names so they are not double-registered.

Result: 92 tools exposed (43 read, 43 reversible, 1 staged, 5 bespoke); 37 held.

## Consequences

- Positive: one codebase, one set of tool semantics, no drift. Reads make Claude genuinely useful about Nisria from anywhere. Money stays human-gated on Nur's phone. Expansion is a one-line set move.
- Negative: not literal full parity. 37 tools are deliberately held, so "everything the bot does" is true architecturally (same brain) but not yet true tool-for-tool. The held set needs a per-kind replay path (or an explicit opt-in) before it opens.
- The model can set a reversible write in motion without a separate human confirm; acceptable because those writes are undoable and the connector is Nur-authenticated. Money and destructive writes are not in that class.

## Alternatives considered (and rejected)

- **Road A (re-implement tools in the bridge).** Rejected: second source of truth, guaranteed drift, doubles the surface to keep honest. The exact trap ADR-0013 named.
- **Expose all 126 tools immediately.** Rejected: lets the model fire live-money and destructive writes with no human gate, and leaks secrets/inbox contents into cloud transcripts.
- **A new MCP confirm tool for every sensitive write.** Rejected for v1: the model could call confirm itself, so it adds no real human gate. WhatsApp "yes" is a true out-of-band human gate; use it for the one money kind the worker can replay, expand per-kind later.
