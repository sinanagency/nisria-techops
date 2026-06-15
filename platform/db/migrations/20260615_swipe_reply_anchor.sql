-- 2026-06-15 — Sasa swipe-reply anchor (Wall 1 of bug-family "fragment match
-- without anchor"; sibling of KT #229 wall-at-primitive and KT #274 first-name
-- frag-stoplist). When Nur uses WhatsApp's swipe-to-reply on a Sasa message,
-- Meta's inbound payload carries messages[].context.id (the wamid of the
-- quoted message). Until this change the webhook ignored it and the worker
-- saw free-floating text like "done" with no anchor, so the matcher fuzzed
-- and sometimes picked the wrong task (see "meeting taona done" closing
-- "meeting with haneen", 2026-06-15).
--
-- This adds the persistence column. Lookup at turn time joins
-- messages.reply_to_external_id → messages.external_id (already uniquely
-- indexed via uq_messages_external) to find the original Sasa outbound. The
-- partial index keeps the table thin: only inbound replies populate the
-- column, everything else stays NULL.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS reply_to_external_id text;

CREATE INDEX IF NOT EXISTS idx_messages_reply_to_external
  ON public.messages (reply_to_external_id)
  WHERE reply_to_external_id IS NOT NULL;
