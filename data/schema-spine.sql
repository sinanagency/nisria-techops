-- =============================================================
-- Nisria Command Center — SPINE schema (the agentic nervous system)
-- Idempotent. Deploy via Supabase Management API.
--
-- events            the event bus (append-only log; humans + agents read it)
-- approvals         the "Needs You" queue (what an agent drafted, awaiting Nur)
-- action_intents    gated outbound queue (agents emit intents -> gateway fires)
-- agent_runs        observability (every agent step: input/decision/tokens)
-- agent_memory      the learning brain (full-text now, pgvector later)
-- connector_registry config for each external platform (sensor/effector)
-- autonomy_rules    the dials: per scope, auto / approve / escalate
-- assets            Asset Library metadata (files live in Storage bucket)
--
-- Security: RLS ON everywhere, zero permissive policies => deny by default.
-- The platform reads/writes with the service-role key (bypasses RLS) server-
-- side only. Browser never holds a Supabase key. Live updates reach the UI via
-- a server-side Realtime subscription proxied over SSE, not direct browser sub.
-- =============================================================

create extension if not exists vector;
create extension if not exists pgcrypto;

-- ---------- events: the bus ----------
create table if not exists events (
  id             uuid primary key default gen_random_uuid(),
  type           text not null,                 -- message.received, donation.created, agent.decided, approval.created, action.executed ...
  source         text,                          -- gmail | givebutter | whatsapp | agent:comms | nur | system
  actor          text,                          -- who caused it
  subject_type   text,                          -- contact | donor | campaign | asset | task ...
  subject_id     uuid,
  correlation_id uuid,                           -- ties a chain of events together
  payload        jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists events_type_idx        on events (type);
create index if not exists events_created_idx      on events (created_at desc);
create index if not exists events_subject_idx      on events (subject_type, subject_id);
create index if not exists events_correlation_idx  on events (correlation_id);

-- ---------- approvals: the Needs You queue ----------
create table if not exists approvals (
  id                 uuid primary key default gen_random_uuid(),
  kind               text not null,             -- email_reply | social_post | newsletter | task_assignment | whatsapp_reply | refund ...
  title              text not null,
  summary            text,
  agent              text,                       -- which agent proposed it
  lane               text not null default 'approve',  -- approve | escalate
  status             text not null default 'pending',  -- pending | approved | rejected | edited | expired
  proposed           jsonb not null default '{}'::jsonb,  -- the drafted action/content
  context            jsonb default '{}'::jsonb,           -- what the agent saw (grounding)
  related_contact_id uuid,
  related_event_id   uuid,
  intent_id          uuid,                       -- the action_intent this will fire on approval
  decided_by         text,
  decided_at         timestamptz,
  decision_note      text,
  created_at         timestamptz not null default now()
);
create index if not exists approvals_status_idx  on approvals (status, created_at desc);
create index if not exists approvals_kind_idx     on approvals (kind);

-- ---------- action_intents: the gated outbound queue ----------
create table if not exists action_intents (
  id               uuid primary key default gen_random_uuid(),
  connector        text not null,               -- email | givebutter | postiz | whatsapp | folklore | squarespace | drive | creative
  action           text not null,               -- send_email | create_campaign | post | send_message | update_inventory ...
  params           jsonb not null default '{}'::jsonb,
  lane             text not null default 'approve',  -- auto | approve | escalate
  risk             text default 'low',          -- low | medium | high
  status           text not null default 'queued',  -- queued | awaiting_approval | approved | executing | done | failed | cancelled
  idempotency_key  text unique,
  approval_id      uuid,
  requested_by     text,                         -- agent:comms | nur | system
  correlation_id   uuid,
  result           jsonb,
  error            text,
  created_at       timestamptz not null default now(),
  executed_at      timestamptz
);
create index if not exists intents_status_idx     on action_intents (status, created_at);
create index if not exists intents_connector_idx  on action_intents (connector);

-- ---------- agent_runs: observability ----------
create table if not exists agent_runs (
  id               uuid primary key default gen_random_uuid(),
  agent            text not null,
  trigger_event_id uuid,
  correlation_id   uuid,
  decision         text,                         -- auto | draft | escalate | noop | error
  input            jsonb,
  output           jsonb,
  model            text,
  tokens_in        int,
  tokens_out       int,
  latency_ms       int,
  status           text not null default 'ok',   -- ok | error
  error            text,
  created_at       timestamptz not null default now()
);
create index if not exists runs_agent_idx    on agent_runs (agent, created_at desc);
create index if not exists runs_created_idx   on agent_runs (created_at desc);

-- ---------- agent_memory: the learning brain ----------
-- Works day one via full-text (tsv). Upgrades to semantic when an embedder is wired.
create table if not exists agent_memory (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null,                    -- message | approved_reply | brand_voice | asset | decision | doc_chunk
  brand        text,                             -- nisria | maisha | ahadi | null
  title        text,
  content      text not null,
  metadata     jsonb default '{}'::jsonb,
  source_type  text,
  source_id    uuid,
  embedding    vector(1536),                     -- nullable; populated once embedder chosen
  tsv          tsvector generated always as (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(content,''))) stored,
  created_at   timestamptz not null default now()
);
create index if not exists memory_tsv_idx    on agent_memory using gin (tsv);
create index if not exists memory_kind_idx    on agent_memory (kind, brand);
-- vector ivfflat index added later, once rows exist (needs data to train lists).

-- ---------- connector_registry: the control-plane config ----------
create table if not exists connector_registry (
  id            uuid primary key default gen_random_uuid(),
  key           text unique not null,            -- email | givebutter | postiz | whatsapp | folklore | squarespace | drive | creative | google_ads
  name          text not null,
  kind          text not null default 'effector',-- sensor | effector | both
  mechanism     text,                            -- api | browser | smtp_imap
  enabled       boolean not null default false,
  default_lane  text not null default 'approve', -- auto | approve | escalate
  capabilities  jsonb default '[]'::jsonb,
  health        text default 'unknown',          -- ok | down | unknown
  config        jsonb default '{}'::jsonb,        -- NON-secret config only (secrets stay in env/Keychain)
  last_check    timestamptz,
  created_at    timestamptz not null default now()
);

-- ---------- autonomy_rules: the dials ----------
create table if not exists autonomy_rules (
  id          uuid primary key default gen_random_uuid(),
  scope       text unique not null,              -- connector:email | kind:email_reply | kind:refund ...
  lane        text not null default 'approve',   -- auto | approve | escalate
  note        text,
  updated_by  text,
  updated_at  timestamptz not null default now()
);

-- ---------- assets: the Asset Library ----------
create table if not exists assets (
  id                uuid primary key default gen_random_uuid(),
  brand             text,                         -- nisria | maisha | ahadi
  type              text default 'other',         -- image | document | pdf | video | post | logo | report | template | other
  title             text,
  description       text,                         -- Claude vision caption / extracted summary
  tags              text[] default '{}',
  storage_path      text,                         -- path within the 'assets' Storage bucket
  mime              text,
  size_bytes        bigint,
  source            text default 'upload',        -- upload | drive | email
  source_ref        text,                         -- drive file id, message id, etc.
  consent_required  boolean not null default false,
  consent_on_file   boolean not null default false,
  usage_rights      text,
  memory_id         uuid,                         -- link to agent_memory row (the embedded knowledge)
  created_by        text,
  created_at        timestamptz not null default now()
);
create index if not exists assets_brand_idx  on assets (brand, type);

-- ---------- RLS: lock everything (service role bypasses; anon/authed denied) ----------
alter table events             enable row level security;
alter table approvals          enable row level security;
alter table action_intents     enable row level security;
alter table agent_runs         enable row level security;
alter table agent_memory       enable row level security;
alter table connector_registry enable row level security;
alter table autonomy_rules     enable row level security;
alter table assets             enable row level security;

-- ---------- Realtime: publish the bus + queues for server-side subscribers ----------
do $$
begin
  begin execute 'alter publication supabase_realtime add table events';         exception when duplicate_object then null; end;
  begin execute 'alter publication supabase_realtime add table approvals';      exception when duplicate_object then null; end;
  begin execute 'alter publication supabase_realtime add table action_intents'; exception when duplicate_object then null; end;
  begin execute 'alter publication supabase_realtime add table agent_runs';     exception when duplicate_object then null; end;
end $$;

-- ---------- Seed the connector registry (config only, no secrets) ----------
insert into connector_registry (key, name, kind, mechanism, enabled, default_lane, capabilities) values
  ('email',       'Email (Gmail)',     'both',     'smtp_imap', true,  'approve',  '["send_email","draft","label"]'),
  ('givebutter',  'Givebutter',        'both',     'api',       true,  'approve',  '["read_donations","create_campaign","tag_contact","refund"]'),
  ('postiz',      'Postiz (social)',   'effector', 'api',       false, 'approve',  '["create_post","schedule","publish"]'),
  ('whatsapp',    'WhatsApp Cloud',    'both',     'api',       false, 'approve',  '["send_message","send_template","notify_team"]'),
  ('folklore',    'The Folklore',      'both',     'browser',   false, 'approve',  '["read_orders","update_inventory","fulfill","list_products"]'),
  ('squarespace', 'Squarespace site',  'effector', 'browser',   false, 'approve',  '["update_banner","embed_form","publish_post"]'),
  ('drive',       'Google Drive',      'sensor',   'api',       false, 'auto',     '["import_files","watch_folder"]'),
  ('creative',    'Creative (Canva)',  'effector', 'api',       false, 'approve',  '["generate_graphic","render_template"]'),
  ('google_ads',  'Google / Zanii Ads','sensor',   'api',       false, 'escalate', '["read_performance","adjust_budget"]')
on conflict (key) do nothing;

-- ---------- Seed the autonomy dials (start conservative) ----------
insert into autonomy_rules (scope, lane, note, updated_by) values
  ('kind:email_reply',      'approve',  'Drafts wait for Nur until trust is earned', 'system'),
  ('kind:social_post',      'approve',  'All posts approved before publish',         'system'),
  ('kind:newsletter',       'escalate', 'Bulk send always needs Nur',                'system'),
  ('kind:refund',           'escalate', 'Money out always escalates',                'system'),
  ('kind:task_assignment',  'auto',     'Internal task routing can auto-run',        'system'),
  ('kind:donor_thankyou',   'approve',  'Thank-yous draft first, loosen later',      'system'),
  ('connector:whatsapp',    'approve',  'Outbound to contacts approved; team notify auto', 'system')
on conflict (scope) do nothing;
