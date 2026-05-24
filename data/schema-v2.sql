-- ============================================================================
-- Nisria Command Center v2 — operations tables
-- Team, tasks (incl. AI-dispatched), content/social queue, omnichannel messages.
-- Run AFTER schema.sql. Idempotent-ish.
-- ============================================================================

create extension if not exists "pgcrypto";

-- TEAM MEMBERS (Nur's employees with roles)
create table if not exists team_members (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text,
  role        text,                       -- e.g. "Content Lead", "Kenya Field", "VA", "Web Manager"
  brand_id    uuid references brands(id),
  status      text not null default 'active' check (status in ('active','inactive')),
  created_at  timestamptz not null default now()
);

-- TASKS (Nur assigns; some created by the AI from natural language)
create table if not exists tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  assignee_id uuid references team_members(id) on delete set null,
  brand_id    uuid references brands(id),
  status      text not null default 'todo' check (status in ('todo','in_progress','done','blocked')),
  priority    text not null default 'medium' check (priority in ('low','medium','high')),
  due_on      date,
  source      text not null default 'manual' check (source in ('manual','ai')),
  created_by  text default 'Nur',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_tasks_status on tasks (status);
create index if not exists idx_tasks_assignee on tasks (assignee_id);

-- CONTENT / SOCIAL QUEUE (Nur or team drop a post; the system publishes)
create table if not exists content_posts (
  id           uuid primary key default gen_random_uuid(),
  brand_id     uuid references brands(id),
  channels     text[] default '{}',       -- ['instagram','facebook','linkedin','tiktok','pinterest']
  title        text,
  body         text,
  image_url    text,
  status       text not null default 'draft' check (status in ('draft','scheduled','posted','failed')),
  scheduled_for timestamptz,
  posted_at    timestamptz,
  created_by   text default 'Nur',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_content_status on content_posts (status);

-- CONTACTS (people who reach in via WhatsApp / email)
create table if not exists contacts (
  id          uuid primary key default gen_random_uuid(),
  name        text,
  email       text,
  phone       text,
  channel     text,                       -- whatsapp | email
  created_at  timestamptz not null default now()
);

-- MESSAGES (omnichannel inbox: WhatsApp + email, in + out, AI or human)
create table if not exists messages (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid references contacts(id) on delete set null,
  channel     text not null default 'whatsapp' check (channel in ('whatsapp','email')),
  direction   text not null default 'in' check (direction in ('in','out')),
  body        text,
  handled_by  text default 'pending' check (handled_by in ('ai','human','pending')),
  status      text not null default 'new' check (status in ('new','replied','closed')),
  created_at  timestamptz not null default now()
);
create index if not exists idx_messages_status on messages (status);
create index if not exists idx_messages_contact on messages (contact_id);

-- RLS (admin app uses service key server-side; enable + lock down)
alter table team_members  enable row level security;
alter table tasks         enable row level security;
alter table content_posts enable row level security;
alter table contacts      enable row level security;
alter table messages      enable row level security;

-- updated_at triggers (set_updated_at() defined in schema.sql)
create trigger trg_tasks_updated before update on tasks for each row execute function set_updated_at();
create trigger trg_content_updated before update on content_posts for each row execute function set_updated_at();

-- ---- demo seed (safe, delete later) ----------------------------------------
insert into team_members (name, role, status)
values ('Aisha (Kenya Field)','Kenya Field Lead','active'),
       ('Sam (Content)','Content Lead','active'),
       ('Maya (VA)','Virtual Assistant','active')
on conflict do nothing;

insert into content_posts (brand_id, channels, title, body, status, scheduled_for)
select (select id from brands where slug='nisria'),
       array['instagram','facebook'], 'Back to school',
       'She walks 10 minutes to school now, not two hours. Your support did that. 🇰🇪',
       'scheduled', now() + interval '1 day'
on conflict do nothing;

insert into tasks (title, description, status, priority, source, assignee_id)
select 'Draft this week''s Nisria blog', 'Topic: what $25 covers', 'todo', 'medium', 'manual',
       (select id from team_members where role='Content Lead' limit 1)
on conflict do nothing;

with c as (
  insert into contacts (name, channel, phone) values ('Inbound Supporter','whatsapp','+254700000000')
  on conflict do nothing returning id
)
insert into messages (contact_id, channel, direction, body, handled_by, status)
select c.id, 'whatsapp', 'in', 'Hi, how can I sponsor a child?', 'pending', 'new' from c
on conflict do nothing;
