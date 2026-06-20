-- 20260620_wa_turn_claim.sql
--
-- Durable per-sender turn-coalescing claim (the fix for the double-reply bug).
--
-- LIVE BUG: a contact sent "you're cool" then "thanks" as two separate WhatsApp
-- messages and got TWO separate replies. Every inbound message enqueues its own
-- whatsapp.reply job -> its own brain run -> its own reply. brain-core's
-- shouldProcess had a per-sender lock but it was an in-memory Map (does NOT
-- survive across Vercel serverless invocations), so it could not coalesce the
-- separate function calls.
--
-- THE DURABLE FIX: a per-contact claim row. The first whatsapp.reply job for a
-- sender INSERTs a row here (the unique index on contact_id makes the second
-- concurrent insert a 23505 unique_violation = loser). The winner settles
-- briefly, re-reads ALL unhandled inbound (messages.status='received') since the
-- sender's last outbound, runs the brain ONCE, sends ONE reply, marks the whole
-- burst handled (status='coalesced'), and releases the claim. Losers mark their
-- own inbound handled and return without replying. Exactly one reply per burst.
--
-- expires_at gives a self-healing TTL: a crashed winner's stale claim is ignored
-- and overwritable once expired, so a dropped invocation can never wedge a
-- sender into permanent silence (honesty law: never leave a human un-replied).
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS public.wa_turn_claim (
  "contact_id"  uuid PRIMARY KEY,
  "claimed_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at"  timestamp with time zone NOT NULL,
  "claimed_by"  text,
  "trace_id"    text
);

-- Cheap sweep index for releasing/overwriting expired claims.
CREATE INDEX IF NOT EXISTS wa_turn_claim_expires_idx
  ON public.wa_turn_claim (expires_at);

-- RLS: service-role only (the worker uses the service key). No anon access.
ALTER TABLE public.wa_turn_claim ENABLE ROW LEVEL SECURITY;
