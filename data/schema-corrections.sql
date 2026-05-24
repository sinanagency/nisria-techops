-- Corrections-round schema: omnichannel accounts, finance/M-Pesa, daily continuity.
alter table messages add column if not exists account text;        -- which mailbox (sasa@/maisha@) or channel handle
alter table messages add column if not exists sender_type text;    -- individual | automated | team

-- backfill sender_type from the contact email (automated vs individual)
update messages m set sender_type = case
  when c.email ~* '(no-?reply|do-?not-?reply|notify|notification|mailer|accounts@|updates@|automated|team@|support@|hello@notify)' then 'automated'
  when c.email is null then 'automated'
  else 'individual' end
from contacts c where m.contact_id = c.id and (m.sender_type is null);

-- payments / finance (M-Pesa + upcoming)
create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  direction text not null default 'out',     -- out | in
  payee text, purpose text,
  amount numeric, currency text default 'USD',
  method text default 'mpesa',               -- mpesa | bank | card
  status text not null default 'upcoming',   -- upcoming | due | paid | overdue
  due_on date, paid_at timestamptz,
  ref text, screenshot_path text, brand text,
  created_by text, created_at timestamptz default now()
);
alter table payments enable row level security;
create index if not exists payments_status_idx on payments (status, due_on);

-- daily summary + continuity
create table if not exists daily_summaries (
  id uuid primary key default gen_random_uuid(),
  for_date date not null unique,
  brief text, wrap text,
  stats jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
alter table daily_summaries enable row level security;

-- connected accounts (add-account from the platform)
create table if not exists email_accounts (
  id uuid primary key default gen_random_uuid(),
  address text unique not null,
  label text, brand text, channel text default 'email',
  active boolean default true,
  created_at timestamptz default now()
);
alter table email_accounts enable row level security;
insert into email_accounts (address,label,brand,channel) values
  ('sasa@nisria.co','Nisria','nisria','email'),
  ('maisha@nisria.co','Maisha','maisha','email')
on conflict (address) do nothing;
