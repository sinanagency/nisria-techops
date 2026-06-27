-- Resources hub + Press & Media library. 2026-06-21.
--
-- Two browsable surfaces Nur asked for (via Sasa 727):
--   1. resources    — every platform/tool/supplier/account she's registered on,
--                     in one place instead of 100+ tabs. Doubles as a CREDENTIAL
--                     VAULT: rows flagged is_credential carry an encrypted secret
--                     (AES-256-GCM ciphertext, never plaintext). The /resources
--                     route is gated behind its own vault password on top of the
--                     normal session, because it grants access to live accounts.
--   2. press_items  — interviews, features, podcast episodes, articles, tagged by
--                     brand (nisria | maisha | personal | other) + free tags[],
--                     so "the Guardian article" can be filed under Maisha.
--
-- Both are written by the dashboard AND by Sasa's tools (save_resource /
-- save_press_item / tag_press_item), and mirrored into agent_memory via
-- remember() so Sasa can still cite them when drafting. Dual-write pattern,
-- same as the asset library.
--
-- SAFE FOR THE APP: the command-center connects ONLY via the server-side
-- service_role key (lib/supabase-admin.ts), which has BYPASSRLS. Enabling RLS
-- with no policies = deny-all to anon/authenticated, closing the PII hole while
-- leaving the bot + dashboard untouched (matches 20260620_enable_rls_all_public).
-- Idempotent: re-runnable.

-- ===== resources =====
create table if not exists public.resources (
  id                uuid default gen_random_uuid() not null,
  title             text not null,
  url               text,
  description       text,
  brand             text,                          -- nisria | maisha | ahadi | null (personal)
  category          text default 'link' not null,  -- platform | tool | supplier | funding | research | partner | account | social | link
  tags              text[] default '{}'::text[] not null,

  -- credential vault (only populated when is_credential = true)
  is_credential     boolean default false not null,
  username          text,                          -- login identifier (NOT secret; shown masked-light)
  secret_ciphertext text,                          -- AES-256-GCM ciphertext of the password (base64). NEVER plaintext.
  secret_iv         text,                          -- base64 IV
  secret_tag        text,                          -- base64 auth tag

  notes             text,
  source_type       text,                          -- chat | dashboard | import
  created_by        text default 'Nur' not null,
  sandbox           boolean default false not null,
  created_at        timestamp with time zone default now() not null,
  updated_at        timestamp with time zone default now() not null,
  constraint resources_pkey primary key (id)
);
create index if not exists resources_category_idx on public.resources using btree (category, brand);
create index if not exists resources_cred_idx     on public.resources using btree (is_credential);
create index if not exists resources_created_idx  on public.resources using btree (created_at desc);

-- ===== press_items =====
create table if not exists public.press_items (
  id             uuid default gen_random_uuid() not null,
  title          text not null,
  url            text,
  outlet         text,                              -- e.g. Spotify, The Guardian, BBC
  media_type     text default 'feature' not null,   -- interview | article | podcast | video | social | feature | award | mention
  published_on   date,
  description    text,
  brand          text,                              -- nisria | maisha | ahadi | personal | other
  subject        text,                              -- who/what is featured: "Nur", a past project name, etc.
  tags           text[] default '{}'::text[] not null,
  thumbnail_url  text,
  source_type    text,                              -- chat | dashboard | import
  created_by     text default 'Nur' not null,
  sandbox        boolean default false not null,
  created_at     timestamp with time zone default now() not null,
  updated_at     timestamp with time zone default now() not null,
  constraint press_items_pkey primary key (id)
);
create index if not exists press_brand_idx     on public.press_items using btree (brand, media_type);
create index if not exists press_published_idx on public.press_items using btree (published_on desc);
create index if not exists press_created_idx   on public.press_items using btree (created_at desc);

-- keep updated_at fresh
create or replace function public.touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists resources_touch on public.resources;
create trigger resources_touch before update on public.resources
  for each row execute function public.touch_updated_at();

drop trigger if exists press_items_touch on public.press_items;
create trigger press_items_touch before update on public.press_items
  for each row execute function public.touch_updated_at();

-- deny-all to anon/authenticated; service_role bypasses (see header)
alter table public.resources   enable row level security;
alter table public.press_items enable row level security;
