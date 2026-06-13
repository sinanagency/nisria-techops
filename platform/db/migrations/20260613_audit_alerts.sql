-- 727 stale-ingest-audit ledger. KT #238.
--
-- Why: 2026-06-12 Nur uploaded 2 expense PDFs + typed expense lines into the
-- 727 WhatsApp group. The pipeline classified + routed the PDFs to finance,
-- but nothing applied them. The typed expense lines ("Sanara trainer-Ksh
-- 25,000 / Transport for trainer-Ksh 1,500") never matched parsePayment
-- because the regex didn't handle hyphen-payee-first phrasing. No one knew
-- for hours. State machines need a stuck-state alert path.
--
-- This table is the dedup ledger for the cron at /api/cron/stale-ingest-audit.
-- One row per alert fired. The cron hashes the alertable-set and refuses to
-- re-fire the same hash within 12h, so a flapping condition doesn't spam the
-- developer phone the way the 06-09 v1-soak watchdog did before its delete-on-
-- disarm fix.

create table if not exists public.audit_alerts (
  id          text        primary key,
  kind        text        not null,            -- 'stale_ingest' | 'dropped_expense' | combined
  hash        text        not null,            -- sha1(kind|sorted-ids) — the dedup key
  sent_at     timestamptz not null default now(),
  payload     jsonb       not null default '{}'::jsonb
);

create index if not exists audit_alerts_hash_sent_idx
  on public.audit_alerts(hash, sent_at desc);

create index if not exists audit_alerts_sent_at_idx
  on public.audit_alerts(sent_at desc);
