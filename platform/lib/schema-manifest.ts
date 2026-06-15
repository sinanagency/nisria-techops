// Sasa schema manifest — boot-time drift detection (KT #295, 2026-06-16).
//
// Every (table, columns) pair the bot's HOT PATHS touch. checkSchema() at
// boot probes each pair against the live DB and flags drift before the
// app starts serving traffic.
//
// SCOPE TODAY: the WhatsApp ingest + worker chain. Today's cascade
// (2026-06-15) hit messages.reply_to_external_id; this manifest would have
// trapped the deploy banner before any user inbound.
//
// EXPANDING: add a table block when you ship a write/update path that
// references a column the bot's correctness depends on. The cost of a
// missed column is a silent agent failure under load; the cost of an
// over-listed column is one extra `select ... limit 0` per boot. Lean
// toward over-listing for hot paths.

import type { SchemaManifest } from "./brain-core/index.js";

export const SASA_SCHEMA_MANIFEST: SchemaManifest = {
  // The cascade source. KT #293 added reply_to_external_id here; today's
  // bug is on this row.
  messages: [
    "id", "body", "channel", "direction", "external_id", "contact_id",
    "reply_to_external_id", "account", "handled_by", "status", "subject",
    "sender_type", "asset_id", "media_path", "media_mime", "created_at",
  ],
  // The actor side. Webhook resolveContact writes here.
  contacts: [
    "id", "name", "email", "phone", "channel", "created_at",
  ],
  // The event bus. emit() writes here on every webhook + worker step;
  // a drift on this table silently swallows audit signal.
  events: [
    "id", "type", "source", "actor", "subject_type", "subject_id",
    "payload", "created_at",
  ],
  // The worker queue. enqueueJob writes here.
  jobs: [
    "id", "kind", "subject_id", "payload", "status", "created_at",
  ],
  // The bot's main write surface for operator commands.
  tasks: [
    "id", "title", "status", "priority", "assignee_id", "due_on",
    "due_time", "source", "created_by", "task_type", "created_at",
    "updated_at",
  ],
  // Calendar surface. complete_calendar_event (KT #288) writes here.
  // NB: the actual column is starts_on/ends_on (date) + start_time/end_time
  // (time of day), NOT starts_at/ends_at (timestamp). The guard caught this
  // shape on its first dry-run, exactly the kind of column-name drift it is
  // built to surface.
  calendar_events: [
    "id", "title", "starts_on", "ends_on", "start_time", "end_time",
    "notes", "kind", "brand", "source", "created_by", "created_at",
    "updated_at", "reminded_at",
  ],
};
