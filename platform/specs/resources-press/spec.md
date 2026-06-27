# Spec: Resources Hub + Press & Media Library

Status: built in a sandbox branch, NOT yet deployed. Migration and env vars pending.
Surface: Nisria Command Center (command.nisria.co), Next.js 14 + Supabase, operated by one person (Nur M'nasria). Sasa is the WhatsApp bot on the 727 channel and shares the database.

---

## Problem

Nur's accounts, tools, suppliers, and logins live in 100+ open browser tabs and in her head. There is no single place to find "what was that supplier" or "where's my login for X," and passwords float around in chat and notes. Separately, the press coverage about Nur and the brands (interviews, articles, podcasts, features) is scattered across links with no library, so she can't find or cite it when drafting. She wants to save and read back logins, including passwords, over WhatsApp, so the store has to hold encrypted secrets and return them to her on demand.

## Outcome

Two browsable surfaces in the portal, both populatable by Sasa over WhatsApp.

Done looks like:

- `/resources` is the tabbed hub, gated behind its own vault password. A **Links & platforms** tab (`?tab=links`, the default) lists the non-secret tool/platform/supplier/account/link rows, filterable by category and brand. A **Logins & passwords** tab (`?tab=logins`) is the credential vault table: each row stores the password encrypted (AES-256-GCM) and reveals it only on demand via a masked reveal control. Each tab has its own add form.
- `/press` is a separate top-level route (not a tab under Resources). It lists every interview/article/podcast/video/feature, filterable by brand and media type, searchable by title/outlet, sliceable by free-text tags.
- Sasa can save a resource (including a password, encrypted before it hits the DB), save a press item, tag a press item, and retrieve a saved login from the 727 channel. Sasa never echoes a password back into chat on save; the password is encrypted at rest in `resources` and never in the `agent_memory` mirror.
- `get_credential` lets Nur read back a stored login in chat. It is owner-only: never available in a team group or to anyone but Nur (tier must not be `team` and `viewerIsOwner` must be true), mirroring the beneficiary PII wall.
- A non-secret summary of each saved item lands in `agent_memory` so Sasa can cite it when drafting. The password is never mirrored.
- Every Sasa write emits an event and only claims "saved" when the row actually landed.

## Scope

- DB migration creating `resources` and `press_items`.
- `/resources` route with a vault password gate (30-minute unlock), tabbed into **Links & platforms** (`?tab=links`, default) and **Logins & passwords** (`?tab=logins`), each with its own add form. AES-256-GCM encryption for credential secrets, with on-demand masked reveal in the Logins tab.
- `/press` route as a separate top-level surface (normal portal login) with filter/search/tags.
- Four Sasa tools in `lib/smart-tools.ts`: `save_resource` (now with a `password` field, encrypted at rest), `save_press_item`, `tag_press_item`, and the owner-only read tool `get_credential`.
- `agent_memory` mirroring (non-secret, never the password) on the save tools.
- Master-prompt addendum so the 727 channel handles these flows, including encrypted password save and owner-only retrieval.

## Data model

Migration: `db/migrations/20260621_resources_and_press.sql`.

### `resources`

| column | purpose |
|---|---|
| `id` | primary key |
| `title` | display name of the tool/platform/supplier |
| `url` | link |
| `category` | tool / platform / supplier / account / link |
| `brand` | nisria / maisha / ahadi / personal / other |
| `username` | login identifier (safe to store) |
| `is_credential` | bool; true if this row has an associated secret |
| `secret_ciphertext` | AES-256-GCM encrypted password; never plaintext. Set from chat via `save_resource`'s `password` field (encrypted before write) or from the Logins tab add form |
| `tags` | free-text tags array |
| `notes` | free-text notes |
| `created_at` | timestamp |

### `press_items`

| column | purpose |
|---|---|
| `id` | primary key |
| `title` | headline / episode title |
| `url` | link |
| `outlet` | publisher (Spotify, BBC, Guardian, etc.) |
| `media_type` | article / podcast / video / interview / feature |
| `brand` | nisria / maisha / ahadi / personal / other |
| `subject` | who/what it's about |
| `published_on` | publish date |
| `tags` | free-text tags array (a brand tag also sets `brand`) |
| `description` | short summary |
| `created_at` | timestamp; "this article" resolves to newest |

## Security model

- **Vault gate.** The whole `/resources` route, both tabs, sits behind its own vault password (`RESOURCES_VAULT_PASSWORD`), separate from the normal portal login, because it grants account access. Unlock lasts 30 minutes, then re-locks. Unlock state is carried in a cookie signed with `VAULT_COOKIE_SECRET` (falls back to `SESSION_TOKEN`).
- **Encryption at rest.** Credential secrets are encrypted with AES-256-GCM using `RESOURCES_VAULT_KEY` (32-byte; accepted as hex, base64, or passphrase). `secret_ciphertext` is never stored in plaintext. The plaintext is only produced at the moment of reveal (Logins tab) or retrieval (`get_credential`), never shipped to the browser before then.
- **Password from chat, encrypted before write.** Sasa **does** save a password Nur shares. `save_resource` takes a `password` field; the secret is encrypted (AES-256-GCM) before it touches the `resources` table, so the row holds only ciphertext. Sasa must not echo the password back in its confirmation reply, and must not put it in `notes`/`title` (only the `password` field gets encrypted).
- **Owner-only retrieval.** `get_credential(query)` is a read tool that decrypts and returns a stored username + password in chat. It is gated owner-only: the tier must not be `team` and `viewerIsOwner` must be true, mirroring the beneficiary PII wall. Never callable in a team group or for anyone but Nur.
- **agent_memory mirroring is non-secret.** Only non-secret summaries are mirrored via `remember()`. No password, no ciphertext.
- **Residual risk (accepted).** A password typed in chat, and a password returned by `get_credential`, both pass through the WhatsApp `messages` log in plaintext, even though `resources` only ever stores it encrypted. This is an accepted tradeoff for the convenience of saving and reading logins over chat. Possible future hardening: redact secrets from the stored message log (see open questions, not built).
- **Verified write.** Every Sasa action emits an event and follows the verified-write rule: never claim "saved" unless the DB row landed.

## Non-goals

- Password autofill, browser extension, or SSO. The vault is a store, not a password manager that types for you.
- Sharing resources or press with other users. Single operator.
- Scraping or auto-importing press from the web. Items are added by Nur or Sasa.
- Rotating or strength-checking stored passwords.
- Rich media hosting. `/press` links out, it does not host audio/video.

## Open questions

- Vault key rotation: how does Nur re-encrypt if `RESOURCES_VAULT_KEY` ever changes? (No rotation path in v1.)
- Lockout policy: do we throttle repeated wrong vault-password attempts?
- Should `tag_press_item` ever create a press item if none matches, or always refuse and ask? (v1: refuse and ask.)
- Do we want an audit trail of reveal events on credential rows, and of `get_credential` calls?
- Should we redact secrets from the WhatsApp `messages` log so passwords typed in chat or returned by `get_credential` don't sit there in plaintext? (Not built in v1; accepted residual risk.)

## Deployment checklist

- [ ] Apply migration `db/migrations/20260621_resources_and_press.sql` (creates `resources` and `press_items`). Verify both tables exist before anything else.
- [ ] Set env var `RESOURCES_VAULT_PASSWORD` (the vault gate password).
- [ ] Set env var `RESOURCES_VAULT_KEY` (32-byte; hex, base64, or passphrase) for AES-256-GCM.
- [ ] Set env var `VAULT_COOKIE_SECRET` (signs the unlock cookie; falls back to `SESSION_TOKEN` if unset).
- [ ] Add nav entries for `/resources` (Links & platforms / Logins & passwords tabs) and `/press` in the portal.
- [ ] Graft the SASA BEHAVIOUR addendum from `MASTER-PROMPT.md` into Sasa's system prompt.
- [ ] Smoke test: vault gate blocks `/resources` (both tabs) until correct password; unlock holds ~30 min then re-locks.
- [ ] Smoke test: tabs work, `?tab=links` is the default and shows non-secret rows; `?tab=logins` shows the credential table with masked reveal; each tab's add form writes the right row.
- [ ] Smoke test: save a credential resource, confirm `secret_ciphertext` is encrypted and reveal decrypts it; confirm no plaintext in the DB.
- [ ] Smoke test: Sasa `save_resource` with a password in the message stores the encrypted password (ciphertext in `resources`, no plaintext anywhere in the DB or `agent_memory`), and Sasa's reply does NOT echo the password.
- [ ] Smoke test: `get_credential` returns the decrypted username + password for the owner (Nur, direct chat), and refuses in a team group / when `viewerIsOwner` is false (tier `team` blocked).
- [ ] Smoke test: `save_press_item` lands a row and mirrors a non-secret summary to `agent_memory`; `tag_press_item` resolves "this article" to newest and a brand tag sets `brand`.
- [ ] Soak 24-48h: watch events for write failures and confirm no "saved" claim without a landed row.
